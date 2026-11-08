/**
 * Expired: the pass outlived its ingestion day. It stops without delivering;
 * the current day's pass delivers once every source is done.
 */
export type IngestionPassPlan =
  | { status: "active"; runIds: string[] }
  | { status: "waiting"; retryAt: number }
  | { status: "complete" }
  | { status: "expired" };

/** Sent by each source run's workflow to its pass when the run stops. */
export interface IngestionRunReport {
  runId: string;
  failed: boolean;
}

/**
 * completed: this pass ran sources and the day is done.
 * already-complete: the day was done before this pass started any source.
 * The hourly cron starts a pass every hour, so this is the usual outcome
 * after the day's work; it must not repeat end-of-day side effects.
 * expired: the pass outlived its ingestion day.
 */
export type IngestionPassOutcome = "completed" | "already-complete" | "expired";

export interface IngestionPassOperations {
  /** Resumes active runs and starts runs for due sources. */
  plan: () => Promise<IngestionPassPlan>;
  startRuns: (runIds: readonly string[]) => Promise<void>;
  /** The next run report, or "timeout" once the watchdog interval passes. */
  nextReport: () => Promise<IngestionRunReport | "timeout">;
  sleepUntil: (time: number) => Promise<void>;
  /** Waits before resuming a failed run, which stays active. */
  pauseAfterFailure: () => Promise<void>;
  deliverNotifications: () => Promise<void>;
}

/**
 * Drives one ingestion day: starts every due source as its own workflow,
 * waits for their reports, sleeps until a failed source's retry is due, and
 * delivers the day's notifications once every source published or used its
 * attempts. A watchdog timeout or a failed run re-plans, which resumes any run
 * whose workflow died.
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
  while (true) {
    const next = await plan();
    if (next.status === "expired") return "expired";
    if (next.status === "complete") break;
    if (next.status === "waiting") {
      await sleepUntil(next.retryAt);
      continue;
    }
    await startRuns(next.runIds);
    startedRuns = true;
    const pending = new Set(next.runIds);
    while (pending.size > 0) {
      const report = await nextReport();
      if (report === "timeout") break;
      pending.delete(report.runId);
      if (report.failed) {
        await pauseAfterFailure();
        break;
      }
    }
  }
  // Delivery sends only undelivered intents, so a repeat is harmless and
  // covers a pass that died between its last run and delivery.
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
