import type { DurableWorkflowCursor } from "~/server/ingestion/durable-workflow-cursor";
import { warmVinCacheBatch } from "~/server/ingestion/vin-cache-warmer";
import type { VinCachePassState } from "~/server/ingestion/vin-cache-pass";
import { FatalError, getStepMetadata } from "workflow";
import { formatError, throwRetryableStepError } from "./step-errors";
import { resumeHook } from "workflow/api";
import { expireInventoryCaches } from "~/lib/inventory-cache-expiry";
import { db } from "~/lib/db";
import { SearchPublicationFlag } from "~/server/ingestion/search-publication-flag";
import * as Sentry from "@sentry/nextjs";
import {
  runDailySearchAlertCheckBatch,
  touchDailySearchAlertCheck,
} from "~/server/alerts/search-alert-check-runtime";
import { runDurableAlgoliaProjectionBatch } from "~/server/ingestion/algolia-projector";
import {
  cleanupDurableIngestionStateBatch,
  compactDurableWorkflowCursor,
  resolveDurableWorkflowCursor,
  cleanupStaleDurableAlgoliaRebuilds,
  attachDurableIngestionWorkflow,
  claimDurableIngestionCommit,
  listDurableIngestionCommitWaiters,
  prepareIngestionPass,
  initializeDurableIngestion,
  markDurableSourceFailed,
  persistDurableIngestionFailure,
  reconcileDurableIngestion,
  reportDurableProviderStatus,
  runDurableSourceChunk,
  validateDurableIngestionSources,
} from "~/server/ingestion/durable-ingestion";
import {
  durableSourceChunkProgressError,
  type DurableIngestionSource,
} from "~/server/ingestion/durable-source";
import {
  finalizeSearchIndexMigration,
  initializeSearchIndexMigration,
  migrateSearchIndexBatch,
  SearchIndexMigrationValidationError,
  type SearchIndexMigrationState,
} from "~/server/ingestion/search-index-migration";
import type { IngestionRunReport } from "~/server/ingestion/ingestion-pass-orchestrator";
import { IngestionTokens } from "./ingestion-tokens";
import {
  recordDurableRunFailure,
  recordDurableSourceRejections,
  recordUrgiisBlockedTenant,
} from "./vehicle-observability";

export async function initializeDurableIngestionStep(runId: string) {
  "use step";

  console.info("[Workflow] Initializing vehicle ingestion", { runId });
  try {
    const result = await initializeDurableIngestion(runId);
    if (result.status !== "started") return result;
    return {
      ...result,
      initialCursors: await Promise.all(
        result.initialCursors.map((cursor) =>
          compactDurableWorkflowCursor(runId, cursor),
        ),
      ),
    };
  } catch (error) {
    throwRetryableStepError("Vehicle ingestion initialization", error);
  }
}
initializeDurableIngestionStep.maxRetries = 2;

export async function prepareIngestionPassStep(day: string) {
  "use step";

  try {
    return await prepareIngestionPass(day);
  } catch (error) {
    throwRetryableStepError(`Plan ingestion pass ${day}`, error);
  }
}
prepareIngestionPassStep.maxRetries = 2;

/** Reports a stopped source run to its pass, if the pass is listening. */
export async function reportIngestionRunStep(
  day: string,
  report: IngestionRunReport,
) {
  "use step";

  try {
    await resumeHook(IngestionTokens.passReports(day), report);
  } catch (error) {
    // The pass ended or has not registered yet; its next plan sees the run.
    console.warn(
      `[Workflow] Could not report run ${report.runId} to the ${day} pass: ${formatError(error)}`,
    );
  }
}

/** Wakes runs waiting for the shared commit after it is released. */
export async function signalCommitWaitersStep() {
  "use step";

  let waiters: string[];
  try {
    waiters = await listDurableIngestionCommitWaiters();
  } catch (error) {
    throwRetryableStepError("List ingestion commit waiters", error);
  }
  await Promise.all(
    waiters.map((runId) =>
      // A waiter that has not registered its hook rechecks on its own timer.
      resumeHook(IngestionTokens.commitTurn(runId), null).catch(
        () => undefined,
      ),
    ),
  );
}
signalCommitWaitersStep.maxRetries = 2;

export async function claimDurableIngestionCommitStep(runId: string) {
  "use step";

  try {
    return await claimDurableIngestionCommit(runId);
  } catch (error) {
    throwRetryableStepError("Claim durable ingestion commit", error);
  }
}
claimDurableIngestionCommitStep.maxRetries = 2;

export async function attachDurableIngestionWorkflowStep(
  runId: string,
  workflowRunId: string,
) {
  "use step";

  try {
    await attachDurableIngestionWorkflow(runId, workflowRunId);
  } catch (error) {
    throwRetryableStepError("Attach durable ingestion workflow", error);
  }
}
attachDurableIngestionWorkflowStep.maxRetries = 2;

export async function validateDurableIngestionSourcesStep(runId: string) {
  "use step";

  try {
    return await recordDurableSourceRejections({
      runId,
      validate: () => validateDurableIngestionSources(runId),
    });
  } catch (error) {
    throwRetryableStepError("Validate durable ingestion sources", error);
  }
}
validateDurableIngestionSourcesStep.maxRetries = 2;

export async function runDurableSourceChunkStep<
  Source extends DurableIngestionSource,
>(runId: string, cursor: DurableWorkflowCursor<Source>) {
  "use step";

  console.info("[Workflow] Starting source chunk", {
    runId,
    source: cursor.source,
  });
  const requestedCursor = await resolveDurableWorkflowCursor(runId, cursor);
  const result = await runDurableSourceChunk({
    runId,
    cursor: requestedCursor,
  }).catch((error: unknown) => {
    try {
      Sentry.logger.warn("Vehicle ingestion source attempt failed", {
        runId,
        source: cursor.source,
        attempt: getStepMetadata().attempt,
        error: formatError(error).slice(0, 500),
      });
    } catch (reportError) {
      console.error("Failed to report vehicle source retry", reportError);
    }
    return throwRetryableStepError(
      `Vehicle source chunk ${cursor.source}/${JSON.stringify(cursor)}`,
      error,
    );
  });
  if (result.status === "deferred") {
    // Nothing was checkpointed; the source workflow retries this cursor.
    console.warn("[Workflow] Deferred source chunk", {
      runId,
      source: cursor.source,
      message: result.message,
    });
    return { ...result, cursor };
  }
  recordUrgiisBlockedTenant({
    runId,
    before: requestedCursor,
    after: result.cursor,
  });
  console.info("[Workflow] Completed source chunk", {
    source: result.cursor.source,
    status: result.status,
    count: result.count,
  });
  const progressError = durableSourceChunkProgressError(
    requestedCursor,
    result,
  );
  if (progressError) throw new FatalError(progressError);
  return {
    ...result,
    cursor: await compactDurableWorkflowCursor(runId, result.cursor),
  };
}
runDurableSourceChunkStep.maxRetries = 2;

export async function markDurableSourceFailedStep<
  Source extends DurableIngestionSource,
>(runId: string, source: Source, message: string) {
  "use step";

  try {
    const result = await markDurableSourceFailed({ runId, source, message });
    return {
      ...result,
      cursor: await compactDurableWorkflowCursor(runId, result.cursor),
    };
  } catch (error) {
    throwRetryableStepError(`Mark vehicle source ${source} failed`, error);
  }
}
markDurableSourceFailedStep.maxRetries = 2;

export async function reconcileDurableIngestionStep(runId: string) {
  "use step";

  console.info("[Workflow] Starting durable ingestion reconciliation", {
    runId,
  });
  try {
    const result = await reconcileDurableIngestion(runId);
    console.info("[Workflow] Durable ingestion reconciliation progress", {
      runId,
      status: result.status,
    });
    return result;
  } catch (error) {
    throwRetryableStepError("Durable ingestion reconciliation", error);
  }
}
reconcileDurableIngestionStep.maxRetries = 2;

export async function markDurableIngestionFailedStep(
  runId: string,
  message: string,
) {
  "use step";

  try {
    await recordDurableRunFailure({
      runId,
      message,
      markFailed: () => persistDurableIngestionFailure(runId, message),
    });
  } catch (error) {
    throwRetryableStepError("Mark durable ingestion failed", error);
  }
}
markDurableIngestionFailedStep.maxRetries = 2;

export async function cleanupStaleDurableAlgoliaRebuildsStep() {
  "use step";

  try {
    await cleanupStaleDurableAlgoliaRebuilds();
  } catch (error) {
    throwRetryableStepError("Cleanup stale Algolia rebuild indices", error);
  }
}
cleanupStaleDurableAlgoliaRebuildsStep.maxRetries = 2;

export async function runAlgoliaProjectorStep(runId: string) {
  "use step";

  console.info("[Workflow] Starting Algolia projector");
  try {
    const result = await runDurableAlgoliaProjectionBatch(runId, {
      configureIndex: process.env.ALGOLIA_CONFIGURE_ON_INGEST === "1",
    });
    console.info("[Workflow] Algolia projector progress", { runId, result });
    return result;
  } catch (error) {
    throwRetryableStepError("Algolia projector", error);
  }
}
runAlgoliaProjectorStep.maxRetries = 2;

export async function runSearchAlertCheckBatchStep(day: string) {
  "use step";

  try {
    const result = await runDailySearchAlertCheckBatch(day);
    console.info("[Workflow] Saved search alert check progress", {
      day,
      result,
    });
    return result;
  } catch (error) {
    throwRetryableStepError(
      `Saved search alert check for ${day} (its cursor and every saved search's alert window are preserved for the next attempt)`,
      error,
    );
  }
}
runSearchAlertCheckBatchStep.maxRetries = 2;

/**
 * Heartbeats the day's check while its batch waits for the search writer.
 * A failed heartbeat only lets delivery stop holding earlier intents sooner,
 * as a stale check does, so the wait continues.
 */
export async function touchSearchAlertCheckStep(day: string) {
  "use step";

  try {
    await touchDailySearchAlertCheck(day);
  } catch (error) {
    console.warn(
      `[Workflow] Could not record that the ${day} alert check is waiting for the search writer; earlier intents may be delivered before its digest: ${formatError(error)}`,
    );
  }
}
touchSearchAlertCheckStep.maxRetries = 0;

/** Updates the provider's status page row; never fails the run. */
export async function reportProviderStatusStep(runId: string) {
  "use step";

  try {
    await reportDurableProviderStatus(runId);
  } catch (error) {
    console.error(
      `[Workflow] Could not update the status page for run ${runId}; the ingestion result is unaffected: ${formatError(error)}`,
    );
  }
}

export async function cleanupDurableIngestionStateBatchStep(runId: string) {
  "use step";

  try {
    return await cleanupDurableIngestionStateBatch(runId);
  } catch (error) {
    throwRetryableStepError("Cleanup durable ingestion state batch", error);
  }
}
cleanupDurableIngestionStateBatchStep.maxRetries = 2;

export async function initializeSearchIndexMigrationStep(force = false) {
  "use step";

  console.info("[Workflow] Initializing search index schema migration");
  try {
    return await initializeSearchIndexMigration(force);
  } catch (error) {
    throwRetryableStepError("Initialize search index schema migration", error);
  }
}
initializeSearchIndexMigrationStep.maxRetries = 2;

/** Whether search publication is frozen (`skipped`) or inline. */
export async function searchPublicationModeStep() {
  "use step";

  return await SearchPublicationFlag.maintenance();
}

export async function warmVinCacheBatchStep(state: VinCachePassState) {
  "use step";

  // Enrichment is optional. Even a cache database error must leave publication
  // free to read existing identities and publish source fallbacks.
  try {
    return await warmVinCacheBatch(db, state);
  } catch (error) {
    console.warn(
      `[VIN cache] Decode pass stopped; publication uses cached identities or source names: ${formatError(error)}`,
    );
    return { status: "unavailable" as const, state };
  }
}
warmVinCacheBatchStep.maxRetries = 0;

export async function runSearchIndexMigrationBatchStep(
  state: SearchIndexMigrationState,
) {
  "use step";

  try {
    const result = await migrateSearchIndexBatch(state, 10_000);
    console.info("[Workflow] Search index migration progress", {
      batchesProcessed: result.state.batchesProcessed,
      recordsProcessed: result.state.recordsProcessed,
      done: result.done,
    });
    return result;
  } catch (error) {
    throwRetryableStepError("Search index schema migration batch", error);
  }
}
runSearchIndexMigrationBatchStep.maxRetries = 2;

export async function finalizeSearchIndexMigrationStep(
  state: SearchIndexMigrationState,
) {
  "use step";

  try {
    const result = await finalizeSearchIndexMigration(state);
    // The migration rewrote identities on every source's vehicles.
    expireInventoryCaches({ kind: "all" });
    console.info("[Workflow] Completed search index schema migration", result);
    return result;
  } catch (error) {
    if (error instanceof SearchIndexMigrationValidationError) {
      console.error(
        "[Workflow] Search index migration validation failed",
        error,
      );
      throw new FatalError(error.message);
    }
    throwRetryableStepError("Finalize search index schema migration", error);
  }
}
finalizeSearchIndexMigrationStep.maxRetries = 2;
