import { HostClaims } from "./host-claims";

/**
 * An active run. `claims` are the shared hosts it occupies while it fetches,
 * none once it has fetched. `started` says a workflow has already driven it,
 * so it may be fetching now.
 */
export interface PlannedRun {
  runId: string;
  claims: HostClaims;
  started: boolean;
}

/**
 * Active: `retryAt` is when the next source without an active run is due a
 * retry, if any, so the pass re-plans then even while active runs report
 * nothing (such as runs waiting for the commit).
 * Expired: the pass outlived its ingestion day. It stops without delivering;
 * the current day's pass delivers once every source is done.
 */
export type IngestionPassPlan =
  | { status: "active"; runs: PlannedRun[]; retryAt: number | null }
  | { status: "waiting"; retryAt: number }
  | { status: "complete" }
  | { status: "expired" };

/**
 * Sent to a day's pass. A source run's workflow reports `fetched` once it
 * has staged, which frees its shared hosts, and `failed` when it stops (older
 * deployments send only this one). `replan` asks the pass to plan again, for
 * a manual run it must admit.
 */
export type IngestionRunReport =
  | { runId: string; failed: boolean }
  | { runId: string; fetched: true }
  | { replan: true };

/**
 * completed: this pass ran sources and the day is done.
 * already-complete: the day was done before this pass started any source.
 * The hourly cron starts a pass every hour, so this is the usual outcome
 * after the day's work; it must not repeat end-of-day side effects.
 * expired: the pass outlived its ingestion day.
 */
export type IngestionPassOutcome = "completed" | "already-complete" | "expired";

export interface IngestionPassOperations {
  /** Resumes active runs and creates runs for due sources. */
  plan: () => Promise<IngestionPassPlan>;
  /** Starts or resumes each run's workflow; a live one keeps running. */
  startRuns: (runIds: readonly string[]) => Promise<void>;
  /** The next run report, or "timeout" once the watchdog interval passes or
   * `deadline` (a time, when not null) arrives. */
  nextReport: (
    deadline: number | null,
  ) => Promise<IngestionRunReport | "timeout">;
  sleepUntil: (time: number) => Promise<void>;
  /** Waits before resuming a failed run, which stays active. */
  pauseAfterFailure: () => Promise<void>;
  /** Starts the day's saved-search alert check, which then delivers. */
  deliverNotifications: () => Promise<void>;
}

/**
 * Drives one ingestion day: starts every due source as its own workflow,
 * waits for their reports, sleeps until a failed source's retry is due, and
 * starts the day's saved-search alerts once every source published or used
 * its attempts. A watchdog timeout or a failed run re-plans, which resumes any run
 * whose workflow died. A due retry also re-plans, so a source released while
 * others wait for the commit retries on time.
 *
 * A run that fetches from shared hosts starts only once its claims are free
 * (`HostClaims.admit`), so no two runs fetch from one lane at once and no
 * group holds more runs than its places. Runs that claim fewer lanes go
 * first, since a run over several lanes holds them all. A run started before
 * (by this pass or another) keeps its claims until it reports.
 */
export async function runIngestionPass(
  operations: IngestionPassOperations,
): Promise<IngestionPassOutcome> {
  // Invoke step callbacks without serializing the operations object as `this`.
  const {
    plan,
    startRuns,
    nextReport,
    sleepUntil,
    pauseAfterFailure,
    deliverNotifications,
  } = operations;
  let startedRuns = false;
  // Runs this pass started that have not reported fetching or stopping.
  let fetching = new Map<string, HostClaims>();
  while (true) {
    const next = await plan();
    if (next.status === "expired") return "expired";
    if (next.status === "complete") break;
    if (next.status === "waiting") {
      await sleepUntil(next.retryAt);
      continue;
    }
    const sharing = next.runs.filter((run) => !HostClaims.isNone(run.claims));
    fetching = new Map(
      sharing
        .filter((run) => run.started || fetching.has(run.runId))
        .map((run) => [run.runId, run.claims]),
    );
    const waiting = sharing
      .filter((run) => !fetching.has(run.runId))
      .sort((a, b) => a.claims.lanes.length - b.claims.lanes.length);
    const admit = () => {
      const admitted = HostClaims.admit(waiting, [...fetching.values()]);
      for (const run of admitted) {
        waiting.splice(waiting.indexOf(run), 1);
        fetching.set(run.runId, run.claims);
      }
      return admitted.map((run) => run.runId);
    };
    admit();
    const started = next.runs
      .map((run) => run.runId)
      .filter(
        (runId) =>
          fetching.has(runId) || !waiting.some((run) => run.runId === runId),
      );
    await startRuns(started);
    startedRuns = true;
    const pending = new Set(started);
    while (pending.size > 0 || waiting.length > 0) {
      const report = await nextReport(next.retryAt);
      if (report === "timeout" || "replan" in report) break;
      fetching.delete(report.runId);
      // A run that reports was started elsewhere; it never needs admission.
      const reported = waiting.findIndex((run) => run.runId === report.runId);
      if (reported >= 0) waiting.splice(reported, 1);
      if (!("fetched" in report)) {
        pending.delete(report.runId);
        if (report.failed) {
          await pauseAfterFailure();
          break;
        }
      }
      const admitted = admit();
      if (admitted.length > 0) {
        await startRuns(admitted);
        for (const runId of admitted) pending.add(runId);
      }
    }
  }
  // A finished alert check only retries undelivered intents, so a repeat is
  // harmless and covers a pass that died between its last run and alerts.
  await deliverNotifications();
  return startedRuns ? "completed" : "already-complete";
}

/** Claims the shared commit, waiting for a turn signal while it is busy. */
export async function claimCommitTurn(operations: {
  claim: () => Promise<"claimed" | "busy" | "stopped">;
  waitForTurn: () => Promise<void>;
}): Promise<"claimed" | "stopped"> {
  const { claim, waitForTurn } = operations;
  while (true) {
    const result = await claim();
    if (result !== "busy") return result;
    await waitForTurn();
  }
}
