import type { ConnectorChunkStatus } from "./connector-chunk";
import type { IngestionSource } from "~/lib/ingestion-source";
import type {
  DurableCursorFor,
  DurableIngestionSource,
  DurableSourceCursor,
} from "./durable-source";
import type { Yard } from "~/lib/yard";
import type { CanonicalVehicle } from "./types";

export type InitializeDurableIngestionResult =
  | {
      status: "started";
      runId: string;
      sources: readonly DurableIngestionSource[];
    }
  | { status: "deduplicated"; activeRunId: string | null };

/**
 * A started run hands the workflow each source's first cursor. Workflow code
 * only passes cursors between steps, so it never loads provider cursor codecs.
 */
export type DurableIngestionStart =
  | {
      status: "started";
      runId: string;
      initialCursors: readonly DurableSourceCursor[];
    }
  | { status: "deduplicated"; activeRunId: string | null };

export interface DurableIngestionWakeupRun {
  action: "start" | "resume";
  runId: string;
}

/**
 * Active: runs to start or resume. Waiting: nothing to run now, but a source
 * can still run today, at `retryAt` at the earliest. Complete: every enabled source published or used its
 * attempts today.
 */
export type DurableIngestionWakeupResult =
  | { status: "active"; runs: DurableIngestionWakeupRun[] }
  | { status: "waiting"; retryAt: number }
  | { status: "complete" };

export interface DurableSourceChunkResult<
  Source extends DurableIngestionSource = DurableIngestionSource,
> {
  cursor: DurableCursorFor<Source>;
  status: ConnectorChunkStatus;
  count: number;
  errors: string[];
  pagesProcessed: number;
  uniqueVehicles?: number;
  duplicateVehicles?: number;
  rejectedVehicles?: number;
}

/**
 * A chunk that could not get a shared provider host turn in time before it
 * advanced. Nothing was fetched or checkpointed, so it never counts as
 * progress; the source workflow retries `cursor` after a pause.
 */
export interface DurableSourceChunkDeferral<
  Source extends DurableIngestionSource = DurableIngestionSource,
> {
  status: "deferred";
  cursor: DurableCursorFor<Source>;
  message: string;
}

export interface FetchedDurableSourceChunk<
  Source extends DurableIngestionSource = DurableIngestionSource,
> {
  cursor: DurableCursorFor<Source>;
  status: ConnectorChunkStatus;
  pagesProcessed: number;
  vehiclesProcessed: number;
  uniqueVehicles: number;
  duplicateVehicles: number;
  rejectedVehicles: number;
  errors: string[];
  vehicles: CanonicalVehicle[];
  yards: Yard[];
  observedVins?: string[];
  checkpointState?: unknown;
  /** See `ConnectorChunkResult.restart`. */
  restart?: true;
  failureKind?: "validation";
}

/**
 * What a reconciled run still owes search. `pending`: the run holds the
 * commit until it projects its changes (or rebuilds) and matches alerts.
 * `skipped`: the run already released at its final reconciliation batch
 * without publishing search: search publication is switched off (its changes
 * wait for a later rebuild) or decoupled (the search projector publishes its
 * changes from the outbox).
 */
export type DurableSearchPublication = "pending" | "skipped";

export type DurableReconciliationBatchResult =
  | { status: "stopped" }
  /**
   * `ingestion-publication-mode` could not be read, so the batch did not
   * run. Nothing was written; the run waits and retries without counting a
   * failure, since a flags outage says nothing about the run.
   */
  | { status: "mode_unavailable" }
  | {
      status: "paused";
      phase: "upsert" | "missing";
      cursor: string | null;
    }
  | {
      status: "complete";
      result: DurableIngestionResult;
      search: DurableSearchPublication;
    };

export interface DurableIngestionResult {
  runId: string;
  totalUpserted: number;
  totalDeleted: number;
  counts: Record<IngestionSource, number>;
  errors: string[];
  durationMs: number;
}
