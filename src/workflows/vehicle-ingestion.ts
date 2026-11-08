import { createHook, getWorkflowMetadata, sleep } from "workflow";
import { start } from "workflow/api";
import { hasDeliverableNotificationIntents } from "~/server/alerts/durable-alert-delivery-runtime";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import {
  claimCommitTurn,
  runIngestionPass,
  type IngestionRunReport,
} from "~/server/ingestion/ingestion-pass-orchestrator";
import {
  commitDurableIngestion,
  recordingFailure,
  stageDurableIngestion,
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
  announceInventoryStep,
  attachDurableIngestionWorkflowStep,
  claimDurableIngestionCommitStep,
  prepareIngestionPassStep,
  refreshHomepageStep,
  reportIngestionRunStep,
  signalCommitWaitersStep,
  deliverVehicleSearchAlertIntentsStep,
  initializeDurableIngestionStep,
  markDurableIngestionFailedStep,
  markDurableSourceFailedStep,
  reportProviderStatusStep,
  reconcileDurableIngestionStep,
  runAlgoliaProjectorStep,
  runDurableSourceChunkStep,
  runVehicleSearchAlertsStep,
  validateDurableIngestionSourcesStep,
  warmInventoryAnnouncementStep,
} from "./vehicle-steps";
import { IngestionTokens } from "./ingestion-tokens";

const ALGOLIA_WRITES_TOKEN = "algolia-writes";
const ALERT_DELIVERY_TOKEN = "vehicle-alert-delivery";
const LOCK_RETRY_DELAY = "30s";
// Fallbacks for signals that never arrive, such as a workflow that died.
const COMMIT_TURN_FALLBACK = "10m";
const COMMIT_TURN_SETTLE = "2s";
const PASS_WATCHDOG_INTERVAL = "30m";
const FAILED_RUN_RESUME_DELAY = "5m";
// Time for requested pages to finish regenerating in the background.
const PAGE_REGENERATION_DELAY = "2m";

/** Starts or resumes each source run's workflow; live ones exit at once. */
async function startIngestionRunWorkflowsStep(
  runIds: readonly string[],
  day: string,
) {
  "use step";

  await Promise.all(
    runIds.map((runId) => start(vehicleIngestionWorkflow, [runId, day])),
  );
}
startIngestionRunWorkflowsStep.maxRetries = 2;

/** Starts delivery once the day's pass ends, if a notification can go out. */
async function deliverIngestionPassNotificationsStep(day: string) {
  "use step";

  // Once the next day starts, its sources are running and its pass delivers.
  if (IngestionDay.key(new Date()) !== day) return;
  if (await hasDeliverableNotificationIntents()) {
    await start(vehicleNotificationDeliveryWorkflow);
  }
}
deliverIngestionPassNotificationsStep.maxRetries = 2;

/**
 * One ingestion day. The hourly cron starts it; a pass already running
 * deduplicates. Each due source runs as its own workflow and reports back
 * here, failed sources retry after their delay, and the day's notifications
 * go out once every source published or used its attempts.
 */
export async function vehicleIngestionPassWorkflow(day: string) {
  "use workflow";

  using reports = createHook<IngestionRunReport>({
    token: IngestionTokens.passReports(day),
  });
  const activePass = await reports.getConflict();
  if (activePass) {
    return { status: "deduplicated" as const, activeRunId: activePass.runId };
  }
  const incoming = reports[Symbol.asyncIterator]();
  // A report that loses a race against the watchdog stays pending for the
  // next wait instead of being dropped.
  let pendingReport = incoming.next();
  const outcome = await runIngestionPass({
    plan: () => prepareIngestionPassStep(day),
    startRuns: (runIds) => startIngestionRunWorkflowsStep(runIds, day),
    nextReport: async () => {
      const next = await Promise.race([
        pendingReport,
        sleep(PASS_WATCHDOG_INTERVAL).then(() => "timeout" as const),
      ]);
      if (next === "timeout") return next;
      pendingReport = incoming.next();
      return next.done ? "timeout" : next.value;
    },
    sleepUntil: (time) => sleep(new Date(time)),
    pauseAfterFailure: () => sleep(FAILED_RUN_RESUME_DELAY),
    deliverNotifications: () => deliverIngestionPassNotificationsStep(day),
  });
  // Only the pass that ran sources refreshes the homepage. Rebuilding it
  // scans every live vehicle, and an hourly refresh stalled the homepage.
  if (outcome === "completed") {
    const refreshed = await refreshHomepageStep();
    if (refreshed !== null) {
      try {
        await announceChangedInventoryPages(refreshed);
      } catch (error) {
        // Best effort: the pass already published. The checkpoint stays
        // behind, so the next publication's announcement includes these pages.
        console.error(
          `[Workflow] Could not announce publication ${refreshed}'s changed inventory pages to IndexNow; the next publication's announcement retries them: ${String(error)}`,
        );
      }
    }
  }
  return { status: outcome, day };
}

/**
 * Announces the pages a publication changed once they show it: each page is
 * requested so it regenerates, then IndexNow engines hear about it, so a
 * crawler that follows gets the new page.
 */
async function announceChangedInventoryPages(publicationSequence: number) {
  const paths = await warmInventoryAnnouncementStep(publicationSequence);
  if (paths.length === 0) return;
  await sleep(PAGE_REGENERATION_DELAY);
  await announceInventoryStep(publicationSequence, paths);
}

/**
 * One source run. Staging runs in parallel with other sources; the commit
 * (reconciliation, Algolia publication, alert matching) waits its turn.
 */
export async function vehicleIngestionWorkflow(runId: string, day?: string) {
  "use workflow";

  using ingestionRun = createHook({ token: IngestionTokens.run(runId) });
  const activeRun = await ingestionRun.getConflict();
  if (activeRun) {
    return {
      status: "deduplicated" as const,
      activeRunId: activeRun.runId,
    };
  }

  let failed = true;
  let completed = false;
  try {
    const result = await runSourceIngestion(runId);
    failed = false;
    completed = result.status === "completed";
    return result;
  } finally {
    // A completed run reported itself after publishing; any other outcome
    // shows the provider delayed while its last inventory stays up.
    if (!completed) await reportProviderStatusStep(runId);
    if (day !== undefined) {
      await reportIngestionRunStep(day, { runId, failed });
    }
  }
}

async function runSourceIngestion(runId: string) {
  const { workflowRunId } = getWorkflowMetadata();
  await attachDurableIngestionWorkflowStep(runId, workflowRunId);
  const markRunFailed = (failedRunId: string, message: string) =>
    markDurableIngestionFailedStep(failedRunId, message);
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
  // whose workflow died mid-commit keeps it until a resumed workflow finishes
  // the commit or the run is abandoned. The releasing run wakes the waiters.
  using commitTurn = createHook<null>({
    token: IngestionTokens.commitTurn(runId),
  });
  const turns = commitTurn[Symbol.asyncIterator]();
  let nextTurn = turns.next();
  const claim = await claimCommitTurn({
    claim: () =>
      recordingFailure(runId, markRunFailed, () =>
        claimDurableIngestionCommitStep(runId),
      ),
    waitForTurn: async () => {
      const signal = await Promise.race([
        nextTurn.then(() => "turn" as const),
        sleep(COMMIT_TURN_FALLBACK).then(() => "fallback" as const),
      ]);
      if (signal === "turn") {
        nextTurn = turns.next();
        // The claim waits a second past the releasing run's alert checks.
        await sleep(COMMIT_TURN_SETTLE);
      }
    },
  });
  if (claim === "stopped") return { status: "stopped" as const };

  try {
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
      reportHealth: reportProviderStatusStep,
    });
    if (publicationResult.status === "stopped") return publicationResult;

    // The day's pass delivers notifications once every source is done, so
    // each recipient's one digest per day covers every source.
    await drainDurableCleanup(() =>
      cleanupDurableIngestionStateBatchStep(runId),
    );
    return {
      status: "completed" as const,
      ingestion: ingestionResult.ingestion,
      projector: publicationResult.projector,
      alertMatching: publicationResult.alertMatching,
    };
  } finally {
    await signalCommitWaitersStep();
  }
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
