import type {
  DurableIngestionResult,
  DurableReconciliationBatchResult,
  DurableSourceChunkResult,
  InitializeDurableIngestionResult,
} from "./durable-ingestion-types";
import type { DurableSourceValidationSummary } from "./durable-source-validation";
import {
  durableSourceCursorEquals,
  getDurableSourceDefinition,
  type DurableCursorFor,
  type DurableIngestionSource,
  type DurableSourceCursor,
} from "./durable-source";

export interface DurableSourceOperations<
  Source extends DurableIngestionSource,
> {
  runChunk: (
    runId: string,
    cursor: DurableCursorFor<Source>,
  ) => Promise<DurableSourceChunkResult<Source>>;
  markFailed: (
    runId: string,
    source: Source,
    message: string,
  ) => Promise<DurableSourceChunkResult<Source>>;
}

export interface DurableIngestionOperations {
  runChunk: <Source extends DurableIngestionSource>(
    runId: string,
    cursor: DurableCursorFor<Source>,
  ) => Promise<DurableSourceChunkResult<Source>>;
  markFailed: <Source extends DurableIngestionSource>(
    runId: string,
    source: Source,
    message: string,
  ) => Promise<DurableSourceChunkResult<Source>>;
  cleanupStale: () => Promise<void>;
  initialize: (runId: string) => Promise<InitializeDurableIngestionResult>;
  validateSources: (runId: string) => Promise<DurableSourceValidationSummary>;
  reconcile: (runId: string) => Promise<DurableReconciliationBatchResult>;
  markRunFailed: (runId: string, message: string) => Promise<void>;
}

export type DurableIngestionCompletion = {
  status: "completed";
  ingestion: DurableIngestionResult;
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

export async function ingestDurableSource<
  Source extends DurableIngestionSource,
>(params: {
  runId: string;
  initialCursor: DurableCursorFor<Source>;
  operations: DurableSourceOperations<NoInfer<Source>>;
}): Promise<DurableSourceChunkResult<Source>> {
  // Workflow step proxies serialize method receivers, including sibling callbacks.
  const { runChunk, markFailed } = params.operations;
  let cursor = params.initialCursor;
  const source = cursor.source;
  try {
    while (true) {
      const result = await runChunk(params.runId, cursor);
      if (result.cursor.source !== source) {
        throw new Error(
          `Source ${source} returned a ${result.cursor.source} cursor`,
        );
      }
      if (result.status !== "paused") return result;
      if (durableSourceCursorEquals(result.cursor, cursor)) {
        throw new Error(
          `Source ${source} returned its current cursor without completing`,
        );
      }
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
  const { cleanupStale, initialize, validateSources, markRunFailed } =
    params.operations;
  return recordingFailure(params.runId, markRunFailed, async () => {
    await cleanupStale();
    const initialized = await initialize(params.runId);
    if (initialized.status === "deduplicated") return initialized;
    const ingestSource = (initialCursor: DurableSourceCursor) =>
      ingestDurableSource({
        runId: params.runId,
        initialCursor,
        operations: params.operations,
      });
    await Promise.all(
      initialized.sources.map((source) =>
        ingestSource(getDurableSourceDefinition(source).initialCursor),
      ),
    );
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
  const { reconcile, markRunFailed } = params.operations;
  return recordingFailure(params.runId, markRunFailed, async () => {
    while (true) {
      const reconciliation = await reconcile(params.runId);
      if (reconciliation.status === "stopped") return reconciliation;
      if (reconciliation.status === "complete") {
        return { status: "completed", ingestion: reconciliation.result };
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
