import type {
  DurableIngestionResult,
  DurableSourceChunkResult,
  InitializeDurableIngestionResult,
} from "./durable-ingestion-types";
import {
  DURABLE_INITIAL_SOURCE_CURSORS,
  durableSourceCursorEquals,
  type DurableCursorFor,
  type DurableIngestionSource,
  type DurableSourceCursor,
} from "./durable-source";

const HYPERBROWSER_SOURCES: ReadonlySet<DurableIngestionSource> = new Set([
  "pyp",
  "upullitdavie",
]);

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
  reconcile: (runId: string) => Promise<DurableIngestionResult>;
  markRunFailed: (runId: string, message: string) => Promise<void>;
  cleanupSnapshots: (runId: string) => Promise<void>;
}

export type DurableIngestionExecution =
  | { status: "deduplicated"; activeRunId: string | null }
  | { status: "completed"; ingestion: DurableIngestionResult };

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown ingestion error";
}

export async function ingestDurableSource<
  Source extends DurableIngestionSource,
>(params: {
  runId: string;
  initialCursor: DurableCursorFor<Source>;
  operations: DurableSourceOperations<NoInfer<Source>>;
}): Promise<DurableSourceChunkResult<Source>> {
  let cursor = params.initialCursor;
  const source = cursor.source;
  try {
    while (true) {
      const result = await params.operations.runChunk(params.runId, cursor);
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
    return params.operations.markFailed(
      params.runId,
      source,
      `${source} ingestion failed: ${formatError(error)}`,
    );
  }
}

export async function executeDurableIngestion(params: {
  runId: string;
  operations: DurableIngestionOperations;
}): Promise<DurableIngestionExecution> {
  await params.operations.cleanupStale();
  const initialized = await params.operations.initialize(params.runId);
  if (initialized.status === "deduplicated") return initialized;

  let ingestion: DurableIngestionResult;
  try {
    const ingestSource = (initialCursor: DurableSourceCursor) =>
      ingestDurableSource({
        runId: params.runId,
        initialCursor,
        operations: params.operations,
      });
    const hyperbrowserCursors = DURABLE_INITIAL_SOURCE_CURSORS.filter(
      (cursor) => HYPERBROWSER_SOURCES.has(cursor.source),
    );
    const otherCursors = DURABLE_INITIAL_SOURCE_CURSORS.filter(
      (cursor) => !HYPERBROWSER_SOURCES.has(cursor.source),
    );

    await Promise.all([
      (async () => {
        for (const cursor of hyperbrowserCursors) {
          await ingestSource(cursor);
        }
      })(),
      ...otherCursors.map(ingestSource),
    ]);
    ingestion = await params.operations.reconcile(params.runId);
  } catch (error) {
    try {
      await params.operations.markRunFailed(
        params.runId,
        `Durable ingestion failed: ${formatError(error)}`,
      );
    } catch (markError) {
      console.error("Failed to record durable ingestion failure", markError);
    }
    throw error;
  }

  try {
    await params.operations.cleanupSnapshots(params.runId);
  } catch (error) {
    console.warn(
      `Snapshot cleanup failed for completed ingestion run ${params.runId}. Stale snapshot cleanup will retry it later.`,
      error,
    );
  }
  return { status: "completed", ingestion };
}
