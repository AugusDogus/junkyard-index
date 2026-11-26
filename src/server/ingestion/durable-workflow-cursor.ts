import type { HostClaims } from "./host-claims";
import type {
  DurableCursorFor,
  DurableIngestionSource,
} from "./durable-source";
import type {
  DurableSourceChunkDeferral,
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
  /** Set only on a paused chunk whose next chunk needs shared hosts this one
   * did not use (URG IIS's next tenant on another lane). A run the pass
   * admitted hands its claims back before that chunk. */
  needsClaims?: HostClaims;
};
export type DurableWorkflowChunkDeferral<
  Source extends DurableIngestionSource = DurableIngestionSource,
> = Omit<DurableSourceChunkDeferral<Source>, "cursor"> & {
  cursor: DurableWorkflowCursor<Source>;
};
export type DurableWorkflowStart =
  | Exclude<DurableIngestionStart, { status: "started" }>
  | {
      status: "started";
      runId: string;
      initialCursors: readonly DurableWorkflowCursor[];
    };
