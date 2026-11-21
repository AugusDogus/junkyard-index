// Orchestration only: the workflow passes its steps in, so this module stays
// free of database, search and network imports and runs in the workflow
// bundle.
import type { ConsumerTickOutcome } from "./consumer-heartbeats";
import type { ConsumerTickSummary } from "./consumer-report";
import type { SearchProjectorStepResult } from "./search-projector";

/**
 * One search projector step as the workflow sees it: the projector's own
 * result, or why the step did nothing before reaching it.
 *
 * - inline_mode: `ingestion-publication-mode` is not `decoupled`; source runs
 *   publish search themselves.
 * - mode_unavailable: the mode flag could not be read; nothing is written.
 * - paused: the `consumer-search-projector` flag serves false.
 * - refused: this deployment may not hold the search write key.
 */
export type SearchProjectorTick =
  | { status: "inline_mode" }
  | { status: "mode_unavailable" }
  | { status: "paused" }
  | { status: "refused"; message: string }
  | SearchProjectorStepResult;

/** Whether another step right away would make progress. */
export function searchProjectorContinues(tick: SearchProjectorTick): boolean {
  return tick.status === "projected" && !tick.caughtUp;
}

/**
 * How a projector tick reports. Anything that leaves search behind and needs
 * the backend or an operator (a failure, an open circuit, an inline writer
 * still running, a foreign or missing generation, a refused key) is a failed
 * tick, so the heartbeat stays red and the Sentry issue open until it clears.
 */
export function searchProjectorTickOutcome(
  tick: SearchProjectorTick,
): ConsumerTickOutcome {
  switch (tick.status) {
    case "inline_mode":
    case "paused":
    case "current":
    case "projected":
    case "stopped":
      return "succeeded";
    case "mode_unavailable":
    case "refused":
    case "inline_writer_active":
    case "environment_mismatch":
    case "rebuild_required":
    case "circuit_open":
    case "failed":
      return "failed";
  }
}

/**
 * Whether a failed tick raises a Sentry issue: once per circuit opening, not
 * on every tick while it stays open (its heartbeat still fails).
 */
export function searchProjectorTickNotifies(
  tick: SearchProjectorTick,
): boolean {
  switch (tick.status) {
    case "failed":
      return tick.opened;
    case "circuit_open":
      return false;
    default:
      return true;
  }
}

/** A tick flattened to scalars for Sentry attributes. */
export function summarizeSearchProjectorTick(
  tick: SearchProjectorTick,
): ConsumerTickSummary {
  if (tick.status === "inline_writer_active") {
    return { status: tick.status, runIds: tick.runIds.join(",") };
  }
  return { ...tick };
}

/** A projector workflow run's outcome: its last step and the work done. */
export interface SearchProjectorRun {
  last: SearchProjectorTick;
  steps: number;
  changes: number;
}

/** A long run reports progress this often, so its heartbeat stays green. */
const PROGRESS_EVERY_STEPS = 10;

/**
 * Runs projector steps until one has nothing more to do right away, or the
 * run reaches `maxSteps`, after which the next cron tick starts a new run.
 */
export async function runSearchProjector(operations: {
  step(): Promise<SearchProjectorTick>;
  maxSteps: number;
  /** Reports a run still making progress, every few steps. */
  progress(run: SearchProjectorRun): Promise<void>;
}): Promise<SearchProjectorRun> {
  // Invoke steps without serializing the operations object as `this`.
  const { step, maxSteps, progress } = operations;
  let steps = 0;
  let changes = 0;
  while (true) {
    const last = await step();
    steps += 1;
    if (last.status === "projected" || last.status === "failed") {
      changes += last.changes;
    }
    if (!searchProjectorContinues(last) || steps >= maxSteps) {
      return { last, steps, changes };
    }
    if (steps % PROGRESS_EVERY_STEPS === 0) {
      await progress({ last, steps, changes });
    }
  }
}
