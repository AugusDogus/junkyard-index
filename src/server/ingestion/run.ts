import { randomUUID } from "node:crypto";
import {
  cleanupDurableIngestionSnapshots,
  cleanupStaleDurableIngestionSnapshots,
  initializeDurableIngestion,
  markDurableIngestionFailed,
  markDurableSourceFailed,
  reconcileDurableIngestion,
  runDurableSourceChunk,
  type DurableIngestionResult,
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
      reconcile: reconcileDurableIngestion,
      markRunFailed: markDurableIngestionFailed,
      cleanupSnapshots: cleanupDurableIngestionSnapshots,
    },
  });
  if (execution.status === "deduplicated") {
    throw new Error(
      `Ingestion is already running${execution.activeRunId ? ` as ${execution.activeRunId}` : ""}. Wait for it to finish before starting another local run.`,
    );
  }
  return execution.ingestion;
}
