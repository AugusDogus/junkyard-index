import { createHook, getWorkflowMetadata, sleep } from "workflow";
import { executeDurableIngestion } from "~/server/ingestion/durable-ingestion-orchestrator";
import {
  cleanupDurableIngestionSnapshotsStep,
  cleanupStaleDurableIngestionSnapshotsStep,
  initializeDurableIngestionStep,
  markDurableIngestionFailedStep,
  markDurableSourceFailedStep,
  reconcileDurableIngestionStep,
  runAlgoliaProjectorStep,
  runDurableSourceChunkStep,
  runVehicleSearchAlertsStep,
} from "./vehicle-steps";

const INGESTION_RUN_TOKEN = "vehicle-ingestion";
const ALGOLIA_WRITES_TOKEN = "algolia-writes";
const LOCK_RETRY_DELAY = "30s";

export async function vehicleIngestionWorkflow() {
  "use workflow";

  using ingestionRun = createHook({ token: INGESTION_RUN_TOKEN });
  const activeRun = await ingestionRun.getConflict();
  if (activeRun) {
    return {
      status: "deduplicated" as const,
      activeRunId: activeRun.runId,
    };
  }

  const { workflowRunId } = getWorkflowMetadata();
  const execution = await executeDurableIngestion({
    runId: workflowRunId,
    operations: {
      cleanupStale: cleanupStaleDurableIngestionSnapshotsStep,
      initialize: initializeDurableIngestionStep,
      runChunk: runDurableSourceChunkStep,
      markFailed: markDurableSourceFailedStep,
      reconcile: reconcileDurableIngestionStep,
      markRunFailed: markDurableIngestionFailedStep,
      cleanupSnapshots: cleanupDurableIngestionSnapshotsStep,
    },
  });
  if (execution.status === "deduplicated") return execution;

  let projector: Awaited<ReturnType<typeof runAlgoliaProjectorStep>> | null =
    null;

  while (projector === null) {
    using algoliaWrites = createHook({ token: ALGOLIA_WRITES_TOKEN });
    const activeWriter = await algoliaWrites.getConflict();
    if (activeWriter) {
      console.info(
        `[Workflow] Waiting for Algolia writer ${activeWriter.runId}`,
      );
      await sleep(LOCK_RETRY_DELAY);
      continue;
    }

    projector = await runAlgoliaProjectorStep();
  }

  const alerts = await runVehicleSearchAlertsStep();
  return {
    status: "completed" as const,
    ingestion: execution.ingestion,
    projector,
    alerts,
  };
}
