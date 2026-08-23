import { Effect } from "effect";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { algoliaClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia";
import { db as database, dbClient } from "~/lib/db";
import {
  ingestionRun,
  ingestionProjectorCheckpoint,
  vehicle,
  vehicleChange,
} from "~/schema";
import {
  mapDbVehicleToCanonical,
  partitionVehicleChanges,
} from "./algolia-projector-helpers";
import {
  publishFullReindexForRun,
  withIndexGeneration,
} from "./durable-algolia-publish";
import { PersistenceError } from "./errors";
import { Database, runIngestionEffect } from "./runtime";
import { syncToAlgoliaEffect } from "./sync-algolia";
import type { AlgoliaVehicleRecord } from "./types";
import { toAlgoliaRecord } from "./types";

export { mapDbVehicleToCanonical, partitionVehicleChanges };

const PROJECTOR_NAME = "vehicle_algolia";
const DEFAULT_BATCH_SIZE = 1000;
const VIN_QUERY_CHUNK_SIZE = 400;
const DURABLE_PROJECTOR_BATCH_SIZE = 500;

export interface AlgoliaProjectorRunResult {
  batchesProcessed: number;
  changesProcessed: number;
  upsertsSynced: number;
  deletesSynced: number;
  lastProcessedChangeId: number;
}

export type DurableAlgoliaProjectionBatchResult =
  | { status: "stopped" }
  | {
      status: "paused";
      stage: "project_changes" | "full_reindex_load" | "full_reindex_publish";
      recordsProcessed: number;
    }
  | { status: "complete"; searchPublishedAt: Date };

function rebuildIndexName(
  runId: string,
  indexName = ALGOLIA_INDEX_NAME,
): string {
  return `${indexName}__rebuild_${runId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

async function waitForAlgoliaTask(indexName: string, taskID: number) {
  await algoliaClient.waitForTask({ indexName, taskID });
}

async function markIndexGeneration(indexName: string, runId: string) {
  const settings = await algoliaClient.getSettings({ indexName });
  const userData = withIndexGeneration(settings.userData, runId);
  if (!userData.success) {
    throw new Error(
      `Algolia index ${indexName} has incompatible userData; cannot record rebuild generation ${runId}.`,
    );
  }
  const updated = await algoliaClient.setSettings({
    indexName,
    indexSettings: { userData: userData.data },
  });
  await waitForAlgoliaTask(indexName, updated.taskID);
}

async function readAlgoliaVehicleRecords(vins: string[]) {
  if (vins.length === 0) return [];
  const rows = await database
    .select()
    .from(vehicle)
    .where(inArray(vehicle.vin, [...new Set(vins)]));
  return rows.map((row) =>
    toAlgoliaRecord(
      mapDbVehicleToCanonical(row),
      row.firstSeenAt,
      row.missingSinceAt,
      row.missingRunCount ?? 0,
    ),
  );
}

async function prepareFullReindex(runId: string) {
  const temporaryIndex = rebuildIndexName(runId);
  const copied = await algoliaClient.operationIndex({
    indexName: ALGOLIA_INDEX_NAME,
    operationIndexParams: {
      operation: "copy",
      destination: temporaryIndex,
      scope: ["settings", "synonyms", "rules"],
    },
  });
  await waitForAlgoliaTask(temporaryIndex, copied.taskID);
  const cleared = await algoliaClient.clearObjects({
    indexName: temporaryIndex,
  });
  await waitForAlgoliaTask(temporaryIndex, cleared.taskID);
  await markIndexGeneration(temporaryIndex, runId);
  const updated = await database
    .update(ingestionRun)
    .set({
      stage: "full_reindex_load",
      fullReindexCursor: null,
      lastProgressAt: new Date(),
    })
    .where(
      and(
        eq(ingestionRun.id, runId),
        eq(ingestionRun.status, "running"),
        eq(ingestionRun.activeSlot, 1),
        eq(ingestionRun.stage, "full_reindex_prepare"),
      ),
    );
  if (updated.rowsAffected === 0) return { status: "stopped" as const };
  return {
    status: "paused" as const,
    stage: "full_reindex_load" as const,
    recordsProcessed: 0,
  };
}

async function loadFullReindexBatch(
  runId: string,
  cursor: string | null,
): Promise<DurableAlgoliaProjectionBatchResult> {
  const rows =
    cursor === null
      ? await database
          .select()
          .from(vehicle)
          .orderBy(asc(vehicle.vin))
          .limit(DURABLE_PROJECTOR_BATCH_SIZE)
      : await database
          .select()
          .from(vehicle)
          .where(gt(vehicle.vin, cursor))
          .orderBy(asc(vehicle.vin))
          .limit(DURABLE_PROJECTOR_BATCH_SIZE);
  const records = rows.map((row) =>
    toAlgoliaRecord(
      mapDbVehicleToCanonical(row),
      row.firstSeenAt,
      row.missingSinceAt,
      row.missingRunCount ?? 0,
    ),
  );
  if (records.length > 0) {
    await runIngestionEffect(
      syncToAlgoliaEffect(records, [], {
        indexName: rebuildIndexName(runId),
      }),
    );
  }
  const nextCursor = rows.at(-1)?.vin ?? cursor;
  const nextStage =
    rows.length < DURABLE_PROJECTOR_BATCH_SIZE
      ? "full_reindex_publish"
      : "full_reindex_load";
  const updated = await database
    .update(ingestionRun)
    .set({
      stage: nextStage,
      fullReindexCursor: nextCursor,
      lastProgressAt: new Date(),
    })
    .where(
      and(
        eq(ingestionRun.id, runId),
        eq(ingestionRun.status, "running"),
        eq(ingestionRun.activeSlot, 1),
        eq(ingestionRun.stage, "full_reindex_load"),
        cursor === null
          ? isNull(ingestionRun.fullReindexCursor)
          : eq(ingestionRun.fullReindexCursor, cursor),
      ),
    );
  if (updated.rowsAffected === 0) return { status: "stopped" };
  return {
    status: "paused",
    stage: nextStage,
    recordsProcessed: records.length,
  };
}

async function publishFullReindex(
  runId: string,
  runStartedAt: Date,
): Promise<DurableAlgoliaProjectionBatchResult> {
  return publishFullReindexForRun({
    runId,
    runStartedAt,
    database,
    algolia: algoliaClient,
    indexName: ALGOLIA_INDEX_NAME,
  });
}

async function resumeFailedFullReindexPublish(
  runId: string,
): Promise<DurableAlgoliaProjectionBatchResult> {
  const resumed = await database
    .update(ingestionRun)
    .set({
      stage: "full_reindex_publish",
      lastProgressAt: new Date(),
    })
    .where(
      and(
        eq(ingestionRun.id, runId),
        eq(ingestionRun.status, "running"),
        eq(ingestionRun.activeSlot, 1),
        eq(ingestionRun.stage, "full_reindex_publish_failed"),
      ),
    );
  if (resumed.rowsAffected === 0) return { status: "stopped" };
  return {
    status: "paused",
    stage: "full_reindex_publish",
    recordsProcessed: 0,
  };
}

async function projectChangeBatch(
  runId: string,
  cursor: number,
  configureIndex: boolean,
): Promise<DurableAlgoliaProjectionBatchResult> {
  const changes = await database
    .select({
      id: vehicleChange.id,
      vin: vehicleChange.vin,
      changeType: vehicleChange.changeType,
    })
    .from(vehicleChange)
    .where(and(eq(vehicleChange.runId, runId), gt(vehicleChange.id, cursor)))
    .orderBy(asc(vehicleChange.id))
    .limit(DURABLE_PROJECTOR_BATCH_SIZE);
  if (changes.length === 0) {
    const publishedAt = new Date();
    const published = await database
      .update(ingestionRun)
      .set({
        stage: "match_alerts",
        searchPublishedAt: publishedAt,
        lastProgressAt: publishedAt,
      })
      .where(
        and(
          eq(ingestionRun.id, runId),
          eq(ingestionRun.status, "running"),
          eq(ingestionRun.activeSlot, 1),
          eq(ingestionRun.stage, "project_changes"),
          eq(ingestionRun.projectorCursor, cursor),
        ),
      );
    if (published.rowsAffected === 0) return { status: "stopped" };
    return { status: "complete", searchPublishedAt: publishedAt };
  }

  const { deleteVins, upsertVins } = partitionVehicleChanges(changes);
  const records = await readAlgoliaVehicleRecords(upsertVins);
  await runIngestionEffect(
    syncToAlgoliaEffect(records, deleteVins, { configureIndex }),
  );
  const nextCursor = changes.at(-1)?.id ?? cursor;
  const changeIds = changes.map((change) => change.id);
  const now = Date.now();
  const results = await dbClient.batch(
    [
      {
        sql: `
          update vehicle_change
          set processed_at = ?
          where id in (${changeIds.map(() => "?").join(", ")})
            and exists (
              select 1 from ingestion_run
              where id = ?
                and status = 'running'
                and active_slot = 1
                and stage = 'project_changes'
                and projector_cursor = ?
            )
        `,
        args: [now, ...changeIds, runId, cursor],
      },
      {
        sql: `
          update ingestion_run
          set projector_cursor = ?, last_progress_at = ?
          where id = ?
            and status = 'running'
            and active_slot = 1
            and stage = 'project_changes'
            and projector_cursor = ?
        `,
        args: [nextCursor, now, runId, cursor],
      },
    ],
    "write",
  );
  const checkpointed = results[1];
  if (!checkpointed) {
    throw new Error(`Algolia projection ${runId} returned no checkpoint.`);
  }
  if (checkpointed.rowsAffected === 0) return { status: "stopped" };
  return {
    status: "paused",
    stage: "project_changes",
    recordsProcessed: changes.length,
  };
}

export async function runDurableAlgoliaProjectionBatch(
  runId: string,
  options?: { configureIndex?: boolean },
): Promise<DurableAlgoliaProjectionBatchResult> {
  const [run] = await database
    .select({
      stage: ingestionRun.stage,
      projectorCursor: ingestionRun.projectorCursor,
      fullReindexCursor: ingestionRun.fullReindexCursor,
      searchPublishedAt: ingestionRun.searchPublishedAt,
      status: ingestionRun.status,
      activeSlot: ingestionRun.activeSlot,
      startedAt: ingestionRun.startedAt,
    })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, runId))
    .limit(1);
  if (!run) throw new Error(`Ingestion run ${runId} does not exist.`);
  if (run.status !== "running" || run.activeSlot !== 1) {
    return { status: "stopped" };
  }
  switch (run.stage) {
    case "full_reindex_prepare":
      return prepareFullReindex(runId);
    case "full_reindex_load":
      return loadFullReindexBatch(runId, run.fullReindexCursor);
    case "full_reindex_publish":
    case "full_reindex_move_pending":
      return publishFullReindex(runId, run.startedAt);
    case "full_reindex_publish_failed":
      return resumeFailedFullReindexPublish(runId);
    case "project_changes":
      return projectChangeBatch(
        runId,
        run.projectorCursor,
        options?.configureIndex === true && run.projectorCursor === 0,
      );
    case "match_alerts":
    case "released":
      return {
        status: "complete",
        searchPublishedAt: run.searchPublishedAt ?? new Date(),
      };
    default:
      throw new Error(
        `Ingestion run ${runId} cannot project Algolia from stage ${run.stage}.`,
      );
  }
}

function dbEffect<A>(
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, PersistenceError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new PersistenceError({ operation, cause }),
  });
}

function ensureCheckpointRow(): Effect.Effect<
  void,
  PersistenceError,
  Database
> {
  return Effect.gen(function* () {
    const db = yield* Database;
    yield* dbEffect("algoliaProjector.ensureCheckpointRow", () =>
      db
        .insert(ingestionProjectorCheckpoint)
        .values({
          name: PROJECTOR_NAME,
        })
        .onConflictDoNothing({
          target: ingestionProjectorCheckpoint.name,
        }),
    );
  }).pipe(Effect.asVoid);
}

function getLastProcessedChangeId(): Effect.Effect<
  number,
  PersistenceError,
  Database
> {
  return Effect.gen(function* () {
    const db = yield* Database;
    const [checkpoint] = yield* dbEffect(
      "algoliaProjector.getLastProcessedChangeId",
      () =>
        db
          .select({
            lastProcessedChangeId:
              ingestionProjectorCheckpoint.lastProcessedChangeId,
          })
          .from(ingestionProjectorCheckpoint)
          .where(eq(ingestionProjectorCheckpoint.name, PROJECTOR_NAME))
          .limit(1),
    );
    return checkpoint?.lastProcessedChangeId ?? 0;
  });
}

function updateCheckpoint(
  lastProcessedChangeId: number,
): Effect.Effect<void, PersistenceError, Database> {
  return Effect.gen(function* () {
    const db = yield* Database;
    yield* dbEffect("algoliaProjector.updateCheckpoint", () =>
      db
        .update(ingestionProjectorCheckpoint)
        .set({
          lastProcessedChangeId,
          updatedAt: new Date(),
        })
        .where(eq(ingestionProjectorCheckpoint.name, PROJECTOR_NAME)),
    );
  }).pipe(Effect.asVoid);
}

function fetchVehicleRecords(
  vins: string[],
): Effect.Effect<AlgoliaVehicleRecord[], PersistenceError, Database> {
  return Effect.gen(function* () {
    if (vins.length === 0) return [];
    const db = yield* Database;
    const uniqueVins = [...new Set(vins)];
    const rows: Array<typeof vehicle.$inferSelect> = [];

    for (
      let index = 0;
      index < uniqueVins.length;
      index += VIN_QUERY_CHUNK_SIZE
    ) {
      const vinChunk = uniqueVins.slice(index, index + VIN_QUERY_CHUNK_SIZE);
      const chunkRows = yield* dbEffect(
        "algoliaProjector.fetchVehicleRecords",
        () => db.select().from(vehicle).where(inArray(vehicle.vin, vinChunk)),
      );
      rows.push(...chunkRows);
    }

    return rows.map((row) =>
      toAlgoliaRecord(
        mapDbVehicleToCanonical(row),
        row.firstSeenAt,
        row.missingSinceAt,
        row.missingRunCount ?? 0,
      ),
    );
  });
}

function markChangesProcessed(
  changeIds: number[],
): Effect.Effect<void, PersistenceError, Database> {
  return Effect.gen(function* () {
    if (changeIds.length === 0) return;
    const db = yield* Database;

    for (
      let index = 0;
      index < changeIds.length;
      index += VIN_QUERY_CHUNK_SIZE
    ) {
      const idChunk = changeIds.slice(index, index + VIN_QUERY_CHUNK_SIZE);
      yield* dbEffect("algoliaProjector.markChangesProcessed", () =>
        db
          .update(vehicleChange)
          .set({
            processedAt: new Date(),
          })
          .where(
            and(
              inArray(vehicleChange.id, idChunk),
              isNull(vehicleChange.processedAt),
            ),
          ),
      );
    }
  }).pipe(Effect.asVoid);
}

export function runAlgoliaProjectorEffect(options?: {
  batchSize?: number;
  configureIndex?: boolean;
}): Effect.Effect<AlgoliaProjectorRunResult, PersistenceError, Database> {
  return Effect.gen(function* () {
    const db = yield* Database;
    const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE);
    const shouldConfigureIndex = options?.configureIndex === true;

    yield* ensureCheckpointRow();
    let lastProcessedChangeId = yield* getLastProcessedChangeId();

    let batchesProcessed = 0;
    let changesProcessed = 0;
    let upsertsSynced = 0;
    let deletesSynced = 0;

    while (true) {
      const changes = yield* dbEffect("algoliaProjector.readChanges", () =>
        db
          .select({
            id: vehicleChange.id,
            vin: vehicleChange.vin,
            changeType: vehicleChange.changeType,
          })
          .from(vehicleChange)
          .where(
            and(
              gt(vehicleChange.id, lastProcessedChangeId),
              isNull(vehicleChange.processedAt),
            ),
          )
          .orderBy(asc(vehicleChange.id))
          .limit(batchSize),
      );

      if (changes.length === 0) {
        break;
      }

      const { deleteVins, upsertVins } = partitionVehicleChanges(changes);

      const upsertRecords = yield* fetchVehicleRecords(upsertVins);
      yield* syncToAlgoliaEffect(upsertRecords, deleteVins, {
        configureIndex: shouldConfigureIndex && batchesProcessed === 0,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new PersistenceError({
              operation: "algoliaProjector.syncToAlgolia",
              cause,
            }),
        ),
      );

      const changeIds = changes.map((change) => change.id);
      yield* markChangesProcessed(changeIds);

      const batchLastId =
        changes[changes.length - 1]?.id ?? lastProcessedChangeId;
      lastProcessedChangeId = batchLastId;
      yield* updateCheckpoint(lastProcessedChangeId);

      batchesProcessed += 1;
      changesProcessed += changes.length;
      upsertsSynced += upsertRecords.length;
      deletesSynced += deleteVins.length;
    }

    return {
      batchesProcessed,
      changesProcessed,
      upsertsSynced,
      deletesSynced,
      lastProcessedChangeId,
    };
  });
}

export async function runAlgoliaProjector(options?: {
  batchSize?: number;
  configureIndex?: boolean;
}): Promise<AlgoliaProjectorRunResult> {
  return runIngestionEffect(runAlgoliaProjectorEffect(options));
}
