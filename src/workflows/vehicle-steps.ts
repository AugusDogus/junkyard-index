import { FatalError, RetryableError, getStepMetadata } from "workflow";
import { revalidateTag } from "next/cache";
import { resumeHook } from "workflow/api";
import { HOMEPAGE_CACHE_TAG } from "~/lib/homepage-stats";
import * as Sentry from "@sentry/nextjs";
import { deliverDurableAlertIntentsBatch } from "~/server/alerts/durable-alert-delivery-runtime";
import { runDurableAlertMatchingBatch } from "~/server/alerts/durable-search-alerts";
import { runDurableAlgoliaProjectionBatch } from "~/server/ingestion/algolia-projector";
import {
  cleanupDurableIngestionStateBatch,
  cleanupStaleDurableIngestionSnapshots,
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
import type {
  DurableCursorFor,
  DurableIngestionSource,
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
} from "./vehicle-observability";

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function throwRetryableStepError(operation: string, error: unknown): never {
  console.error(`[Workflow] ${operation} failed`, error);
  const { attempt } = getStepMetadata();
  const baseDelayMs = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  const retryAfter = Math.round(baseDelayMs * (0.5 + Math.random()));
  throw new RetryableError(`${operation} failed: ${formatError(error)}`, {
    retryAfter,
  });
}

export async function initializeDurableIngestionStep(runId: string) {
  "use step";

  console.info("[Workflow] Initializing vehicle ingestion", { runId });
  try {
    return await initializeDurableIngestion(runId);
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

/** Shows the day's published inventory on the homepage. */
export async function refreshHomepageStep() {
  "use step";

  try {
    revalidateTag(HOMEPAGE_CACHE_TAG, "max");
  } catch (error) {
    // The homepage caches still expire within a day.
    console.error(
      `[Workflow] Could not refresh the homepage cache: ${formatError(error)}`,
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
>(runId: string, cursor: DurableCursorFor<Source>) {
  "use step";

  console.info("[Workflow] Starting source chunk", { runId, cursor });
  try {
    const result = await runDurableSourceChunk({ runId, cursor });
    console.info("[Workflow] Completed source chunk", result);
    return result;
  } catch (error) {
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
    throwRetryableStepError(
      `Vehicle source chunk ${cursor.source}/${JSON.stringify(cursor)}`,
      error,
    );
  }
}
runDurableSourceChunkStep.maxRetries = 2;

export async function markDurableSourceFailedStep<
  Source extends DurableIngestionSource,
>(runId: string, source: Source, message: string) {
  "use step";

  try {
    return await markDurableSourceFailed({ runId, source, message });
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

export async function cleanupStaleDurableIngestionSnapshotsStep() {
  "use step";

  try {
    await cleanupStaleDurableIngestionSnapshots();
  } catch (error) {
    throwRetryableStepError("Cleanup stale durable ingestion snapshots", error);
  }
}
cleanupStaleDurableIngestionSnapshotsStep.maxRetries = 2;

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

export async function runVehicleSearchAlertsStep(runId: string) {
  "use step";

  console.info("[Workflow] Matching vehicle search alerts", { runId });
  try {
    const result = await runDurableAlertMatchingBatch(runId);
    console.info("[Workflow] Vehicle search alert matching progress", result);
    return result;
  } catch (error) {
    throwRetryableStepError("Vehicle search alert matching", error);
  }
}
runVehicleSearchAlertsStep.maxRetries = 2;

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

export async function deliverVehicleSearchAlertIntentsStep() {
  "use step";

  try {
    return await deliverDurableAlertIntentsBatch();
  } catch (error) {
    throwRetryableStepError("Vehicle search alert delivery", error);
  }
}
deliverVehicleSearchAlertIntentsStep.maxRetries = 2;

export async function cleanupDurableIngestionStateBatchStep(runId: string) {
  "use step";

  try {
    return await cleanupDurableIngestionStateBatch(runId);
  } catch (error) {
    throwRetryableStepError("Cleanup durable ingestion state batch", error);
  }
}
cleanupDurableIngestionStateBatchStep.maxRetries = 2;

export async function initializeSearchIndexMigrationStep() {
  "use step";

  console.info("[Workflow] Initializing search index schema migration");
  try {
    return await initializeSearchIndexMigration();
  } catch (error) {
    throwRetryableStepError("Initialize search index schema migration", error);
  }
}
initializeSearchIndexMigrationStep.maxRetries = 2;

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
