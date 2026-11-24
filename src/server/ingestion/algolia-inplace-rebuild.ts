import { and, asc, count, eq, gt, inArray, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { ingestionRun, vehicle } from "~/schema";
import {
  deleteRebuildIndex,
  rebuildIndexName,
  type RebuildDeletionClient,
} from "./algolia-rebuild-index";
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

/**
 * The Algolia admin calls an in-place rebuild makes. Browse is not search.
 * Deletion removes a copy the run started before it switched in place.
 */
export interface InPlaceRebuildClient extends RebuildDeletionClient {
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

/**
 * Where a sweep is: its pass, the Algolia browse cursor within it, and the
 * previous page's last objectID when that record is stale. Algolia anchors a
 * browse cursor on the page's last hit and refuses the cursor once that
 * record is deleted, so the sweep deletes it only after reading the next page.
 */
type SweepPosition = {
  pass: number;
  browse: string | null;
  deferred: string | null;
};

const sweepPositionSchema = z.object({
  pass: z.number().int().positive(),
  browse: z.string().nullable(),
  // Cursors stored before deferral existed have no deferred record.
  deferred: z.string().nullable().default(null),
});

/** A stored sweep position; a position without a deferred record keeps its
 * original shape, so cursors saved before deferral compare equal. */
function serializeSweepPosition(position: SweepPosition): string {
  return JSON.stringify(
    position.deferred === null
      ? { pass: position.pass, browse: position.browse }
      : position,
  );
}

/** Algolia refused a browse cursor because the hit it is anchored on was
 * deleted ("cursor is not valid anymore, the last hit of the previous query
 * was deleted"). The client exposes no code for it, only the message. */
function isDeletedAnchorCursor(error: unknown): boolean {
  return (
    error instanceof Error && /cursor is not valid anymore/i.test(error.message)
  );
}

function parseSweepPosition(
  runId: string,
  stored: string | null,
): SweepPosition {
  if (stored === null) return { pass: 1, browse: null, deferred: null };
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
  if (cursor === null) {
    // A copy this run started before switching in place holds records the
    // load needs. Routing deletes it; this also covers a delete that failed
    // after routing. A missing copy counts as deleted.
    const copy = await deleteRebuildIndex(
      context.algolia,
      context.indexName,
      context.runId,
    );
    if (copy === "blocked") {
      throw new Error(
        `In-place search rebuild ${context.runId} could not delete its partial copy ${rebuildIndexName(context.runId, context.indexName)} before loading, because the Algolia app is blocked. Live search and Turso are intact and nothing was loaded; the step retries and loads once Algolia accepts writes again.`,
      );
    }
  }
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
    .set({
      fullReindexCursor: serializeSweepPosition(to),
      lastProgressAt: new Date(),
    })
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
  let page: Awaited<ReturnType<InPlaceRebuildClient["browse"]>>;
  try {
    page = await context.algolia.browse({
      indexName: context.indexName,
      browseParams: {
        ...(position.browse === null ? {} : { cursor: position.browse }),
        hitsPerPage: SWEEP_PAGE_SIZE,
        attributesToRetrieve: ["objectID"],
      },
    });
  } catch (error) {
    if (position.browse === null || !isDeletedAnchorCursor(error)) throw error;
    // A sweep saved before deferral deleted its page's last hit. Deleted
    // records stay deleted, so restarting the pass loses nothing.
    console.warn(
      `[Algolia] In-place search rebuild ${context.runId}: Algolia refused sweep cursor of pass ${position.pass} because its last hit was deleted; restarting the pass from the first page. Live search and Turso are intact.`,
    );
    const saved = await saveSweepPosition(context, stored, {
      pass: position.pass,
      browse: null,
      deferred: position.deferred,
    });
    if (!saved) return { status: "stopped" };
    return {
      status: "paused",
      stage: "full_reindex_inplace_sweep",
      recordsProcessed: 0,
    };
  }
  const objectIDs = page.hits.map((hit) => hit.objectID);
  const candidates =
    position.deferred === null || objectIDs.includes(position.deferred)
      ? objectIDs
      : [position.deferred, ...objectIDs];
  const present = await presentVins(context.database, candidates);
  const stale = candidates.filter((objectID) => !present.has(objectID));
  // The next page's cursor is anchored on this page's last hit, so a stale
  // last hit is deleted only after that page is read.
  const anchor = page.cursor === undefined ? null : (objectIDs.at(-1) ?? null);
  const deferred = anchor !== null && stale.includes(anchor) ? anchor : null;
  const deleteNow = stale.filter((objectID) => objectID !== deferred);
  if (deleteNow.length > 0) {
    const deleted = await context.algolia.deleteObjects({
      indexName: context.indexName,
      objectIDs: deleteNow,
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
      deferred,
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
      deferred: null,
    });
    if (!saved) return { status: "stopped" };
    return {
      status: "paused",
      stage: "full_reindex_inplace_sweep",
      recordsProcessed: objectIDs.length,
    };
  }
  // Every load batch waited for its save, so fewer records than vehicles
  // means vehicles are missing. Publishing would clear the owed rebuild and
  // the change rows that could restore them.
  if (records !== null && records < vehicles) {
    throw new Error(
      `In-place search rebuild ${context.runId} finished its sweep with ${records} records in ${context.indexName} for ${vehicles} Turso vehicles, so ${vehicles - records} vehicles are missing from search. It was not published: full_reindex_required and the unprocessed change rows stay. Live search and Turso are otherwise intact. The step retries this check and the run is abandoned after repeated failures, so the next run rebuilds again; if it repeats, compare the index's objectIDs with the vehicle table.`,
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
