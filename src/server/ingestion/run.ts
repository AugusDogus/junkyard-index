import { randomUUID } from "node:crypto";
import { deliverDurableAlertIntentsBatch } from "~/server/alerts/durable-alert-delivery-runtime";
import { runDurableAlertMatchingBatch } from "~/server/alerts/durable-search-alerts";
import { runDurableAlgoliaProjectionBatch } from "./algolia-projector";
import {
  cleanupDurableIngestionStateBatch,
  resolveDurableWorkflowCursor,
  cleanupStaleDurableAlgoliaRebuilds,
  cleanupStaleDurableIngestionSnapshots,
  initializeDurableIngestion,
  markDurableIngestionFailed,
  markDurableSourceFailed,
  reconcileDurableIngestion,
  reportDurableProviderStatus,
  runDurableSourceChunk,
  type DurableIngestionResult,
  validateDurableIngestionSources,
} from "./durable-ingestion";
import { durableSourceChunkProgressError } from "./durable-source";
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
      cleanupStale: async () => {
        await cleanupStaleDurableIngestionSnapshots();
        await cleanupStaleDurableAlgoliaRebuilds();
      },
      initialize: initializeDurableIngestion,
      runChunk: async (currentRunId, workflowCursor) => {
        const cursor = await resolveDurableWorkflowCursor(
          currentRunId,
          workflowCursor,
        );
        const result = await runDurableSourceChunk({
          runId: currentRunId,
          cursor,
        });
        if (result.status === "deferred") return result;
        const progressError = durableSourceChunkProgressError(cursor, result);
        if (progressError) throw new Error(progressError);
        return result;
      },
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
    reportHealth: reportDurableProviderStatus,
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
      drainDurableCleanup(() => cleanupDurableIngestionStateBatch(runId)),
  });
  return execution.ingestion;
}
