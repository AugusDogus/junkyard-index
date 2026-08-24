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
  try {
    return await drainDurablePhase(params.runBatch);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await params.markFailed(
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
  const projector = await params.project(params.runId);
  if (projector.status === "stopped") {
    return { status: "stopped" as const, phase: "projection" as const };
  }

  const alertMatching = await params.matchAlerts(params.runId);
  if (alertMatching.status === "stopped") {
    return { status: "stopped" as const, phase: "alert_matching" as const };
  }

  const reportHealth = params.reportHealth;
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
  const delivery = await params.deliverAlerts();
  await params.cleanup(params.runId);
  return { delivery };
}
