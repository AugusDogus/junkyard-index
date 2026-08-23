import { createHook, getWorkflowMetadata, sleep } from "workflow";
import { executeDurableIngestion } from "~/server/ingestion/durable-ingestion-orchestrator";
import {
  cleanupDurableIngestionSnapshotBatchStep,
  cleanupStaleDurableIngestionSnapshotsStep,
  attachDurableIngestionWorkflowStep,
  deliverVehicleSearchAlertIntentsStep,
  initializeDurableIngestionStep,
  markDurableIngestionFailedStep,
  markDurableSourceFailedStep,
  reconcileDurableIngestionStep,
  runAlgoliaProjectorStep,
  runDurableSourceChunkStep,
  runVehicleSearchAlertsStep,
  validateDurableIngestionSourcesStep,
} from "./vehicle-steps";

const INGESTION_RUN_TOKEN = "vehicle-ingestion";
const ALGOLIA_WRITES_TOKEN = "algolia-writes";
const ALERT_DELIVERY_TOKEN = "vehicle-alert-delivery";
const LOCK_RETRY_DELAY = "30s";

export async function vehicleIngestionWorkflow(runId: string) {
  "use workflow";

  let ingestionResult: Awaited<
    ReturnType<typeof executeDurableIngestion>
  > | null = null;
  let projector: Awaited<ReturnType<typeof runAlgoliaProjectorStep>> | null =
    null;
  let alertMatching: Awaited<
    ReturnType<typeof runVehicleSearchAlertsStep>
  > | null = null;

  {
    using ingestionRun = createHook({ token: INGESTION_RUN_TOKEN });
    const activeRun = await ingestionRun.getConflict();
    if (activeRun) {
      return {
        status: "deduplicated" as const,
        activeRunId: activeRun.runId,
      };
    }

    const { workflowRunId } = getWorkflowMetadata();
    await attachDurableIngestionWorkflowStep(runId, workflowRunId);
    ingestionResult = await executeDurableIngestion({
      runId,
      operations: {
        cleanupStale: cleanupStaleDurableIngestionSnapshotsStep,
        initialize: initializeDurableIngestionStep,
        runChunk: runDurableSourceChunkStep,
        markFailed: markDurableSourceFailedStep,
        validateSources: validateDurableIngestionSourcesStep,
        reconcile: reconcileDurableIngestionStep,
        markRunFailed: markDurableIngestionFailedStep,
      },
    });
    if (
      ingestionResult.status === "deduplicated" ||
      ingestionResult.status === "stopped"
    ) {
      return ingestionResult;
    }

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

      while (true) {
        let batch: Awaited<ReturnType<typeof runAlgoliaProjectorStep>>;
        try {
          batch = await runAlgoliaProjectorStep(runId);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          await markDurableIngestionFailedStep(
            runId,
            `Algolia projection stopped after retries: ${detail}`,
          );
          throw error;
        }
        if (batch.status === "stopped") return batch;
        if (batch.status === "complete") {
          projector = batch;
          break;
        }
      }
    }

    while (true) {
      const batch = await runVehicleSearchAlertsStep(runId);
      if (batch.status === "stopped") return batch;
      if (batch.status === "complete") {
        alertMatching = batch;
        break;
      }
    }
  }

  let delivery: Awaited<
    ReturnType<typeof deliverVehicleSearchAlertIntentsStep>
  > | null = null;
  {
    using alertDelivery = createHook({ token: ALERT_DELIVERY_TOKEN });
    const activeDelivery = await alertDelivery.getConflict();
    if (!activeDelivery) {
      while (true) {
        const batch = await deliverVehicleSearchAlertIntentsStep();
        if (batch.status === "complete") {
          delivery = batch;
          break;
        }
      }
    }
  }

  while (true) {
    const cleanup = await cleanupDurableIngestionSnapshotBatchStep(runId);
    if (cleanup.done) break;
  }

  return {
    status: "completed" as const,
    ingestion:
      ingestionResult.status === "completed" ? ingestionResult.ingestion : null,
    projector,
    alertMatching,
    delivery,
  };
}

export async function vehicleNotificationDeliveryWorkflow() {
  "use workflow";

  using alertDelivery = createHook({ token: ALERT_DELIVERY_TOKEN });
  const activeDelivery = await alertDelivery.getConflict();
  if (activeDelivery) {
    return {
      status: "deduplicated" as const,
      activeRunId: activeDelivery.runId,
    };
  }
  let intentsProcessed = 0;
  while (true) {
    const batch = await deliverVehicleSearchAlertIntentsStep();
    intentsProcessed += batch.intentsProcessed;
    if (batch.status === "complete") {
      return { status: "completed" as const, intentsProcessed };
    }
  }
}
