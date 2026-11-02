import { createHook, getWorkflowMetadata, sleep } from "workflow";
import {
  commitDurableIngestion,
  recordingFailure,
  stageDurableIngestion,
  type DurableIngestionCompletion,
} from "~/server/ingestion/durable-ingestion-orchestrator";
import {
  drainDurableCleanup,
  drainDurablePhase,
  runDurablePublicationLifecycle,
  runProjectionWithFailureRecording,
} from "~/server/ingestion/durable-post-ingestion-orchestrator";
import {
  cleanupDurableIngestionStateBatchStep,
  cleanupStaleDurableIngestionSnapshotsStep,
  attachDurableIngestionWorkflowStep,
  claimDurableIngestionCommitStep,
  deliverVehicleSearchAlertIntentsStep,
  initializeDurableIngestionStep,
  markDurableIngestionFailedStep,
  markDurableSourceFailedStep,
  reportDurableIngestionFailureStep,
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
    ingestion: DurableIngestionCompletion;
    projector: Awaited<ReturnType<typeof runAlgoliaProjectorStep>>;
    alertMatching: Awaited<ReturnType<typeof runVehicleSearchAlertsStep>>;
  } | null = null;

  {
    using ingestionRun = createHook({
      token: `${INGESTION_RUN_TOKEN}:${runId}`,
    });
    const activeRun = await ingestionRun.getConflict();
    if (activeRun) {
      return {
        status: "deduplicated" as const,
        activeRunId: activeRun.runId,
      };
    }

    const { workflowRunId } = getWorkflowMetadata();
    await attachDurableIngestionWorkflowStep(runId, workflowRunId);
    const markRunFailed = async (failedRunId: string, message: string) => {
      await markDurableIngestionFailedStep(failedRunId, message);
      try {
        await reportDurableIngestionFailureStep(failedRunId);
      } catch (error) {
        console.error(
          `Failed to report ingestion run ${failedRunId} down after recording its failure`,
          error,
        );
      }
    };
    const operations = {
      cleanupStale: cleanupStaleDurableIngestionSnapshotsStep,
      initialize: initializeDurableIngestionStep,
      runChunk: runDurableSourceChunkStep,
      markFailed: markDurableSourceFailedStep,
      validateSources: validateDurableIngestionSourcesStep,
      reconcile: reconcileDurableIngestionStep,
      markRunFailed,
    };
    // Each source's run fetches and stages in parallel with the others.
    const staging = await stageDurableIngestion({ runId, operations });
    if (staging.status !== "staged") return staging;

    // Committing writes the shared inventory, search index, and alert intents,
    // so one run commits at a time. The claim lives in the database, so a run
    // whose workflow died mid-commit keeps it until a resumed workflow
    // finishes the commit or the run is abandoned.
    while (true) {
      const claim = await recordingFailure(runId, markRunFailed, () =>
        claimDurableIngestionCommitStep(runId),
      );
      if (claim === "stopped") return { status: "stopped" as const };
      if (claim === "busy") {
        await sleep(LOCK_RETRY_DELAY);
        continue;
      }
      const ingestionResult = await commitDurableIngestion({
        runId,
        operations,
      });
      if (ingestionResult.status === "stopped") return ingestionResult;

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
              markFailed: markRunFailed,
            });
          }
        },
        // Projection records its own failures; record the rest so a run that
        // keeps failing while holding the commit is eventually abandoned.
        matchAlerts: () =>
          recordingFailure(runId, markRunFailed, () =>
            drainDurablePhase(() => runVehicleSearchAlertsStep(runId)),
          ),
        reportHealth: (healthRunId) =>
          recordingFailure(runId, markRunFailed, () =>
            reportDurableIngestionHealthStep(healthRunId),
          ),
      });
      if (publicationResult.status === "stopped") return publicationResult;
      publication = {
        ingestion: ingestionResult,
        projector: publicationResult.projector,
        alertMatching: publicationResult.alertMatching,
      };
      break;
    }
  }

  if (!publication) {
    throw new Error(`Ingestion run ${runId} completed without publication.`);
  }
  // Each run covers one source, so delivery waits for the day's last source
  // (see the vehicle-ingestion cron) to keep one digest per recipient per day.
  await drainDurableCleanup(() => cleanupDurableIngestionStateBatchStep(runId));

  return {
    status: "completed" as const,
    ingestion: publication.ingestion.ingestion,
    projector: publication.projector,
    alertMatching: publication.alertMatching,
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
