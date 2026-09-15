import { Data, Effect, Either, RateLimiter, Schema } from "effect";
import type { IngestionSource } from "~/lib/ingestion-source";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchUpullRPartsCatalog,
  UpullRPartsVehicleSchema,
  UPULLRPARTS_MAX_CATALOG_RECORDS,
  type UpullRPartsVehicle,
  type UpullRPartsProviderError,
} from "./upullrparts-client";
import {
  loadUpullRPartsMakeResolver,
  type UpullRPartsMakeError,
} from "./upullrparts-makes";
import {
  transformUpullRPartsVehicle,
  type UpullRPartsCanonicalVehicle,
} from "./upullrparts-transform";
import {
  findUpullRPartsYard,
  UPULLRPARTS_YARDS,
  type UpullRPartsYard,
} from "./upullrparts-yard-metadata";

/** One atomic catalog checkpoint, not a provider page number. */
export type UpullRPartsCursor = 0 | 1;
export type UpullRPartsStreamResult = Omit<
  ConnectorChunkResult<IngestionSource, UpullRPartsCursor>,
  "source"
> & { source: "upullrparts" };
export const UPULLRPARTS_BATCH_SIZE = 250;
export { UPULLRPARTS_MAX_CATALOG_RECORDS } from "./upullrparts-client";

export class UpullRPartsStreamError extends Data.TaggedError(
  "UpullRPartsStreamError",
)<{ message: string }> {}

export interface UpullRPartsStreamOptions<E, R> {
  startCursor?: UpullRPartsCursor;
  onBatch: (
    vehicles: UpullRPartsCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: UpullRPartsYard[]) => Effect.Effect<void, E, R>;
}

export function streamUpullRPartsInventoryWithRequestGate<E, R>(
  options: UpullRPartsStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
): Effect.Effect<
  UpullRPartsStreamResult,
  UpullRPartsProviderError | UpullRPartsMakeError | UpullRPartsStreamError | E,
  R
> {
  return Effect.gen(function* () {
    const cursor = options.startCursor ?? 0;
    if (cursor !== 0 && cursor !== 1)
      return yield* new UpullRPartsStreamError({
        message:
          "U Pull R Parts cursor must be 0 (catalog pending) or 1 (complete); restart with cursor 0.",
      });
    const result: UpullRPartsStreamResult = {
      source: "upullrparts",
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
    const records = yield* fetchUpullRPartsCatalog(requestGate);
    if (
      records.length === 0 ||
      records.length > UPULLRPARTS_MAX_CATALOG_RECORDS
    ) {
      return yield* new UpullRPartsStreamError({
        message: `U Pull R Parts returned ${records.length} records; expected a nonempty catalog within the ${UPULLRPARTS_MAX_CATALOG_RECORDS}-record checkpoint bound. Inspect the endpoint before retrying; no batches were emitted.`,
      });
    }
    const seen = new Set<string>();
    const observedVins = new Set<string>();
    const unresolved = new Map<number, number>();
    const reported = new Set<string>();
    const vehicles: UpullRPartsCanonicalVehicle[] = [];
    const acceptedRecords: {
      record: UpullRPartsVehicle;
      yard: UpullRPartsYard;
    }[] = [];
    const unresolvedMakes = new Map<string, number>();
    const accounting = {
      recordsProcessed: records.length,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    for (const raw of records) {
      const parsed = Schema.decodeUnknownEither(UpullRPartsVehicleSchema)(raw);
      if (Either.isLeft(parsed)) {
        accounting.recordsRejected += 1;
        continue;
      }
      const record = parsed.right;
      const yard = findUpullRPartsYard(record.Store);
      if (yard) reported.add(yard.code);
      if (!yard || yard.lat === null || yard.lng === null) {
        accounting.recordsExcluded += 1;
        const vin = record.VIN?.trim().toUpperCase();
        if (vin) observedVins.add(vin);
        unresolved.set(record.Store, (unresolved.get(record.Store) ?? 0) + 1);
        continue;
      }
      acceptedRecords.push({ record, yard });
    }
    // There is no upstream total/next link. A missing known store is not
    // terminal completeness evidence and must not retire its prior inventory.
    const missing = UPULLRPARTS_YARDS.filter(
      (yard) => !reported.has(yard.code),
    );
    if (missing.length > 0)
      return yield* new UpullRPartsStreamError({
        message: `U Pull R Parts catalog is missing known yards ${missing.map((yard) => yard.code).join(", ")}. Verify the unfiltered response and yard directory before retrying; no batches were emitted.`,
      });
    const resolveMake = yield* loadUpullRPartsMakeResolver(
      acceptedRecords.map(({ record }) => record),
      requestGate,
    );
    for (const { record, yard } of acceptedRecords) {
      const make = resolveMake(record);
      const vehicle = transformUpullRPartsVehicle(record, yard, make);
      if (!vehicle) {
        accounting.recordsRejected += 1;
        continue;
      }
      if (seen.has(vehicle.vin)) {
        accounting.duplicateVehicles += 1;
        continue;
      }
      seen.add(vehicle.vin);
      vehicles.push(vehicle);
      if (make.status === "unresolved") {
        const reason = `${vehicle.model}: ${make.reason}`;
        unresolvedMakes.set(reason, (unresolvedMakes.get(reason) ?? 0) + 1);
      }
    }
    if (options.onYards) yield* options.onYards([...UPULLRPARTS_YARDS]);
    for (
      let offset = 0;
      offset < vehicles.length;
      offset += UPULLRPARTS_BATCH_SIZE
    ) {
      yield* options.onBatch(
        vehicles.slice(offset, offset + UPULLRPARTS_BATCH_SIZE),
      );
    }
    const warnings = [...unresolved].map(
      ([store, count]) =>
        `U Pull R Parts yard ${store}: skipped ${count} vehicles because yard coordinates are unresolved. Observed VINs preserve known inventory; verify public metadata before adding this yard.`,
    );
    warnings.push(
      ...[...unresolvedMakes].map(
        ([reason, count]) =>
          `U Pull R Parts: retained ${count} vehicles with make Other because ${reason}. No manufacturer was inferred from model names or VINs.`,
      ),
    );
    for (const warning of warnings) yield* Effect.logWarning(warning);
    return {
      ...result,
      count: seen.size,
      pagesProcessed: 1,
      accounting,
      warnings,
      observedVins: [...observedVins],
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        new UpullRPartsStreamError({
          message:
            "U Pull R Parts catalog and make resolution exceeded the four-minute checkpoint budget. Retry from cursor 0; no terminal checkpoint was returned.",
        }),
    }),
  );
}

export function streamUpullRPartsInventory<E, R>(
  options: UpullRPartsStreamOptions<E, R>,
): Effect.Effect<
  UpullRPartsStreamResult,
  UpullRPartsProviderError | UpullRPartsMakeError | UpullRPartsStreamError | E,
  R
> {
  // Includes retries, keeping the single-request protocol polite on failure.
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1500 millis" }).pipe(
      Effect.flatMap((requestGate) =>
        streamUpullRPartsInventoryWithRequestGate(options, requestGate),
      ),
    ),
  );
}
