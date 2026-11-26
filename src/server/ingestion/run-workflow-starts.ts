/**
 * live: the run's attached workflow is pending or running.
 * idle: it finished, was cancelled, never attached, or no longer exists.
 * unknown: its status could not be read.
 */
export type RunWorkflowState = "live" | "idle" | "unknown";

const MARK_PREFIX = "starting:";

/**
 * What a run's `workflow_run_id` holds while a pass starts its workflow:
 * the run counts as started, so a pass that replaces this one (or the next
 * day's) holds its claims instead of admitting another run on its hosts.
 * A mark older than `GRACE_MS` is a start that never finished, and the run
 * is idle again.
 */
export const StartingMark = {
  GRACE_MS: 2 * 60_000,

  of(now: number): string {
    return MARK_PREFIX + now;
  },

  /** When `workflowRunId` was marked, or null for a real workflow run id. */
  markedAt(workflowRunId: string): number | null {
    if (!workflowRunId.startsWith(MARK_PREFIX)) return null;
    const at = Number(workflowRunId.slice(MARK_PREFIX.length));
    return Number.isSafeInteger(at) ? at : null;
  },
} as const;

/**
 * Starts a workflow for each active run whose attached workflow is not live,
 * with the id it had (null when none) and why it is started. A live workflow
 * keeps driving its run, and a second start would only deduplicate against
 * it after paying for a workflow invocation. A run whose state is unknown is
 * started anyway: the run's hook token deduplicates a live workflow, so that
 * costs one invocation and never runs a run twice.
 */
export async function startIdleRunWorkflows(params: {
  runIds: readonly string[];
  /** Each run's attached workflow run id, for runs that have one. */
  attachedWorkflows: (
    runIds: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
  workflowState: (workflowRunId: string) => Promise<RunWorkflowState>;
  now: () => number;
  start: (
    runId: string,
    previous: string | null,
    state: "idle" | "unknown",
  ) => Promise<void>;
}): Promise<{ started: string[]; live: string[] }> {
  const { attachedWorkflows, workflowState, start, now } = params;
  const attached = await attachedWorkflows(params.runIds);
  const stateOf = async (
    workflowRunId: string | undefined,
  ): Promise<RunWorkflowState> => {
    if (workflowRunId === undefined) return "idle";
    const markedAt = StartingMark.markedAt(workflowRunId);
    if (markedAt === null) return workflowState(workflowRunId);
    return now() - markedAt < StartingMark.GRACE_MS ? "live" : "idle";
  };
  const states = await Promise.all(
    params.runIds.map(async (runId) => ({
      runId,
      previous: attached.get(runId) ?? null,
      state: await stateOf(attached.get(runId)),
    })),
  );
  const toStart = states.flatMap(({ runId, previous, state }) =>
    state === "live" ? [] : [{ runId, previous, state }],
  );
  await Promise.all(
    toStart.map(({ runId, previous, state }) => start(runId, previous, state)),
  );
  return {
    started: toStart.map(({ runId }) => runId),
    live: states
      .filter(({ state }) => state === "live")
      .map(({ runId }) => runId),
  };
}

/**
 * Starts one run's workflow so that no other pass can admit its hosts
 * meanwhile. The run is marked as starting (`StartingMark`) with a
 * compare-and-set from the id it had, and only then does the pass check it
 * still admits (its day has not ended, it was not replaced): a pass that
 * replaces it after that check plans after the mark and holds the run's
 * claims. The new workflow's id then replaces the mark, again only if the
 * mark is still there. A run whose workflow state is unknown is started
 * without a mark, so a deduplicated start never replaces a live id; the new
 * workflow attaches itself in its first step.
 */
export async function startGuarded(params: {
  runId: string;
  previous: string | null;
  state: "idle" | "unknown";
  now: () => number;
  /** Sets the run's workflow run id to `to` if it is still `from`. */
  swap: (
    runId: string,
    from: string | null,
    to: string | null,
  ) => Promise<boolean>;
  /** Whether the starting pass may still admit runs. */
  stillAdmits: () => Promise<boolean>;
  /** Starts the workflow; returns its run id. */
  start: () => Promise<string>;
}): Promise<"started" | "skipped"> {
  const { runId, previous, swap, stillAdmits, start } = params;
  if (params.state === "unknown") {
    if (!(await stillAdmits())) return "skipped";
    await start();
    return "started";
  }
  const mark = StartingMark.of(params.now());
  if (!(await swap(runId, previous, mark))) return "skipped";
  if (!(await stillAdmits())) {
    await swap(runId, mark, previous);
    return "skipped";
  }
  const workflowRunId = await start();
  // The workflow's own first step attaches it too, if this write loses.
  await swap(runId, mark, workflowRunId);
  return "started";
}
