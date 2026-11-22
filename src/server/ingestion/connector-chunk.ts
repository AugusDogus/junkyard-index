import type { PipelineSourceName } from "./pipeline-policy";

export type ConnectorChunkStatus = "paused" | "complete" | "failed";

export interface ConnectorChunkAccounting {
  recordsProcessed: number;
  recordsExcluded: number;
  recordsRejected: number;
  duplicateVehicles: number;
}

export interface ConnectorChunkResult<
  Source extends PipelineSourceName,
  Cursor,
> {
  source: Source;
  status: ConnectorChunkStatus;
  cursor: Cursor;
  count: number;
  errors: string[];
  pagesProcessed: number;
  /** Raw rows, including intentional exclusions, before transformation and deduplication. */
  accounting?: ConnectorChunkAccounting;
  warnings?: string[];
  /** VINs seen in inventory without enough metadata to emit a full vehicle. */
  observedVins?: string[];
  /** Opaque, validated provider progress, stored privately with this checkpoint.
   * Cursors using this protocol have a statePath field replaced atomically. */
  checkpointState?: unknown;
  /** The crawl started over in this chunk. Its vehicles, observations and
   * counts replace everything earlier chunks of the run staged. */
  restart?: true;
  failureKind?: "validation";
}

export function connectorChunkMetrics(
  result: Pick<
    ConnectorChunkResult<PipelineSourceName, unknown>,
    "count" | "errors" | "accounting"
  >,
  uniqueVehicles: number,
) {
  const rejectedVehicles =
    result.accounting?.recordsRejected ?? result.errors.length;
  // Rows whose yard cannot be identified are outside the accepted inventory.
  const vehiclesProcessed = result.accounting
    ? result.accounting.recordsProcessed - result.accounting.recordsExcluded
    : result.count;
  return {
    vehiclesProcessed,
    uniqueVehicles,
    duplicateVehicles: Math.max(
      result.accounting?.duplicateVehicles ?? 0,
      vehiclesProcessed - uniqueVehicles - rejectedVehicles,
    ),
    rejectedVehicles,
  };
}
