import { projectSearchVehicles } from "./vehicle-search-projection";
import { and, asc, count, eq, gt, inArray, isNull } from "drizzle-orm";
import { ALGOLIA_INDEX_NAME, getAlgoliaAdminClient } from "~/lib/algolia";
import { db as database, dbClient } from "~/lib/db";
import { ingestionRun, vehicle, vehicleChange } from "~/schema";
import { AlgoliaError } from "./algolia-error";
import {
  InPlaceRebuild,
  type InPlaceRebuildContext,
  type InPlaceStage,
} from "./algolia-inplace-rebuild";
import {
  mapDbVehicleToCanonical,
  partitionVehicleChanges,
} from "./algolia-projector-helpers";
import {
  RecordCapacity,
  type RecordCapacityListing,
} from "./algolia-record-capacity";
import {
  publishFullReindexForRun,
  withIndexGeneration,
} from "./durable-algolia-publish";
import {
  releasedProjection,
  releaseLegacyAlertMatchingRun,
  releaseProjectedRun,
  releaseToSearchProjector,
  type SearchProjectorHandoff,
} from "./projection-release";
import { PublicationModeFlag } from "./publication-mode-flag";
import {
  rebuildIndexName,
  discardFailedRebuild,
  cleanupInactiveRunRebuild,
  clearLeftoverRebuildIndices,
  deleteRebuildIndex,
} from "./algolia-rebuild-index";
import { runIngestionEffect } from "./runtime";
import { syncToAlgoliaEffect } from "./sync-algolia";

export { mapDbVehicleToCanonical, partitionVehicleChanges };

const DURABLE_PROJECTOR_BATCH_SIZE = 500;

export type DurableAlgoliaProjectionBatchResult =
  | { status: "stopped" }
  | {
      status: "paused";
      stage:
        | "project_changes"
        | "full_reindex_load"
        | InPlaceStage
        | "full_reindex_publish";
      recordsProcessed: number;
    }
  | { status: "complete"; searchPublishedAt: Date }
  | SearchProjectorHandoff
  | { status: "mode_unavailable" };

async function waitForAlgoliaTask(indexName: string, taskID: number) {
  await getAlgoliaAdminClient().waitForTask({ indexName, taskID });
}

async function markIndexGeneration(indexName: string, runId: string) {
  const settings = await getAlgoliaAdminClient().getSettings({ indexName });
  const userData = withIndexGeneration(settings.userData, runId);
  if (!userData.success) {
    throw new Error(
      `Algolia index ${indexName} has incompatible userData; cannot record rebuild generation ${runId}.`,
    );
  }
  const updated = await getAlgoliaAdminClient().setSettings({
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
  return projectSearchVehicles(database, rows);
}

/** Every index's record count, all pages. An admin call, not a search. */
async function listIndexEntries(): Promise<RecordCapacityListing[]> {
  const listing: RecordCapacityListing[] = [];
  for (let page = 0; ; page += 1) {
    const result = await getAlgoliaAdminClient().listIndices({
      page,
      hitsPerPage: 100,
    });
    for (const index of result.items) {
      listing.push({
        name: index.name,
        entries: index.entries,
        virtual: index.virtual === true,
      });
    }
    const lastPage =
      result.nbPages === undefined
        ? result.items.length < 100
        : page + 1 >= result.nbPages;
    if (lastPage) return listing;
  }
}

/** Whether this run's copy of the live index fits under the record cap. */
async function copyCapacity(runId: string): Promise<RecordCapacity> {
  const [counted] = await database.select({ vehicles: count() }).from(vehicle);
  return RecordCapacity.forCopy({
    listing: await listIndexEntries(),
    // A copy left by this run's earlier attempt is cleared before loading.
    exclude: [rebuildIndexName(runId, ALGOLIA_INDEX_NAME)],
    vehicles: counted?.vehicles ?? 0,
    limit: RecordCapacity.limit(),
  });
}

/**
 * Sends a run from the copy path to the in-place rebuild. Its partial copy
 * is deleted first, since the in-place load needs those records; when that
 * fails the run stays on the copy path, so the retried step (refused for
 * quota again) deletes and routes again. Resolves null when the run is no
 * longer in `from`.
 */
async function routeInPlace(
  runId: string,
  from: readonly string[],
  reason: string,
): Promise<DurableAlgoliaProjectionBatchResult | null> {
  const copy = await deleteRebuildIndex(
    getAlgoliaAdminClient(),
    ALGOLIA_INDEX_NAME,
    runId,
  );
  if (copy === "blocked") {
    throw new Error(
      `Full reindex ${runId} must rebuild ${ALGOLIA_INDEX_NAME} in place (${reason}), but its partial copy ${rebuildIndexName(runId, ALGOLIA_INDEX_NAME)} could not be deleted because the Algolia app is blocked. Live search and Turso are intact. The step retries and switches in place once Algolia accepts writes again.`,
    );
  }
  if (!(await InPlaceRebuild.route({ database, runId, from }))) return null;
  console.warn(
    `[Algolia] Full reindex ${runId} rebuilds ${ALGOLIA_INDEX_NAME} in place instead of copying it: ${reason} Live search stays up and Turso is unchanged; records are rewritten in VIN order, then stale ones are swept.`,
  );
  return {
    status: "paused",
    stage: "full_reindex_inplace_load",
    recordsProcessed: 0,
  };
}

function inPlaceContext(
  runId: string,
  runStartedAt: Date,
): InPlaceRebuildContext {
  return {
    runId,
    runStartedAt,
    database,
    algolia: getAlgoliaAdminClient(),
    indexName: ALGOLIA_INDEX_NAME,
    project: (rows) => projectSearchVehicles(database, rows),
  };
}

async function prepareFullReindex(
  runId: string,
): Promise<DurableAlgoliaProjectionBatchResult> {
  const temporaryIndex = rebuildIndexName(runId, ALGOLIA_INDEX_NAME);
  // Abandoned or failed runs leave their copies for later cleanup. Remove them
  // before this copy fills, so the app stays under its record cap.
  await clearLeftoverRebuildIndices({
    database,
    algolia: getAlgoliaAdminClient(),
    indexName: ALGOLIA_INDEX_NAME,
  });
  const capacity = await copyCapacity(runId);
  if (capacity.kind === "over_cap") {
    return (
      (await routeInPlace(
        runId,
        ["full_reindex_prepare"],
        RecordCapacity.describe(capacity),
      )) ?? { status: "stopped" }
    );
  }
  const copied = await getAlgoliaAdminClient().operationIndex({
    indexName: ALGOLIA_INDEX_NAME,
    operationIndexParams: {
      operation: "copy",
      destination: temporaryIndex,
      scope: ["settings", "synonyms", "rules"],
    },
  });
  await waitForAlgoliaTask(temporaryIndex, copied.taskID);
  const cleared = await getAlgoliaAdminClient().clearObjects({
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
  const records = await projectSearchVehicles(database, rows);
  if (records.length > 0) {
    await runIngestionEffect(
      syncToAlgoliaEffect(records, [], {
        indexName: rebuildIndexName(runId, ALGOLIA_INDEX_NAME),
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
    algolia: getAlgoliaAdminClient(),
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
    return releaseProjectedRun({
      database,
      runId,
      projectorCursor: cursor,
      now: new Date(),
    });
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
          delete from vehicle_change_v2
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
        args: [...changeIds, runId, cursor],
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

async function projectDurableAlgoliaBatch(
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
  const released = releasedProjection(run);
  if (released) return released;
  if (run.status !== "running" || run.activeSlot !== 1) {
    return { status: "stopped" };
  }
  switch (run.stage) {
    case "full_reindex_prepare":
      return prepareFullReindex(runId);
    case "full_reindex_load":
      return loadFullReindexBatch(runId, run.fullReindexCursor);
    case "full_reindex_inplace_load":
    case "full_reindex_inplace_sweep":
      return InPlaceRebuild.step(inPlaceContext(runId, run.startedAt), {
        stage: run.stage,
        fullReindexCursor: run.fullReindexCursor,
      });
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
      return releaseLegacyAlertMatchingRun({
        database,
        runId,
        searchPublishedAt: run.searchPublishedAt,
        now: new Date(),
      });
    default:
      throw new Error(
        `Ingestion run ${runId} cannot project Algolia from stage ${run.stage}.`,
      );
  }
}

/**
 * Algolia refused a rebuild write over its record quota. A copy fails the
 * same way on every retry, so it is never discarded and restarted: the run
 * rebuilds in place instead. An in-place rebuild cannot shrink further, so
 * it fails with the counts and recovery, keeping its cursor; the failure
 * counts toward abandoning the run. Resolves null for any other stage.
 */
async function overRecordQuota(
  runId: string,
  detail: string,
  error: unknown,
): Promise<DurableAlgoliaProjectionBatchResult | null> {
  const [run] = await database
    .select({ stage: ingestionRun.stage })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, runId))
    .limit(1);
  const stage = run?.stage;
  if (stage === "full_reindex_prepare" || stage === "full_reindex_load") {
    const capacity = await copyCapacity(runId).then(
      (read) => RecordCapacity.describe(read),
      () => "The record count could not be read.",
    );
    return routeInPlace(
      runId,
      ["full_reindex_prepare", "full_reindex_load"],
      `Algolia refused the copy (${detail}). ${capacity}`,
    );
  }
  if (stage === undefined || !isInPlaceStage(stage)) return null;
  const counts = await Promise.all([
    listIndexEntries(),
    database.select({ vehicles: count() }).from(vehicle),
  ]).then(
    ([listing, [counted]]) =>
      RecordCapacity.describeInPlace({
        listing,
        indexName: ALGOLIA_INDEX_NAME,
        vehicles: counted?.vehicles ?? 0,
        limit: RecordCapacity.limit(),
      }),
    () => "The record counts could not be read.",
  );
  throw new Error(
    `In-place search rebuild ${runId} at ${stage} was refused by Algolia over the record quota (${detail}). ${counts} Live search and Turso are intact, and the rebuild keeps its cursor. Free records (delete leftover ${ALGOLIA_INDEX_NAME}__rebuild_* copies or other unneeded indices) or raise the Algolia plan and ALGOLIA_RECORD_LIMIT; the step retries, and repeated failures abandon the run, leaving the rebuild owed by the next run.`,
    { cause: error },
  );
}

function isInPlaceStage(stage: string): stage is InPlaceStage {
  return InPlaceRebuild.stages.some((inPlace) => inPlace === stage);
}

export async function runDurableAlgoliaProjectionBatch(
  runId: string,
  options?: { configureIndex?: boolean },
): Promise<DurableAlgoliaProjectionBatchResult> {
  const cleanup = {
    runId,
    database,
    algolia: getAlgoliaAdminClient(),
    indexName: ALGOLIA_INDEX_NAME,
  };
  // Decoupled, the search projector is the only search writer. A run that
  // entered an inline stage before the switch hands its changes over instead
  // of writing them, so the projector never races an inline writer. An
  // unreadable mode returns before anything is written or discarded; the run
  // waits and retries without counting a failure, and the projector also
  // waits while the mode is unreadable.
  const mode = await PublicationModeFlag.mode();
  if (mode === "unavailable") return { status: "mode_unavailable" };
  if (mode === "decoupled") {
    const handoff = await releaseToSearchProjector({
      database,
      runId,
      now: new Date(),
    });
    if (handoff) return handoff;
  }
  try {
    const result = await projectDurableAlgoliaBatch(runId, options);
    if (result.status === "stopped") await cleanupInactiveRunRebuild(cleanup);
    return result;
  } catch (error) {
    const failure = AlgoliaError.classify(
      { operation: "full reindex", indexName: ALGOLIA_INDEX_NAME },
      error,
    );
    // Operation or search quotas say nothing about room for records.
    if (
      failure._tag === "QuotaExceeded" &&
      RecordCapacity.isRecordQuota(failure.detail)
    ) {
      const routed = await overRecordQuota(runId, failure.detail, error);
      if (routed) return routed;
    }
    try {
      await discardFailedRebuild(cleanup);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Algolia rebuild ${runId} failed and its temporary index could not be removed. Retry ingestion to rebuild and clean up the copy.`,
        { cause: error },
      );
    }
    throw error;
  }
}
