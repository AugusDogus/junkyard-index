/**
 * How a manual run of a shared-host source reaches the day's pass.
 * pass: the listening pass, or one started for it, plans it now.
 * restarted_pass: the listening pass ran an older deployment, which would
 * start the run on old code, so it was cancelled and a pass on current code
 * started. That pass rebuilds its claims from the database.
 */
export type PassHandoff = {
  via: "pass" | "restarted_pass";
  /** The workflow run of the pass that plans the run. */
  runId: string;
};

export type PassHandoffDependencies = {
  /** The day's listening pass, or null when none holds the day's token. */
  findPass: () => Promise<{ runId: string; deploymentId: string } | null>;
  /** VERCEL_DEPLOYMENT_ID; undefined outside Vercel. */
  currentDeployment: string | undefined;
  /** Asks the pass to plan again; no_pass when it ended meanwhile. */
  replan: (passRunId: string) => Promise<"delivered" | "no_pass">;
  /** Cancels a pass, releasing the day's token; runs it started go on. */
  cancel: (passRunId: string) => Promise<void>;
  /** Starts the day's pass on this deployment; returns its workflow run. */
  startPass: () => Promise<string>;
};

export const PassHandoff = {
  async request(deps: PassHandoffDependencies): Promise<PassHandoff> {
    const pass = await deps.findPass();
    if (pass === null) return { via: "pass", runId: await deps.startPass() };
    if (
      deps.currentDeployment !== undefined &&
      pass.deploymentId !== deps.currentDeployment
    ) {
      await deps.cancel(pass.runId);
      return { via: "restarted_pass", runId: await deps.startPass() };
    }
    return (await deps.replan(pass.runId)) === "delivered"
      ? { via: "pass", runId: pass.runId }
      : { via: "pass", runId: await deps.startPass() };
  },
} as const;
