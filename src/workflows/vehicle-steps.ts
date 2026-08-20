import * as Sentry from "@sentry/nextjs";
import { FatalError, RetryableError, getStepMetadata } from "workflow";
import { runSearchAlerts } from "~/server/alerts/run-search-alerts";
import { runAlgoliaProjector } from "~/server/ingestion/algolia-projector";
import {
  cleanupDurableIngestionSnapshots,
  cleanupStaleDurableIngestionSnapshots,
  initializeDurableIngestion,
  markDurableIngestionFailed,
  markDurableSourceFailed,
  reconcileDurableIngestion,
  runDurableSourceChunk,
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
    const result = await markDurableSourceFailed({ runId, source, message });
    Sentry.captureException(new Error(message), {
      tags: {
        ingestion_source: source,
        workflow: "vehicle-ingestion",
      },
      extra: { runId },
    });
    return result;
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
    console.info("[Workflow] Completed durable ingestion reconciliation", {
      runId,
      totalUpserted: result.totalUpserted,
      totalDeleted: result.totalDeleted,
      errorCount: result.errors.length,
      durationMs: result.durationMs,
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

export async function cleanupDurableIngestionSnapshotsStep(runId: string) {
  "use step";

  try {
    await cleanupDurableIngestionSnapshots(runId);
  } catch (error) {
    throwRetryableStepError("Cleanup durable ingestion snapshots", error);
  }
}
cleanupDurableIngestionSnapshotsStep.maxRetries = 2;

export async function cleanupStaleDurableIngestionSnapshotsStep() {
  "use step";

  try {
    await cleanupStaleDurableIngestionSnapshots();
  } catch (error) {
    throwRetryableStepError("Cleanup stale durable ingestion snapshots", error);
  }
}
cleanupStaleDurableIngestionSnapshotsStep.maxRetries = 2;

export async function runAlgoliaProjectorStep() {
  "use step";

  console.info("[Workflow] Starting Algolia projector");
  try {
    const result = await runAlgoliaProjector({
      batchSize: 1000,
      configureIndex: process.env.ALGOLIA_CONFIGURE_ON_INGEST === "1",
    });
    console.info("[Workflow] Completed Algolia projector", result);
    return result;
  } catch (error) {
    throwRetryableStepError("Algolia projector", error);
  }
}
runAlgoliaProjectorStep.maxRetries = 2;

export async function runVehicleSearchAlertsStep() {
  "use step";

  console.info("[Workflow] Starting vehicle search alerts");
  try {
    const result = await runSearchAlerts("vercel-workflow");
    console.info("[Workflow] Completed vehicle search alerts", {
      selected: result.selected,
      processed: result.processed,
    });
    return result;
  } catch (error) {
    throwRetryableStepError("Vehicle search alerts", error);
  }
}
runVehicleSearchAlertsStep.maxRetries = 2;

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
