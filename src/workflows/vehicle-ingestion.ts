import { createHook, getWorkflowMetadata, sleep } from "workflow";
import { getRun, start } from "workflow/api";
import { WorkflowRunNotFoundError } from "workflow/internal/errors";
import { hasDeliverableNotificationIntents } from "~/server/alerts/durable-alert-delivery-runtime";
import {
  runSearchAlertCheck,
  startDailySearchAlerts,
} from "~/server/alerts/daily-search-alert-trigger";
import {
  openDailySearchAlertCheck,
  searchAlertsEnabled,
} from "~/server/alerts/search-alert-check-runtime";
import { getAttachedIngestionWorkflowRuns } from "~/server/ingestion/durable-ingestion";
import {
  startIdleRunWorkflows,
  type RunWorkflowState,
} from "~/server/ingestion/run-workflow-starts";
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
  runDurablePublicationLifecycle,
  runProjectionWithFailureRecording,
} from "~/server/ingestion/durable-post-ingestion-orchestrator";
import {
  cleanupDurableIngestionStateBatchStep,
  cleanupStaleDurableAlgoliaRebuildsStep,
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
  runSearchAlertCheckBatchStep,
  validateDurableIngestionSourcesStep,
  warmInventoryAnnouncementStep,
} from "./vehicle-steps";
import { IngestionTokens } from "./ingestion-tokens";
import { withAlgoliaWriterLock } from "~/server/ingestion/algolia-writer-lock";

const ALGOLIA_WRITES_TOKEN = "algolia-writes";
const ALERT_DELIVERY_TOKEN = "vehicle-alert-delivery";
const LOCK_RETRY_DELAY = "30s";
// Fallbacks for signals that never arrive, such as a workflow that died.
// Each commit claim attempt also keeps a waiter live in the commit queue,
// which skips waiters silent for 15 minutes (CommitLease).
const COMMIT_TURN_FALLBACK = "5m";
const COMMIT_TURN_SETTLE = "2s";
const PASS_WATCHDOG_INTERVAL = "30m";
const FAILED_RUN_RESUME_DELAY = "5m";
// Time for requested pages to finish regenerating in the background.
const PAGE_REGENERATION_DELAY = "2m";
// Retry interval while an alert check batch could read incomplete results:
// a run from the previous release is matching alerts, or a commit inside the
// check's window is not searchable yet.
const ALERT_CHECK_RETRY_DELAY = "10m";

/** Whether a run's attached workflow is still driving it. */
async function ingestionWorkflowState(
  workflowRunId: string,
): Promise<RunWorkflowState> {
  try {
    const status = await getRun(workflowRunId).status;
    return status === "pending" || status === "running" ? "live" : "idle";
  } catch (error) {
    if (WorkflowRunNotFoundError.is(error)) return "idle";
    console.warn(
      `[Workflow] Could not read ingestion workflow ${workflowRunId}'s status; starting its run anyway, which deduplicates if it is live: ${String(error)}`,
    );
    return "unknown";
  }
}

/** Starts or resumes each source run whose workflow is not live. */
async function startIngestionRunWorkflowsStep(
  runIds: readonly string[],
  day: string,
) {
  "use step";

  await startIdleRunWorkflows({
    runIds,
    attachedWorkflows: getAttachedIngestionWorkflowRuns,
    workflowState: ingestionWorkflowState,
    start: async (runId) => {
      await start(vehicleIngestionWorkflow, [runId, day]);
    },
  });
}
startIngestionRunWorkflowsStep.maxRetries = 2;

/** The pass's end starts the day's saved-search alerts. */
async function startDailySearchAlertsStep(day: string) {
  "use step";

  await startDailySearchAlerts(day, {
    now: new Date(),
    alertsEnabled: searchAlertsEnabled,
        openCheck: openDailySearchAlertCheck,
    hasDeliverableIntents: hasDeliverableNotificationIntents,
    startCheck: (checkDay) => start(searchAlertCheckWorkflow, [checkDay]),
    startDelivery: () => start(vehicleNotificationDeliveryWorkflow),
  });
}
startDailySearchAlertsStep.maxRetries = 2;

/** Starts delivery if a notification can go out now. */
async function startNotificationDeliveryStep() {
  "use step";

  if (await hasDeliverableNotificationIntents()) {
    await start(vehicleNotificationDeliveryWorkflow);
  }
}
startNotificationDeliveryStep.maxRetries = 2;

/**
 * One ingestion day. The hourly cron starts it; a pass already running
 * deduplicates. Each due source runs as its own workflow and reports back
 * here, failed sources retry after their delay, and the day's saved-search
 * alert check starts once every source published or used its attempts.
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
    deliverNotifications: () => startDailySearchAlertsStep(day),
  });
  // Only the pass that ran sources refreshes the homepage. Rebuilding it
  // scans every live vehicle, and an hourly refresh stalled the homepage.
  if (outcome === "completed") {
    await cleanupStaleDurableAlgoliaRebuildsStep();
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
 * (reconciliation and Algolia publication) waits its turn. The run is
 * released once its inventory is searchable; alerts are checked daily.
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
    sleepUntil: (time: number) => sleep(new Date(time)),
    markFailed: markDurableSourceFailedStep,
    validateSources: validateDurableIngestionSourcesStep,
    reconcile: reconcileDurableIngestionStep,
    markRunFailed,
  };
  // Each source's run fetches and stages in parallel with the others.
  const staging = await stageDurableIngestion({ runId, operations });
  if (staging.status !== "staged") return staging;

  // Committing writes the shared inventory and search index, so one run
  // commits at a time. The claim lives in the database, so a run
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
        // Let the releasing run's final writes settle before claiming.
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

    // With search publication switched off, the final reconciliation batch
    // already released the run and left its changes for a later rebuild.
    // Nothing here may call Algolia.
    if (ingestionResult.search === "skipped") {
      await reportProviderStatusStep(runId);
      await drainDurableCleanup(() =>
        cleanupDurableIngestionStateBatchStep(runId),
      );
      return {
        status: "completed" as const,
        ingestion: ingestionResult.ingestion,
        search: "skipped" as const,
      };
    }

    const publicationResult = await runDurablePublicationLifecycle({
      runId,
      project: () =>
        withAlgoliaWriterLock({
          acquire: () => createHook({ token: ALGOLIA_WRITES_TOKEN }),
          waitForWriter: async (activeRunId) => {
            console.info(
              `[Workflow] Waiting for Algolia writer ${activeRunId}`,
            );
            await sleep(LOCK_RETRY_DELAY);
          },
          write: () =>
            runProjectionWithFailureRecording({
              runId,
              runBatch: () => runAlgoliaProjectorStep(runId),
              markFailed: markRunFailed,
            }),
        }),
      reportHealth: reportProviderStatusStep,
    });
    if (publicationResult.status === "stopped") return publicationResult;

    await drainDurableCleanup(() =>
      cleanupDurableIngestionStateBatchStep(runId),
    );
    return {
      status: "completed" as const,
      ingestion: ingestionResult.ingestion,
      projector: publicationResult.projector,
    };
  } finally {
    await signalCommitWaitersStep();
  }
}

/**
 * The day's one saved-search alert check: each alert-enabled saved search is
 * matched once against the vehicles first seen since its last check, then
 * the matches are delivered as the day's digest. Started when the day's pass
 * ends, and hourly after the day's alert deadline, so a stuck or abandoned
 * source cannot hold back everyone's alerts; a check already finished only
 * retries delivery.
 */
export async function searchAlertCheckWorkflow(day: string) {
  "use workflow";

  using alertCheck = createHook({
    token: IngestionTokens.searchAlertCheck(day),
  });
  const activeCheck = await alertCheck.getConflict();
  if (activeCheck) {
    return { status: "deduplicated" as const, activeRunId: activeCheck.runId };
  }
  const result = await runSearchAlertCheck({
    runBatch: () => runSearchAlertCheckBatchStep(day),
    waitForRetry: () => sleep(ALERT_CHECK_RETRY_DELAY),
    startDelivery: startNotificationDeliveryStep,
  });
  return { ...result, day };
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
