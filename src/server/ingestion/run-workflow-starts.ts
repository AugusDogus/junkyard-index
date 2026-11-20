/**
 * live: the run's attached workflow is pending or running.
 * idle: it finished, was cancelled, never attached, or no longer exists.
 * unknown: its status could not be read.
 */
export type RunWorkflowState = "live" | "idle" | "unknown";

/**
 * Starts a workflow for each active run whose attached workflow is not live.
 * A live workflow keeps driving its run, and a second start would only
 * deduplicate against it after paying for a workflow invocation. A run whose
 * state is unknown is started anyway: the run's hook token deduplicates a
 * live workflow, so that costs one invocation and never runs a run twice.
 */
export async function startIdleRunWorkflows(params: {
  runIds: readonly string[];
  /** Each run's attached workflow run id, for runs that have one. */
  attachedWorkflows: (
    runIds: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
  workflowState: (workflowRunId: string) => Promise<RunWorkflowState>;
  start: (runId: string) => Promise<void>;
}): Promise<{ started: string[]; live: string[] }> {
  const { attachedWorkflows, workflowState, start } = params;
  const attached = await attachedWorkflows(params.runIds);
  const states = await Promise.all(
    params.runIds.map(async (runId) => {
      const workflowRunId = attached.get(runId);
      return {
        runId,
        state:
          workflowRunId === undefined
            ? ("idle" as const)
            : await workflowState(workflowRunId),
      };
    }),
  );
  const started = states
    .filter(({ state }) => state !== "live")
    .map(({ runId }) => runId);
  await Promise.all(started.map((runId) => start(runId)));
  return {
    started,
    live: states
      .filter(({ state }) => state === "live")
      .map(({ runId }) => runId),
  };
}
