import { HostClaims } from "./host-claims";

/** How long the pass waits after a run fails before planning again, which
 * resumes the run. Reports keep being handled meanwhile. */
export const FAILED_RUN_RESUME_DELAY_MS = 5 * 60_000;
/** How long the pass waits after its plan or start step fails (a Turso or
 * Workflow API outage) before planning again. */
export const PASS_STEP_RETRY_DELAY_MS = 5 * 60_000;

/**
 * An active run. `started` says a workflow has driven it, so it may be
 * fetching now. `claims` are the shared hosts it needs for its next chunk
 * when not started, and those it may occupy when started; none once it has
 * fetched.
 */
export interface PlannedRun {
  runId: string;
  claims: HostClaims;
  started: boolean;
}

/**
 * Active: `held` are the claims of runs stopped mid-fetch whose last chunk
 * may still be sending requests. `retryAt` is when the pass plans again even
 * while active runs report nothing (such as runs waiting for the commit): the
 * next source without an active run is due a retry, or a stopped run's hosts
 * free up.
 * Expired: the pass outlived its ingestion day. It stops without delivering;
 * the current day's pass delivers once every source is done.
 */
export type IngestionPassPlan =
  | {
      status: "active";
      runs: PlannedRun[];
      held: HostClaims[];
      retryAt: number | null;
    }
  | { status: "waiting"; retryAt: number }
  | { status: "complete" }
  | { status: "expired" };

/**
 * Sent to a day's pass. A source run's workflow reports `fetched` once it
 * has staged, which frees its shared hosts, and `failed` when it stops (older
 * deployments send only this one). `yielded` means it stopped fetching
 * because its next chunk needs other hosts (URG IIS's next tenant), detached
 * its workflow, and waits for the pass to start it again once they are free;
 * `admitted` names the claims that workflow was started with, so a late or
 * repeated report from a workflow the pass already replaced is ignored.
 * `replan` asks the pass to plan again, for a manual run it must admit.
 */
export type IngestionRunReport =
  | { runId: string; failed: boolean }
  | { runId: string; fetched: true }
  | { runId: string; yielded: HostClaims; admitted: HostClaims }
  | { replan: true };

/**
 * What else ends a wait for the next report, besides `deadline` and the end
 * of the pass's day.
 * interval: the watchdog interval since the last plan, however many reports
 * arrive, so runs that report to another pass (another day's, or an older
 * deployment's) free their hosts for runs waiting on them.
 * silence: the watchdog interval without a report, which resumes runs whose
 * workflow died.
 * none: nothing else; the pass waits for a retry with no active run.
 */
export type PassWatchdog = "interval" | "silence" | "none";

/**
 * completed: this pass ran sources and the day is done.
 * already-complete: the day was done before this pass started any source.
 * The hourly cron starts a pass every hour, so this is the usual outcome
 * after the day's work; it must not repeat end-of-day side effects.
 * expired: the pass outlived its ingestion day.
 */
export type IngestionPassOutcome = "completed" | "already-complete" | "expired";

/** A run the pass starts or resumes, with the claims it may fetch with: its
 * chunks hand back to the pass before needing any others. */
export interface StartedRun {
  runId: string;
  claims: HostClaims;
}

export interface IngestionPassOperations {
  /** Resumes active runs and creates runs for due sources. */
  plan: () => Promise<IngestionPassPlan>;
  /** Starts or resumes each run's workflow; a live one keeps running. */
  startRuns: (runs: readonly StartedRun[]) => Promise<void>;
  /** The next report, or "timeout" once `deadline` (a time, when not null),
   * the `watchdog` or the pass's day end arrives. */
  nextReport: (
    deadline: number | null,
    watchdog: PassWatchdog,
  ) => Promise<IngestionRunReport | "timeout">;
  now: () => number;
  /** Starts the day's saved-search alert check, which then delivers. */
  deliverNotifications: () => Promise<void>;
}

function earliest(...times: Array<number | null>): number | null {
  const set = times.filter((time) => time !== null);
  return set.length === 0 ? null : Math.min(...set);
}

/**
 * Drives one ingestion day: starts every due source as its own workflow,
 * waits for their reports, waits until a failed source's retry is due, and
 * starts the day's saved-search alerts once every source published or used
 * its attempts. A watchdog timeout or a failed run re-plans, which resumes any run
 * whose workflow died. A due retry also re-plans, so a source released while
 * others wait for the commit retries on time. A `replan` request ends any
 * wait at once. A plan or start step that fails is retried after a pause, so
 * a short outage does not leave runs waiting for the next hourly pass.
 *
 * A run that fetches from shared hosts starts only once its claims are free
 * (`HostClaims.admit`), so no two runs fetch from one lane at once and no
 * group holds more runs than its places. Runs that claim fewer lanes go
 * first, since a run over several lanes holds them all. A run started before
 * (by this pass or another) keeps its claims until it reports; one this pass
 * admitted keeps the claims it was admitted with, since it yields before
 * needing others.
 */
export async function runIngestionPass(
  operations: IngestionPassOperations,
): Promise<IngestionPassOutcome> {
  // Invoke step callbacks without serializing the operations object as `this`.
  const { plan, startRuns, nextReport, now, deliverNotifications } = operations;
  const retryLater = async (step: string, error: unknown) => {
    console.warn(
      `[Workflow] Ingestion pass ${step} failed; planning again in ${PASS_STEP_RETRY_DELAY_MS / 60_000} minutes. Runs already started keep running: ${error instanceof Error ? error.message : String(error)}`,
    );
    const until = now() + PASS_STEP_RETRY_DELAY_MS;
    // Reports that arrive meanwhile are dropped: the next plan reads every
    // run's state from the database.
    while (true) {
      const report = await nextReport(until, "none");
      if (report === "timeout" || "replan" in report) return;
    }
  };
  let startedRuns = false;
  // Runs that may be fetching, with the claims they hold. `admitted` marks
  // the ones this pass admitted, whose claims are what they may fetch with.
  let fetching = new Map<string, { claims: HostClaims; admitted: boolean }>();
  while (true) {
    let next: IngestionPassPlan;
    try {
      next = await plan();
    } catch (error) {
      await retryLater("plan", error);
      continue;
    }
    if (next.status === "expired") return "expired";
    if (next.status === "complete") break;
    if (next.status === "waiting") {
      await nextReport(next.retryAt, "none");
      continue;
    }
    const before = fetching;
    fetching = new Map();
    const waiting: PlannedRun[] = [];
    for (const run of next.runs) {
      if (HostClaims.isNone(run.claims)) continue;
      const known = before.get(run.runId);
      // A run this pass admitted whose workflow has not attached yet keeps
      // its claims; one that detached to need others waits for them.
      if (
        known?.admitted &&
        (run.started || HostClaims.equal(known.claims, run.claims))
      )
        fetching.set(run.runId, known);
      else if (run.started)
        fetching.set(run.runId, { claims: run.claims, admitted: false });
      else waiting.push(run);
    }
    waiting.sort((a, b) => a.claims.lanes.length - b.claims.lanes.length);
    const admit = () => {
      const admitted = HostClaims.admit(waiting, [
        ...[...fetching.values()].map((run) => run.claims),
        ...next.held,
      ]);
      for (const run of admitted) {
        waiting.splice(waiting.indexOf(run), 1);
        fetching.set(run.runId, { claims: run.claims, admitted: true });
      }
      return admitted.map((run) => run.runId);
    };
    // A run this pass did not admit holds every lane it might reach, but its
    // resumed workflow may fetch only from those no other run holds; at any
    // other it hands back and waits for admission.
    const startedRun = (runId: string): StartedRun => {
      const run = fetching.get(runId);
      if (!run) return { runId, claims: HostClaims.none };
      if (run.admitted) return { runId, claims: run.claims };
      const others = new Set(
        [
          ...fetching.entries(),
          ...next.held.map((claims) => ["", { claims }] as const),
        ]
          .filter(([other]) => other !== runId)
          .flatMap(([, other]) => other.claims.lanes),
      );
      return {
        runId,
        claims: {
          lanes: run.claims.lanes.filter((lane) => !others.has(lane)),
          places: run.claims.places,
        },
      };
    };
    admit();
    const started = next.runs
      .map((run) => run.runId)
      .filter((runId) => !waiting.some((run) => run.runId === runId));
    startedRuns = true;
    if (started.length > 0) {
      try {
        await startRuns(started.map(startedRun));
      } catch (error) {
        // Admitted runs keep their claims, so the next plan starts them.
        await retryLater("start", error);
        continue;
      }
    }
    const pending = new Set(started);
    // After a failed run, the next plan (which resumes it) waits until then.
    let resumeAt: number | null = null;
    while (pending.size > 0 || waiting.length > 0 || resumeAt !== null) {
      const report = await nextReport(
        earliest(next.retryAt, resumeAt),
        waiting.length > 0 ? "interval" : "silence",
      );
      if (report === "timeout" || "replan" in report) break;
      // A run that reports was started elsewhere; it never needs admission.
      const reported = waiting.findIndex((run) => run.runId === report.runId);
      if (reported >= 0) waiting.splice(reported, 1);
      if ("yielded" in report) {
        const known = fetching.get(report.runId);
        // The pass already started a later workflow for this run.
        if (known?.admitted && !HostClaims.equal(known.claims, report.admitted))
          continue;
        fetching.delete(report.runId);
        // It is mid-crawl, so it goes first once its next hosts are free.
        waiting.unshift({
          runId: report.runId,
          claims: report.yielded,
          started: false,
        });
      } else if ("fetched" in report) {
        fetching.delete(report.runId);
      } else {
        pending.delete(report.runId);
        // A run that failed while fetching is resumed by the next plan from
        // its checkpoint, so it keeps its claims until then.
        if (report.failed) resumeAt ??= now() + FAILED_RUN_RESUME_DELAY_MS;
        else fetching.delete(report.runId);
      }
      const admitted = admit();
      if (admitted.length > 0) {
        try {
          await startRuns(admitted.map(startedRun));
        } catch (error) {
          await retryLater("start", error);
          break;
        }
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
