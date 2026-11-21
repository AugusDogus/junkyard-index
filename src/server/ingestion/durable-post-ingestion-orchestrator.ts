export type DurablePhaseBatchResult = {
  /**
   * mode_unavailable: the batch could not read the publication mode and did
   * nothing; it is retried after a wait, never counted as a failure.
   */
  status: "paused" | "complete" | "stopped" | "mode_unavailable";
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
  waitForPublicationMode(): Promise<void>;
}): Promise<Result> {
  const { runBatch, markFailed, waitForPublicationMode } = params;
  try {
    while (true) {
      const batch = await drainDurablePhase(runBatch);
      if (batch.status !== "mode_unavailable") return batch;
      await waitForPublicationMode();
    }
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

/** Projection releases the run; saved-search alerts run once a day apart. */
export async function runDurablePublicationLifecycle<
  Projector extends DurablePhaseBatchResult,
>(params: {
  runId: string;
  project(runId: string): Promise<Projector>;
  reportHealth(runId: string): Promise<void>;
}) {
  // Workflow steps must not capture params and its sibling callbacks as `this`.
  const { project, reportHealth } = params;
  const projector = await project(params.runId);
  if (projector.status === "stopped") {
    return { status: "stopped" as const, phase: "projection" as const };
  }

  await reportHealth(params.runId);
  return { status: "completed" as const, projector };
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
