import { Data, Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { PipelineSourceName } from "./pipeline-policy";
import type { ProviderRequestGate } from "./provider-http-client";
import { fetchPartsGaloreCatalog } from "./partsgalore-client";
import {
  isUsablePartsGaloreRecord,
  transformPartsGaloreVehicle,
  type PartsGaloreCanonicalVehicle,
} from "./partsgalore-transform";
import {
  PARTSGALORE_YARD,
  type PartsGaloreYard,
} from "./partsgalore-yard-metadata";

/** Atomic catalog checkpoint, not a provider page or an offset into local rows. */
export type PartsGaloreCursor = 0 | 1;
export type PartsGaloreStreamResult = Omit<
  ConnectorChunkResult<PipelineSourceName, PartsGaloreCursor>,
  "source"
> & { source: "partsgalore" };
export const PARTSGALORE_BATCH_SIZE = 250;
export { PARTSGALORE_MAX_CATALOG_RECORDS } from "./partsgalore-parser";

export class PartsGaloreStreamError extends Data.TaggedError(
  "PartsGaloreStreamError",
)<{
  message: string;
}> {}

export interface PartsGaloreStreamOptions<E, R> {
  startCursor?: PartsGaloreCursor;
  onBatch: (
    vehicles: PartsGaloreCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: PartsGaloreYard[]) => Effect.Effect<void, E, R>;
}

export function streamPartsGaloreInventoryWithRequestGate<E, R>(
  options: PartsGaloreStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const cursor = options.startCursor ?? 0;
    if (cursor !== 0 && cursor !== 1)
      return yield* new PartsGaloreStreamError({
        message:
          "Parts Galore cursor must be 0 (pending catalog) or 1 (complete); restart at 0.",
      });
    const result: PartsGaloreStreamResult = {
      source: "partsgalore",
      status: "complete",
      cursor: 1,
      count: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      pagesProcessed: 0,
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    if (cursor === 1) return result;
    const records = yield* fetchPartsGaloreCatalog(requestGate);
    const accounting = {
      recordsProcessed: records.length,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    const vehicles: PartsGaloreCanonicalVehicle[] = [];
    const seen = new Set<string>();
    const observedVins = new Set<string>();
    for (const record of records) {
      if (!record || !isUsablePartsGaloreRecord(record)) {
        accounting.recordsRejected++;
        continue;
      }
      const vehicle = transformPartsGaloreVehicle(record, PARTSGALORE_YARD);
      if (!vehicle) {
        accounting.recordsExcluded++;
        observedVins.add(record.vin.trim().toUpperCase());
        continue;
      }
      if (seen.has(vehicle.vin)) {
        accounting.duplicateVehicles++;
        continue;
      }
      seen.add(vehicle.vin);
      vehicles.push(vehicle);
    }
    if (vehicles.length === 0 && observedVins.size === 0)
      return yield* new PartsGaloreStreamError({
        message:
          "Parts Galore returned no usable inventory rows. Inspect table #alldata before retrying; no batches were emitted.",
      });
    const warnings =
      observedVins.size > 0
        ? [
            `Parts Galore yard ${PARTSGALORE_YARD.code}: excluded ${accounting.recordsExcluded} rows because yard metadata is incomplete. Observed VINs preserve existing inventory; verify the public contact page before restoring metadata.`,
          ]
        : [];
    for (const warning of warnings) yield* Effect.logWarning(warning);
    if (options.onYards) yield* options.onYards([{ ...PARTSGALORE_YARD }]);
    for (
      let offset = 0;
      offset < vehicles.length;
      offset += PARTSGALORE_BATCH_SIZE
    )
      yield* options.onBatch(
        vehicles.slice(offset, offset + PARTSGALORE_BATCH_SIZE),
      );
    return {
      ...result,
      count: vehicles.length,
      pagesProcessed: 1,
      accounting,
      warnings,
      observedVins: [...observedVins],
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new PartsGaloreStreamError({
          message:
            "Parts Galore exceeded the two-minute catalog checkpoint budget. Retry from cursor 0; no terminal checkpoint was returned.",
        }),
    }),
  );
}

export function streamPartsGaloreInventory<E, R>(
  options: PartsGaloreStreamOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1100 millis" }).pipe(
      Effect.flatMap((requestGate) =>
        streamPartsGaloreInventoryWithRequestGate(options, requestGate),
      ),
    ),
  );
}
