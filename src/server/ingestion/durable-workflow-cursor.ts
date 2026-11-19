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
/** A chunk that returned no checkpoint and must wait before rerunning
 * `cursor`; the workflow sleeps until `retryAt`.
 * - `browser-session`: a shared resource (the single Hyperbrowser session or
 *   the yard's request queue during browser setup) stayed busy, so the chunk
 *   sent no provider requests.
 * - `provider-cooldown`: the provider kept failing transiently or asked for a
 *   longer Retry-After than a chunk can hold. */
export type DurableWorkflowDeferredChunk<
  Source extends DurableIngestionSource = DurableIngestionSource,
> = {
  status: "deferred";
  wait: "browser-session" | "provider-cooldown";
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
