import type { ConnectorChunkStatus } from "./connector-chunk";
import type { IngestionSource } from "~/lib/ingestion-source";
import type {
  DurableCursorFor,
  DurableIngestionSource,
} from "./durable-source";
import type { CanonicalVehicle } from "./types";

export type InitializeDurableIngestionResult =
  | { status: "started"; runId: string }
  | { status: "deduplicated"; activeRunId: string | null };

export type DurableIngestionWakeupResult =
  | { status: "start" | "resume"; runId: string }
  | { status: "not_due"; publishedRunId: string };

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
