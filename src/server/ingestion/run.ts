import { randomUUID } from "node:crypto";
import {
  deliverDurableAlertIntentsBatch,
  runDurableAlertMatchingBatch,
} from "~/server/alerts/durable-search-alerts";
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

  while (true) {
    const projection = await runDurableAlgoliaProjectionBatch(runId, {
      configureIndex: process.env.ALGOLIA_CONFIGURE_ON_INGEST === "1",
    });
    if (projection.status === "stopped") {
      throw new Error(
        `Ingestion run ${runId} was stopped during Algolia publication.`,
      );
    }
    if (projection.status === "complete") break;
  }

  while (true) {
    const matching = await runDurableAlertMatchingBatch(runId);
    if (matching.status === "stopped") {
      throw new Error(
        `Ingestion run ${runId} was stopped during alert matching.`,
      );
    }
    if (matching.status === "complete") break;
  }
  await reportDurableIngestionHealth(runId);

  while (true) {
    const delivery = await deliverDurableAlertIntentsBatch();
    if (delivery.status === "complete") break;
  }

  while (true) {
    const cleanup = await cleanupDurableIngestionSnapshotBatch(runId);
    if (cleanup.done) break;
  }
  return execution.ingestion;
}
