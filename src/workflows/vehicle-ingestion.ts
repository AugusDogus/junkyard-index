import { createHook, getWorkflowMetadata, sleep } from "workflow";
import { executeDurableIngestion } from "~/server/ingestion/durable-ingestion-orchestrator";
import {
  drainDurableCleanup,
  drainDurablePhase,
  runDurablePostReleaseLifecycle,
  runDurablePublicationLifecycle,
  runProjectionWithFailureRecording,
} from "~/server/ingestion/durable-post-ingestion-orchestrator";
import {
  cleanupDurableIngestionStateBatchStep,
  cleanupStaleDurableIngestionSnapshotsStep,
  attachDurableIngestionWorkflowStep,
  deliverVehicleSearchAlertIntentsStep,
  initializeDurableIngestionStep,
  markDurableIngestionFailedStep,
  markDurableSourceFailedStep,
  reportDurableIngestionHealthStep,
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

  let publication: {
    ingestion: Awaited<ReturnType<typeof executeDurableIngestion>> & {
      status: "completed";
    };
    projector: Awaited<ReturnType<typeof runAlgoliaProjectorStep>>;
    alertMatching: Awaited<ReturnType<typeof runVehicleSearchAlertsStep>>;
  } | null = null;

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
    const ingestionResult = await executeDurableIngestion({
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

    const publicationResult = await runDurablePublicationLifecycle({
      runId,
      project: async () => {
        while (true) {
          using algoliaWrites = createHook({ token: ALGOLIA_WRITES_TOKEN });
          const activeWriter = await algoliaWrites.getConflict();
          if (activeWriter) {
            console.info(
              `[Workflow] Waiting for Algolia writer ${activeWriter.runId}`,
            );
            await sleep(LOCK_RETRY_DELAY);
            continue;
          }
          return runProjectionWithFailureRecording({
            runId,
            runBatch: () => runAlgoliaProjectorStep(runId),
            markFailed: markDurableIngestionFailedStep,
          });
        }
      },
      matchAlerts: () =>
        drainDurablePhase(() => runVehicleSearchAlertsStep(runId)),
      reportHealth: reportDurableIngestionHealthStep,
    });
    if (publicationResult.status === "stopped") return publicationResult;
    publication = {
      ingestion: ingestionResult,
      projector: publicationResult.projector,
      alertMatching: publicationResult.alertMatching,
    };
  }

  if (!publication) {
    throw new Error(`Ingestion run ${runId} completed without publication.`);
  }
  const postRelease = await runDurablePostReleaseLifecycle({
    runId,
    deliverAlerts: async () => {
      using alertDelivery = createHook({ token: ALERT_DELIVERY_TOKEN });
      const activeDelivery = await alertDelivery.getConflict();
      return activeDelivery
        ? null
        : drainDurablePhase(deliverVehicleSearchAlertIntentsStep);
    },
    cleanup: () =>
      drainDurableCleanup(() => cleanupDurableIngestionStateBatchStep(runId)),
  });

  return {
    status: "completed" as const,
    ingestion: publication.ingestion.ingestion,
    projector: publication.projector,
    alertMatching: publication.alertMatching,
    delivery: postRelease.delivery,
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
