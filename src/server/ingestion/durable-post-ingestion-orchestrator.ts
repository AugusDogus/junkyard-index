export type DurablePhaseBatchResult = {
  status: "paused" | "complete" | "stopped";
};

export async function drainDurablePhase<Result extends DurablePhaseBatchResult>(
  runBatch: () => Promise<Result>,
): Promise<Result> {
  while (true) {
    const batch = await runBatch();
    if (batch.status !== "paused") return batch;
  }
}

export async function runProjectionWithFailureRecording<
  Result extends DurablePhaseBatchResult,
>(params: {
  runId: string;
  runBatch: () => Promise<Result>;
  markFailed(runId: string, error: string): Promise<void>;
}): Promise<Result> {
  const { runBatch, markFailed } = params;
  try {
    return await drainDurablePhase(runBatch);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await markFailed(
      params.runId,
      `Algolia projection stopped after retries: ${detail}`,
    );
    throw error;
  }
}

export async function drainDurableCleanup(
  runBatch: () => Promise<{ done: boolean }>,
): Promise<void> {
  while (!(await runBatch()).done) {
    // Continue from the durable cleanup cursor.
  }
}

export async function runDurablePublicationLifecycle<
  Projector extends DurablePhaseBatchResult,
  AlertMatching extends DurablePhaseBatchResult,
>(params: {
  runId: string;
  project(runId: string): Promise<Projector>;
  matchAlerts(runId: string): Promise<AlertMatching>;
  reportHealth(runId: string): Promise<void>;
}) {
  // Workflow steps must not capture params and its sibling callbacks as `this`.
  const { project, matchAlerts, reportHealth } = params;
  const projector = await project(params.runId);
  if (projector.status === "stopped") {
    return { status: "stopped" as const, phase: "projection" as const };
  }

  const alertMatching = await matchAlerts(params.runId);
  if (alertMatching.status === "stopped") {
    return { status: "stopped" as const, phase: "alert_matching" as const };
  }

  await reportHealth(params.runId);
  return {
    status: "completed" as const,
    projector,
    alertMatching,
  };
}

export async function runDurablePostReleaseLifecycle<
  Delivery extends DurablePhaseBatchResult,
>(params: {
  runId: string;
  deliverAlerts(): Promise<Delivery | null>;
  cleanup(runId: string): Promise<void>;
}) {
  const { deliverAlerts, cleanup } = params;
  const delivery = await deliverAlerts();
  await cleanup(params.runId);
  return { delivery };
}
