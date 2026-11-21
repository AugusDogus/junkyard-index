import type {
  DurableWorkflowCursor,
  DurableWorkflowChunkDeferral,
  DurableWorkflowChunkResult,
  DurableWorkflowStart,
} from "./durable-workflow-cursor";
import type {
  DurableIngestionResult,
  DurableReconciliationBatchResult,
  DurableSearchPublication,
} from "./durable-ingestion-types";
import type { DurableSourceValidationSummary } from "./durable-source-validation";
// Type-only: this module runs in the workflow sandbox, which cannot load
// provider cursor codecs. Steps own cursor construction and comparison.
import type { DurableIngestionSource } from "./durable-source";

export interface DurableSourceOperations<
  Source extends DurableIngestionSource,
> {
  sleepUntil?: (time: number) => Promise<void>;
  runChunk: (
    runId: string,
    cursor: DurableWorkflowCursor<Source>,
  ) => Promise<
    DurableWorkflowChunkResult<Source> | DurableWorkflowChunkDeferral<Source>
  >;
  markFailed: (
    runId: string,
    source: Source,
    message: string,
  ) => Promise<DurableWorkflowChunkResult<Source>>;
}

export interface DurableIngestionOperations {
  sleepUntil?: (time: number) => Promise<void>;
  runChunk: <Source extends DurableIngestionSource>(
    runId: string,
    cursor: DurableWorkflowCursor<Source>,
  ) => Promise<
    DurableWorkflowChunkResult<Source> | DurableWorkflowChunkDeferral<Source>
  >;
  markFailed: <Source extends DurableIngestionSource>(
    runId: string,
    source: Source,
    message: string,
  ) => Promise<DurableWorkflowChunkResult<Source>>;
  initialize: (runId: string) => Promise<DurableWorkflowStart>;
  validateSources: (runId: string) => Promise<DurableSourceValidationSummary>;
  reconcile: (runId: string) => Promise<DurableReconciliationBatchResult>;
  markRunFailed: (runId: string, message: string) => Promise<void>;
  /**
   * Waits before retrying a step that could not read the publication mode.
   * The wait never counts toward abandoning the run.
   */
  waitForPublicationMode: () => Promise<void>;
}

export type DurableIngestionCompletion = {
  status: "completed";
  ingestion: DurableIngestionResult;
  search: DurableSearchPublication;
};

export type DurableIngestionExecution =
  | { status: "deduplicated"; activeRunId: string | null }
  | { status: "stopped" }
  | DurableIngestionCompletion;

function formatError(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  // Workflow errors can cross a serialization boundary and lose their prototype.
  // Read only messages and causes, never stringify arbitrary provider payloads.
  while (!seen.has(current)) {
    seen.add(current);
    const message =
      typeof current === "string"
        ? current
        : typeof current === "object" &&
            current !== null &&
            "message" in current
          ? current.message
          : undefined;
    if (
      typeof message === "string" &&
      message.trim() &&
      !messages.some((existing) => existing.endsWith(message.trim()))
    ) {
      messages.push(message.trim());
    }
    if (
      typeof current !== "object" ||
      current === null ||
      !("cause" in current)
    )
      break;
    current = current.cause;
  }
  return messages.join(": ") || "Unknown ingestion error";
}

/** Pause before retrying a chunk deferred by a deep shared host queue, so the
 * source leaves the queue while it drains. */
export const DEFERRED_CHUNK_DELAY_MS = 5 * 60_000;
/** A source that gets no shared host turn in time for this long, with no
 * chunk advancing in between, fails instead of deferring again. Prior
 * inventory stays published and the source retries after its usual delay. */
export const DEFERRED_SOURCE_LIMIT_MS = 3 * 60 * 60_000;

export async function ingestDurableSource<
  Source extends DurableIngestionSource,
>(params: {
  runId: string;
  initialCursor: DurableWorkflowCursor<Source>;
  operations: DurableSourceOperations<NoInfer<Source>>;
}): Promise<DurableWorkflowChunkResult<Source>> {
  // Workflow step proxies serialize method receivers, including sibling callbacks.
  const { runChunk, markFailed, sleepUntil } = params.operations;
  let cursor = params.initialCursor;
  const source = cursor.source;
  // Workflow time of the first deferral since the source last advanced.
  let deferredSince: number | null = null;
  try {
    while (true) {
      if (
        "retryAt" in cursor &&
        typeof cursor.retryAt === "number" &&
        cursor.retryAt > Date.now()
      ) {
        if (!sleepUntil)
          throw new Error(
            `Source ${source} needs a durable provider wait before its next chunk`,
          );
        await sleepUntil(cursor.retryAt);
      }
      const result = await runChunk(params.runId, cursor);
      if (result.cursor.source !== source) {
        throw new Error(
          `Source ${source} returned a ${result.cursor.source} cursor`,
        );
      }
      if (result.status === "deferred") {
        deferredSince ??= Date.now();
        if (Date.now() - deferredSince >= DEFERRED_SOURCE_LIMIT_MS)
          throw new Error(
            `${result.message} No chunk advanced for ${Math.round((Date.now() - deferredSince) / 60_000)} minutes, so the source stopped waiting for shared host turns. Prior inventory is preserved; the source retries after its usual delay. If this repeats, the shared host queue needs more capacity or fewer sources.`,
          );
        if (!sleepUntil)
          throw new Error(
            `Source ${source} needs a durable wait before retrying a deferred chunk: ${result.message}`,
          );
        await sleepUntil(Date.now() + DEFERRED_CHUNK_DELAY_MS);
        continue;
      }
      deferredSince = null;
      if (result.status !== "paused") return result;
      cursor = result.cursor;
    }
  } catch (error) {
    return markFailed(
      params.runId,
      source,
      `${source} ingestion failed: ${formatError(error)}`,
    );
  }
}

export type DurableIngestionStaging =
  | { status: "deduplicated"; activeRunId: string | null }
  | { status: "stopped" }
  | { status: "staged" };

/**
 * Runs part of a run's lifecycle, recording a failure so repeated failures
 * count toward abandoning the run, then rethrows.
 */
export async function recordingFailure<T>(
  runId: string,
  markRunFailed: DurableIngestionOperations["markRunFailed"],
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    try {
      await markRunFailed(
        runId,
        `Durable ingestion failed: ${formatError(error)}`,
      );
    } catch (markError) {
      console.error("Failed to record durable ingestion failure", markError);
    }
    throw error;
  }
}

/**
 * Fetches, stages, and validates the run's sources. This touches only the
 * run's own rows and snapshot chunks, so runs for different sources stage in
 * parallel.
 */
export async function stageDurableIngestion(params: {
  runId: string;
  operations: DurableIngestionOperations;
}): Promise<DurableIngestionStaging> {
  // Invoke step callbacks without serializing the operations object as `this`.
  const { initialize, validateSources, markRunFailed } = params.operations;
  return recordingFailure(params.runId, markRunFailed, async () => {
    const initialized = await initialize(params.runId);
    if (initialized.status === "deduplicated") return initialized;
    const ingestSource = (initialCursor: DurableWorkflowCursor) =>
      ingestDurableSource({
        runId: params.runId,
        initialCursor,
        operations: params.operations,
      });
    await Promise.all(initialized.initialCursors.map(ingestSource));
    const validation = await validateSources(params.runId);
    return validation.status === "stopped"
      ? { status: "stopped" }
      : { status: "staged" };
  });
}

/**
 * Reconciles a staged run into the shared inventory. Callers serialize commits
 * across runs because sources can list the same VIN.
 */
export async function commitDurableIngestion(params: {
  runId: string;
  operations: DurableIngestionOperations;
}): Promise<{ status: "stopped" } | DurableIngestionCompletion> {
  const { reconcile, markRunFailed, waitForPublicationMode } =
    params.operations;
  return recordingFailure(params.runId, markRunFailed, async () => {
    while (true) {
      const reconciliation = await reconcile(params.runId);
      if (reconciliation.status === "stopped") return reconciliation;
      if (reconciliation.status === "mode_unavailable") {
        await waitForPublicationMode();
        continue;
      }
      if (reconciliation.status === "complete") {
        return {
          status: "completed",
          ingestion: reconciliation.result,
          search: reconciliation.search,
        };
      }
    }
  });
}

export async function executeDurableIngestion(params: {
  runId: string;
  operations: DurableIngestionOperations;
}): Promise<DurableIngestionExecution> {
  const staging = await stageDurableIngestion(params);
  if (staging.status !== "staged") return staging;
  return commitDurableIngestion(params);
}
