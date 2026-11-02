import type { ConnectorChunkStatus } from "./connector-chunk";
import type { IngestionSource } from "~/lib/ingestion-source";
import type {
  DurableCursorFor,
  DurableIngestionSource,
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

export interface DurableIngestionWakeupRun {
  action: "start" | "resume";
  runId: string;
}

/**
 * Active: runs to start or resume. Waiting: nothing to run now, but a source
 * can still run today. Complete: every enabled source published or used its
 * attempts today.
 */
export type DurableIngestionWakeupResult =
  | { status: "active"; runs: DurableIngestionWakeupRun[] }
  | { status: "waiting" }
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
}

export type DurableReconciliationBatchResult =
  | { status: "stopped" }
  | {
      status: "paused";
      phase: "upsert" | "missing";
      cursor: string | null;
    }
  | { status: "complete"; result: DurableIngestionResult };

export interface DurableIngestionResult {
  runId: string;
  totalUpserted: number;
  totalDeleted: number;
  counts: Record<IngestionSource, number>;
  errors: string[];
  durationMs: number;
}
