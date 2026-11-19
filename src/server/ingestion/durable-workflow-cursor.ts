import type {
  DurableCursorFor,
  DurableIngestionSource,
} from "./durable-source";
import type {
  DurableSourceChunkResult,
  DurableIngestionStart,
} from "./durable-ingestion-types";

/** Workflow code transports this reference without loading provider codecs. */
export type DurableCursorReference<
  Source extends DurableIngestionSource = DurableIngestionSource,
> = {
  source: Source;
  snapshotCursor: { path: string; checksum: string };
  retryAt?: number;
};
export type DurableWorkflowCursor<
  Source extends DurableIngestionSource = DurableIngestionSource,
> = DurableCursorFor<Source> | DurableCursorReference<Source>;
export type DurableWorkflowChunkResult<
  Source extends DurableIngestionSource = DurableIngestionSource,
> = Omit<DurableSourceChunkResult<Source>, "cursor"> & {
  cursor: DurableWorkflowCursor<Source>;
};
/** A chunk that could not start because a shared provider resource (the
 * single Hyperbrowser session) stayed busy. It sent no provider requests and
 * saved nothing; the workflow sleeps until `retryAt` and reruns `cursor`. */
export type DurableWorkflowDeferredChunk<
  Source extends DurableIngestionSource = DurableIngestionSource,
> = {
  status: "deferred";
  cursor: DurableWorkflowCursor<Source>;
  retryAt: number;
  reason: string;
};
export type DurableWorkflowStart =
  | Exclude<DurableIngestionStart, { status: "started" }>
  | {
      status: "started";
      runId: string;
      initialCursors: readonly DurableWorkflowCursor[];
    };
