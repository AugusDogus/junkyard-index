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
import {
  getAttachedIngestionWorkflowRuns,
  swapDurableIngestionWorkflowRun,
} from "~/server/ingestion/durable-ingestion";
import {
  startGuarded,
  startIdleRunWorkflows,
  type RunWorkflowState,
} from "~/server/ingestion/run-workflow-starts";
import {
  claimCommitTurn,
  runIngestionPass,
  type IngestionRunReport,
  type StartedRun,
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
  attachDurableIngestionWorkflowStep,
  claimDurableIngestionCommitStep,
  detachDurableIngestionWorkflowStep,
  prepareIngestionPassStep,
  reportIngestionRunStep,
  signalCommitWaitersStep,
  initializeDurableIngestionStep,
  markDurableIngestionFailedStep,
  markDurableSourceFailedStep,
  reportProviderStatusStep,
  reconcileDurableIngestionStep,
  runAlgoliaProjectorStep,
  runDurableSourceChunkStep,
  runSearchAlertCheckBatchStep,
  touchSearchAlertCheckStep,
  validateDurableIngestionSourcesStep,
} from "./vehicle-steps";
import { IngestionTokens } from "./ingestion-tokens";
import { waitForPublicationMode } from "./publication-mode-wait";
import { vehicleNotificationDeliveryWorkflow } from "./downstream-consumers";
import { searchProjectorWorkflow } from "./search-projector";
import { PublicationModeFlag } from "~/server/ingestion/publication-mode-flag";
import { withSearchWriteLock } from "./search-write-lock";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import { HostClaims } from "~/server/ingestion/host-claims";

// Fallbacks for signals that never arrive, such as a workflow that died.
// Each commit claim attempt also keeps a waiter live in the commit queue,
// which skips waiters silent for 15 minutes (CommitLease).
const COMMIT_TURN_FALLBACK = "5m";
const COMMIT_TURN_SETTLE = "2s";
const PASS_WATCHDOG_INTERVAL = "30m";
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

/**
 * Starts or resumes each source run whose workflow is not live, with the
 * claims it may fetch with. Each start is guarded (`startGuarded`): the run
 * is marked as starting before its pass checks that it still admits (its day
 * has not ended and it was not replaced), so no other pass can admit the
 * run's hosts while its workflow starts.
 */
async function startIngestionRunWorkflowsStep(
  runs: readonly StartedRun[],
  day: string,
  passRunId: string,
) {
  "use step";

  const claims = new Map(runs.map((run) => [run.runId, run.claims]));
  const pass = getRun(passRunId);
  const stillAdmits = async () => {
    if (IngestionDay.key(new Date()) !== day) return false;
    const status = await pass.status;
    return status === "pending" || status === "running";
  };
  await startIdleRunWorkflows({
    runIds: runs.map((run) => run.runId),
    attachedWorkflows: getAttachedIngestionWorkflowRuns,
    workflowState: ingestionWorkflowState,
    passRunId,
    now: () => Date.now(),
    start: async (runId, previous, state) => {
      const outcome = await startGuarded({
        runId,
        previous,
        state,
        passRunId,
        now: () => Date.now(),
        swap: swapDurableIngestionWorkflowRun,
        stillAdmits,
        start: async () =>
          (
            await start(vehicleIngestionWorkflow, [
              runId,
              day,
              claims.get(runId) ?? HostClaims.none,
            ])
          ).runId,
      });
      if (outcome === "skipped")
        console.info(
          `[Workflow] Did not start run ${runId}: another start attached it first, or the ${day} pass no longer admits runs. The pass that plans next starts it.`,
        );
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
 * Starts the search projector once a decoupled run has published to Turso,
 * so search catches up without waiting for its cron. A projector already
 * running deduplicates. Best effort: the run already published, and the
 * cron starts the projector within 10 minutes if this fails.
 */
async function kickSearchProjectorStep() {
  "use step";

  try {
    if ((await PublicationModeFlag.mode()) === "decoupled") {
      await start(searchProjectorWorkflow);
    }
  } catch (error) {
    console.warn(
      `[Workflow] Could not start the search projector after a decoupled run; its cron starts it within 10 minutes: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
kickSearchProjectorStep.maxRetries = 0;

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
  const passRunId = getWorkflowMetadata().workflowRunId;
  const incoming = reports[Symbol.asyncIterator]();
  // A report that loses a race against the watchdog stays pending for the
  // next wait instead of being dropped.
  let pendingReport = incoming.next();
  // The pass re-plans at least this often, even while reports keep coming,
  // so claims of runs that report elsewhere (another day's pass, an older
  // deployment) are freed within one interval.
  let watchdog: Promise<"timeout"> = sleep(PASS_WATCHDOG_INTERVAL).then(
    () => "timeout" as const,
  );
  // After its day the pass stops admitting runs; its next plan expires it.
  const dayEnded = sleep(new Date(IngestionDay.end(day))).then(
    () => "timeout" as const,
  );
  const timeout = () => "timeout" as const;
  const outcome = await runIngestionPass({
    plan: () => {
      // A pass whose plans keep failing past its day still expires.
      if (Date.now() >= IngestionDay.end(day))
        return Promise.resolve({ status: "expired" as const });
      watchdog = sleep(PASS_WATCHDOG_INTERVAL).then(timeout);
      return prepareIngestionPassStep(day);
    },
    startRuns: (runs) => startIngestionRunWorkflowsStep(runs, day, passRunId),
    nextReport: async (deadline, mode) => {
      // The day's end goes first: a report already waiting must not make an
      // expired pass admit runs. It stays pending for the next wait.
      const next = await Promise.race([
        dayEnded,
        pendingReport,
        // A source's retry, a failure pause or a stopped run's hosts.
        ...(deadline === null ? [] : [sleep(new Date(deadline)).then(timeout)]),
        ...(mode === "interval" ? [watchdog] : []),
        ...(mode === "silence"
          ? [sleep(PASS_WATCHDOG_INTERVAL).then(timeout)]
          : []),
      ]);
      if (next === "timeout") return next;
      pendingReport = incoming.next();
      return next.done ? "timeout" : next.value;
    },
    now: () => Date.now(),
    deliverNotifications: () => startDailySearchAlertsStep(day),
  });
  // The homepage, inventory caches, warmup and IndexNow run on their own
  // inventory-downstream cron, so a pass that never completes cannot hold
  // them back. The stale-rebuild sweep stays here until the search projector
  // owns it.
  if (outcome === "completed") {
    await cleanupStaleDurableAlgoliaRebuildsStep();
  }
  return { status: outcome, day };
}

/**
 * One source run. Staging runs in parallel with other sources (the pass
 * starts sources that share a host one at a time); the commit
 * (reconciliation and Algolia publication) waits its turn. The run is
 * released once its inventory is searchable; alerts are checked daily.
 */
export async function vehicleIngestionWorkflow(
  runId: string,
  day?: string,
  // The claims the pass admitted the run with (see `StartedRun`).
  claims?: HostClaims,
) {
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
  let yielded: HostClaims | null = null;
  try {
    const result = await runSourceIngestion(runId, day, claims);
    failed = false;
    completed = result.status === "completed";
    if (result.status === "yielded") {
      yielded = result.claims;
      // Release the run's token before detaching: a pass that sees the run
      // detached may start its next workflow at once, which must not
      // deduplicate against this one. Detaching only clears this workflow's
      // id, so a next workflow that already attached keeps its own.
      ingestionRun[Symbol.dispose]();
      await detachDurableIngestionWorkflowStep(
        runId,
        getWorkflowMetadata().workflowRunId,
      );
    }
    return result;
  } finally {
    if (yielded !== null) {
      // Still fetching: the pass starts it again once its hosts are free.
      await reportToPass({
        runId,
        yielded,
        admitted: claims ?? HostClaims.none,
      });
    } else {
      // A completed run reported itself after publishing; any other outcome
      // shows the provider delayed while its last inventory stays up.
      if (!completed) await reportProviderStatusStep(runId);
      if (day !== undefined) await reportToPass({ runId, failed });
    }
  }
}

/**
 * Reports to the pass, never failing the run: a report the step could not
 * deliver after its retries only delays the pass until its next plan, which
 * reads the run's state from the database.
 */
async function reportToPass(
  report: Extract<IngestionRunReport, { runId: string }>,
) {
  try {
    await reportIngestionRunStep(report);
  } catch (error) {
    console.warn(
      `[Workflow] Run ${report.runId} could not report to its pass; the pass sees it at its next plan: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function runSourceIngestion(
  runId: string,
  day: string | undefined,
  claims: HostClaims | undefined,
) {
  const { workflowRunId } = getWorkflowMetadata();
  await attachDurableIngestionWorkflowStep(runId, workflowRunId);
  const markRunFailed = (failedRunId: string, message: string) =>
    markDurableIngestionFailedStep(failedRunId, message);
  const operations = {
    initialize: initializeDurableIngestionStep,
    runChunk: runDurableSourceChunkStep,
    sleepUntil: (time: number) => sleep(new Date(time)),
    markFailed: markDurableSourceFailedStep,
    validateSources: validateDurableIngestionSourcesStep,
    reconcile: reconcileDurableIngestionStep,
    markRunFailed,
    waitForPublicationMode,
    // A run the day's pass started may fetch only with the claims it was
    // admitted with; an older start passed none, so it hands back first.
    ...(day !== undefined ? { admittedClaims: claims ?? HostClaims.none } : {}),
  };
  // Each source's run fetches and stages in parallel with the others. A run
  // with no accepted source released at validation and never waits for the
  // commit, so its source can retry while another run holds it.
  const staging = await stageDurableIngestion({ runId, operations });
  if (staging.status !== "staged") return staging;
  // Fetching is done, so the pass may start the next run on this run's
  // shared hosts while this one waits for the commit.
  if (day !== undefined) await reportToPass({ runId, fetched: true });

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

    // With search publication switched off or decoupled, the final
    // reconciliation batch already released the run and left its changes
    // for a later rebuild or the search projector. Nothing here may call
    // Algolia.
    if (ingestionResult.search === "skipped") {
      await reportProviderStatusStep(runId);
      await kickSearchProjectorStep();
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
        withSearchWriteLock(() =>
          runProjectionWithFailureRecording({
            runId,
            runBatch: () => runAlgoliaProjectorStep(runId),
            markFailed: markRunFailed,
            waitForPublicationMode,
          }),
        ),
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
    // Each batch scans its searches' pages and writes their checkpoints under
    // the shared writer lock, so a search index rewrite cannot reorder
    // matches between pages. Retry waits and delivery run outside it. While
    // a migration holds the lock, each lock retry heartbeats the check so
    // delivery keeps holding earlier intents for today's digest.
    runBatch: () =>
      withSearchWriteLock(
        () => runSearchAlertCheckBatchStep(day),
        () => touchSearchAlertCheckStep(day),
      ),
    waitForRetry: () => sleep(ALERT_CHECK_RETRY_DELAY),
    startDelivery: startNotificationDeliveryStep,
  });
  return { ...result, day };
}
