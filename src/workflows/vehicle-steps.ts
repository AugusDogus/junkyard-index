import { FatalError, RetryableError, getStepMetadata } from "workflow";
import {
  deliverDurableAlertIntentsBatch,
  runDurableAlertMatchingBatch,
} from "~/server/alerts/durable-search-alerts";
import { runDurableAlgoliaProjectionBatch } from "~/server/ingestion/algolia-projector";
import {
  cleanupDurableIngestionSnapshotBatch,
  cleanupStaleDurableIngestionSnapshots,
  attachDurableIngestionWorkflow,
  initializeDurableIngestion,
  markDurableIngestionFailed,
  markDurableSourceFailed,
  reconcileDurableIngestion,
  reportDurableIngestionHealth,
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
import {
  DurableSourceFailure,
  recordDurableSourceFailure,
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
    return await validateDurableIngestionSources(runId);
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
    return await recordDurableSourceFailure({
      failure: DurableSourceFailure.make({ runId, source, message }),
      markFailed: () => markDurableSourceFailed({ runId, source, message }),
    });
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
    await markDurableIngestionFailed(runId, message);
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
    if (result.status === "complete") {
      await reportDurableIngestionHealth(runId);
    }
    console.info("[Workflow] Vehicle search alert matching progress", result);
    return result;
  } catch (error) {
    throwRetryableStepError("Vehicle search alert matching", error);
  }
}
runVehicleSearchAlertsStep.maxRetries = 2;

export async function deliverVehicleSearchAlertIntentsStep() {
  "use step";

  try {
    return await deliverDurableAlertIntentsBatch();
  } catch (error) {
    throwRetryableStepError("Vehicle search alert delivery", error);
  }
}
deliverVehicleSearchAlertIntentsStep.maxRetries = 2;

export async function cleanupDurableIngestionSnapshotBatchStep(runId: string) {
  "use step";

  try {
    return await cleanupDurableIngestionSnapshotBatch(runId);
  } catch (error) {
    throwRetryableStepError("Cleanup durable ingestion snapshot batch", error);
  }
}
cleanupDurableIngestionSnapshotBatchStep.maxRetries = 2;

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
    const result = await migrateSearchIndexBatch(state, 1000);
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
