import type { ConnectorChunkStatus } from "./connector-chunk";
import type {
  DurableCursorFor,
  DurableIngestionSource,
} from "./durable-source";
import type { CanonicalVehicle } from "./types";

export type InitializeDurableIngestionResult =
  | { status: "started"; runId: string }
  | { status: "deduplicated"; activeRunId: string | null };

export interface DurableSourceChunkResult<
  Source extends DurableIngestionSource = DurableIngestionSource,
> {
  cursor: DurableCursorFor<Source>;
  status: ConnectorChunkStatus;
  count: number;
  errors: string[];
  pagesProcessed: number;
}

export interface FetchedDurableSourceChunk<
  Source extends DurableIngestionSource = DurableIngestionSource,
> {
  cursor: DurableCursorFor<Source>;
  status: ConnectorChunkStatus;
  pagesProcessed: number;
  vehiclesProcessed: number;
  errors: string[];
  vehicles: CanonicalVehicle[];
}

export interface DurableIngestionResult {
  runId: string;
  totalUpserted: number;
  totalDeleted: number;
  pypCount: number;
  row52Count: number;
  autorecyclerCount: number;
  pullapartCount: number;
  upullitneCount: number;
  errors: string[];
  durationMs: number;
}
