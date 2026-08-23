import { randomUUID } from "node:crypto";
import { deliverDurableAlertIntentsBatch } from "~/server/alerts/durable-alert-delivery-runtime";
import { runDurableAlertMatchingBatch } from "~/server/alerts/durable-search-alerts";
import { runDurableAlgoliaProjectionBatch } from "./algolia-projector";
import {
  cleanupDurableIngestionSnapshotBatch,
  cleanupStaleDurableIngestionSnapshots,
  initializeDurableIngestion,
  markDurableIngestionFailed,
  markDurableSourceFailed,
  reconcileDurableIngestion,
  reportDurableIngestionHealth,
  runDurableSourceChunk,
  type DurableIngestionResult,
  validateDurableIngestionSources,
} from "./durable-ingestion";
import { executeDurableIngestion } from "./durable-ingestion-orchestrator";
import {
  drainDurableCleanup,
  drainDurablePhase,
  runDurablePostReleaseLifecycle,
  runDurablePublicationLifecycle,
  runProjectionWithFailureRecording,
} from "./durable-post-ingestion-orchestrator";

export async function runIngestion(): Promise<DurableIngestionResult> {
  const runId = randomUUID();
  const execution = await executeDurableIngestion({
    runId,
    operations: {
      cleanupStale: cleanupStaleDurableIngestionSnapshots,
      initialize: initializeDurableIngestion,
      runChunk: (currentRunId, cursor) =>
        runDurableSourceChunk({ runId: currentRunId, cursor }),
      markFailed: (currentRunId, source, message) =>
        markDurableSourceFailed({ runId: currentRunId, source, message }),
      validateSources: validateDurableIngestionSources,
      reconcile: reconcileDurableIngestion,
      markRunFailed: markDurableIngestionFailed,
    },
  });
  if (execution.status === "deduplicated") {
    throw new Error(
      `Ingestion is already running${execution.activeRunId ? ` as ${execution.activeRunId}` : ""}. Wait for it to finish before starting another local run.`,
    );
  }
  if (execution.status === "stopped") {
    throw new Error(
      `Ingestion run ${runId} was stopped before publication completed.`,
    );
  }

  const publication = await runDurablePublicationLifecycle({
    runId,
    project: () =>
      runProjectionWithFailureRecording({
        runId,
        runBatch: () =>
          runDurableAlgoliaProjectionBatch(runId, {
            configureIndex: process.env.ALGOLIA_CONFIGURE_ON_INGEST === "1",
          }),
        markFailed: async (failedRunId, error) => {
          await markDurableIngestionFailed(failedRunId, error);
        },
      }),
    matchAlerts: () =>
      drainDurablePhase(() => runDurableAlertMatchingBatch(runId)),
    reportHealth: reportDurableIngestionHealth,
  });
  if (publication.status === "stopped") {
    throw new Error(
      `Ingestion run ${runId} was stopped during ${publication.phase}.`,
    );
  }

  await runDurablePostReleaseLifecycle({
    runId,
    deliverAlerts: () => drainDurablePhase(deliverDurableAlertIntentsBatch),
    cleanup: () =>
      drainDurableCleanup(() => cleanupDurableIngestionSnapshotBatch(runId)),
  });
  return execution.ingestion;
}
