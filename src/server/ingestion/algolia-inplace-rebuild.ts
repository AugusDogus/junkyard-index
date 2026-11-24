import { and, asc, count, eq, gt, inArray, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { ingestionRun, vehicle } from "~/schema";
import { releaseFullReindex } from "./durable-algolia-publish";
import type { AlgoliaVehicleRecord } from "./types";

/** Vehicles read and saved per step, as the copy load does. */
const LOAD_BATCH_SIZE = 500;
/** Live objectIDs browsed per step. */
const SWEEP_PAGE_SIZE = 1_000;
/** VINs per Turso existence check (one indexed `in` lookup). */
const EXISTENCE_CHUNK = 500;
/**
 * Sweep passes before the rebuild gives up. One pass removes every stale
 * record it sees; another runs only if the index still holds more records
 * than Turso has vehicles afterwards.
 */
const MAX_SWEEP_PASSES = 3;

export type InPlaceStage =
  | "full_reindex_inplace_load"
  | "full_reindex_inplace_sweep";

/** The Algolia admin calls an in-place rebuild makes. Browse is not search. */
export interface InPlaceRebuildClient {
  saveObjects(params: {
    indexName: string;
    objects: Array<Record<string, unknown>>;
    waitForTasks: false;
  }): Promise<ReadonlyArray<{ taskID: number }>>;
  deleteObjects(params: {
    indexName: string;
    objectIDs: string[];
    waitForTasks: false;
  }): Promise<ReadonlyArray<{ taskID: number }>>;
  waitForTask(params: { indexName: string; taskID: number }): Promise<unknown>;
  browse(params: {
    indexName: string;
    browseParams: {
      cursor?: string;
      hitsPerPage: number;
      attributesToRetrieve: string[];
    };
  }): Promise<{
    hits: ReadonlyArray<{ objectID: string }>;
    cursor?: string;
    nbHits?: number;
  }>;
}

export interface InPlaceRebuildContext {
  runId: string;
  runStartedAt: Date;
  database: LibSQLDatabase;
  algolia: InPlaceRebuildClient;
  /** The live index, rewritten in place. */
  indexName: string;
  /** Turns vehicle rows into search records (projectSearchVehicles). */
  project(
    rows: Array<typeof vehicle.$inferSelect>,
  ): Promise<AlgoliaVehicleRecord[]>;
}

export type InPlaceRebuildStepResult =
  | { status: "stopped" }
  | { status: "paused"; stage: InPlaceStage; recordsProcessed: number }
  | { status: "complete"; searchPublishedAt: Date };

/** Where a sweep is: its pass, and the Algolia browse cursor within it. */
type SweepPosition = { pass: number; browse: string | null };

const sweepPositionSchema = z.object({
  pass: z.number().int().positive(),
  browse: z.string().nullable(),
});

function parseSweepPosition(
  runId: string,
  stored: string | null,
): SweepPosition {
  if (stored === null) return { pass: 1, browse: null };
  let json: unknown;
  try {
    json = JSON.parse(stored);
  } catch {
    json = null;
  }
  const parsed = sweepPositionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `In-place search rebuild ${runId} has an unreadable sweep cursor ${JSON.stringify(stored)} in ingestion_run.full_reindex_cursor. Live search and Turso are intact. Set full_reindex_cursor to null to restart the sweep from its first page.`,
    );
  }
  return parsed.data;
}

function lastTask(tasks: ReadonlyArray<{ taskID: number }>): number | null {
  return tasks.at(-1)?.taskID ?? null;
}

function activeRunAt(runId: string, stage: InPlaceStage) {
  return and(
    eq(ingestionRun.id, runId),
    eq(ingestionRun.status, "running"),
    eq(ingestionRun.activeSlot, 1),
    eq(ingestionRun.stage, stage),
  );
}

async function presentVins(
  database: LibSQLDatabase,
  vins: readonly string[],
): Promise<Set<string>> {
  const present = new Set<string>();
  for (let i = 0; i < vins.length; i += EXISTENCE_CHUNK) {
    const chunk = vins.slice(i, i + EXISTENCE_CHUNK);
    const rows = await database
      .select({ vin: vehicle.vin })
      .from(vehicle)
      .where(inArray(vehicle.vin, chunk));
    for (const row of rows) present.add(row.vin);
  }
  return present;
}

/**
 * Upserts one VIN-ordered batch of vehicles into the live index and moves
 * the cursor past it. Saves are full records, so a retried batch rewrites
 * the same objects.
 */
async function load(
  context: InPlaceRebuildContext,
  cursor: string | null,
): Promise<InPlaceRebuildStepResult> {
  const rows = await context.database
    .select()
    .from(vehicle)
    .where(cursor === null ? undefined : gt(vehicle.vin, cursor))
    .orderBy(asc(vehicle.vin))
    .limit(LOAD_BATCH_SIZE);
  const records = await context.project(rows);
  if (records.length > 0) {
    const saved = await context.algolia.saveObjects({
      indexName: context.indexName,
      objects: records.map((record) =>
        Object.fromEntries(Object.entries(record)),
      ),
      waitForTasks: false,
    });
    const taskID = lastTask(saved);
    if (taskID !== null) {
      await context.algolia.waitForTask({
        indexName: context.indexName,
        taskID,
      });
    }
  }
  const done = rows.length < LOAD_BATCH_SIZE;
  const next = rows.at(-1)?.vin ?? cursor;
  const updated = await context.database
    .update(ingestionRun)
    .set(
      done
        ? {
            stage: "full_reindex_inplace_sweep",
            fullReindexCursor: null,
            lastProgressAt: new Date(),
          }
        : { fullReindexCursor: next, lastProgressAt: new Date() },
    )
    .where(
      and(
        activeRunAt(context.runId, "full_reindex_inplace_load"),
        cursor === null
          ? isNull(ingestionRun.fullReindexCursor)
          : eq(ingestionRun.fullReindexCursor, cursor),
      ),
    );
  if (updated.rowsAffected === 0) return { status: "stopped" };
  return {
    status: "paused",
    stage: done ? "full_reindex_inplace_sweep" : "full_reindex_inplace_load",
    recordsProcessed: records.length,
  };
}

async function saveSweepPosition(
  context: InPlaceRebuildContext,
  from: string | null,
  to: SweepPosition,
): Promise<boolean> {
  const updated = await context.database
    .update(ingestionRun)
    .set({ fullReindexCursor: JSON.stringify(to), lastProgressAt: new Date() })
    .where(
      and(
        activeRunAt(context.runId, "full_reindex_inplace_sweep"),
        from === null
          ? isNull(ingestionRun.fullReindexCursor)
          : eq(ingestionRun.fullReindexCursor, from),
      ),
    );
  return updated.rowsAffected === 1;
}

/**
 * Browses one page of live objectIDs, deletes those Turso no longer has,
 * and records the browse cursor. At the end of a pass it publishes once the
 * index holds no more records than Turso has vehicles.
 */
async function sweep(
  context: InPlaceRebuildContext,
  stored: string | null,
): Promise<InPlaceRebuildStepResult> {
  const position = parseSweepPosition(context.runId, stored);
  const page = await context.algolia.browse({
    indexName: context.indexName,
    browseParams: {
      ...(position.browse === null ? {} : { cursor: position.browse }),
      hitsPerPage: SWEEP_PAGE_SIZE,
      attributesToRetrieve: ["objectID"],
    },
  });
  const objectIDs = page.hits.map((hit) => hit.objectID);
  const present = await presentVins(context.database, objectIDs);
  const stale = objectIDs.filter((objectID) => !present.has(objectID));
  if (stale.length > 0) {
    const deleted = await context.algolia.deleteObjects({
      indexName: context.indexName,
      objectIDs: stale,
      waitForTasks: false,
    });
    const taskID = lastTask(deleted);
    if (taskID !== null) {
      await context.algolia.waitForTask({
        indexName: context.indexName,
        taskID,
      });
    }
  }
  if (page.cursor !== undefined) {
    const saved = await saveSweepPosition(context, stored, {
      pass: position.pass,
      browse: page.cursor,
    });
    if (!saved) return { status: "stopped" };
    return {
      status: "paused",
      stage: "full_reindex_inplace_sweep",
      recordsProcessed: objectIDs.length,
    };
  }
  // The pass reached the end. A browse cursor can step past records when
  // earlier ones are deleted under it, so the pass is checked by count.
  const [counted] = await context.database
    .select({ vehicles: count() })
    .from(vehicle);
  const vehicles = counted?.vehicles ?? 0;
  const probe = await context.algolia.browse({
    indexName: context.indexName,
    browseParams: { hitsPerPage: 1, attributesToRetrieve: ["objectID"] },
  });
  const records = probe.nbHits ?? null;
  if (records !== null && records > vehicles) {
    if (position.pass >= MAX_SWEEP_PASSES) {
      throw new Error(
        `In-place search rebuild ${context.runId} swept ${context.indexName} ${position.pass} times and it still holds ${records} records for ${vehicles} Turso vehicles. Live search and Turso are intact; the run keeps retrying this check and is abandoned after repeated failures, which makes the next run rebuild again. Inspect the index for objects that are not vehicle VINs.`,
      );
    }
    const saved = await saveSweepPosition(context, stored, {
      pass: position.pass + 1,
      browse: null,
    });
    if (!saved) return { status: "stopped" };
    return {
      status: "paused",
      stage: "full_reindex_inplace_sweep",
      recordsProcessed: objectIDs.length,
    };
  }
  if (records !== null && records < vehicles) {
    console.warn(
      `[Algolia] In-place rebuild ${context.runId} finished with ${records} records in ${context.indexName} for ${vehicles} Turso vehicles. Every vehicle was saved during the load; the difference is likely index lag. Publishing anyway.`,
    );
  }
  const published = await releaseFullReindex({
    runId: context.runId,
    runStartedAt: context.runStartedAt,
    database: context.database,
    stages: ["full_reindex_inplace_sweep"],
  });
  return published;
}

/**
 * The full search rebuild used when a copy of the live index would not fit
 * under the Algolia record cap. It upserts every Turso vehicle into the live
 * index in VIN order, then browses the live index and deletes objectIDs Turso
 * no longer has, then publishes as a moved copy would. Search stays live
 * throughout: records update in place, stale ones disappear in the sweep,
 * and settings, synonyms, rules and replicas are never touched. Each step is
 * one bounded batch whose cursor is recorded on the run, so a retried or
 * resumed step redoes at most that batch.
 */
export const InPlaceRebuild = {
  stages: [
    "full_reindex_inplace_load",
    "full_reindex_inplace_sweep",
  ] as const satisfies readonly InPlaceStage[],
  maxSweepPasses: MAX_SWEEP_PASSES,

  /**
   * Moves a run from the copy path to the in-place load. Resolves false when
   * the run is not active in one of `from` (another attempt moved it).
   */
  async route(params: {
    database: LibSQLDatabase;
    runId: string;
    from: readonly string[];
  }): Promise<boolean> {
    const routed = await params.database
      .update(ingestionRun)
      .set({
        stage: "full_reindex_inplace_load",
        fullReindexCursor: null,
        lastProgressAt: new Date(),
      })
      .where(
        and(
          eq(ingestionRun.id, params.runId),
          eq(ingestionRun.status, "running"),
          eq(ingestionRun.activeSlot, 1),
          inArray(ingestionRun.stage, [...params.from]),
        ),
      );
    return routed.rowsAffected === 1;
  },

  /** Advances the run's in-place rebuild by one batch. */
  step(
    context: InPlaceRebuildContext,
    run: { stage: InPlaceStage; fullReindexCursor: string | null },
  ): Promise<InPlaceRebuildStepResult> {
    switch (run.stage) {
      case "full_reindex_inplace_load":
        return load(context, run.fullReindexCursor);
      case "full_reindex_inplace_sweep":
        return sweep(context, run.fullReindexCursor);
    }
  },
} as const;
