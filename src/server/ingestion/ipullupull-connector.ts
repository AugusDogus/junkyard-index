import { Data, Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { fetchIPullUPullCatalog } from "./ipullupull-client";
import {
  ipullUPullVin,
  isUsableIPullUPullRecord,
  transformIPullUPullVehicle,
  type IPullUPullCanonicalVehicle,
} from "./ipullupull-transform";
import {
  IPULLUPULL_KNOWN_CITIES,
  loadIPullUPullYards,
  type IPullUPullYard,
} from "./ipullupull-yard-metadata";

/** One atomic CSV checkpoint. Never resume an offset into a changing export. */
export type IPullUPullCursor = 0 | 1;
export type IPullUPullStreamResult = ConnectorChunkResult<
  "ipullupull",
  IPullUPullCursor
>;
export const IPULLUPULL_BATCH_SIZE = 250;

export class IPullUPullStreamError extends Data.TaggedError(
  "IPullUPullStreamError",
)<{ message: string }> {}

export interface IPullUPullStreamOptions<E, R> {
  startCursor?: IPullUPullCursor;
  onBatch: (
    vehicles: IPullUPullCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: IPullUPullYard[]) => Effect.Effect<void, E, R>;
}

export function streamIPullUPullInventoryWithRequestGate<E, R>(
  options: IPullUPullStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const cursor = options.startCursor ?? 0;
    if (cursor !== 0 && cursor !== 1)
      return yield* new IPullUPullStreamError({
        message:
          "iPull-uPull cursor must be 0 (pending) or 1 (complete); restart with cursor 0.",
      });
    const result: IPullUPullStreamResult = {
      source: "ipullupull",
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
    const records = yield* fetchIPullUPullCatalog(requestGate);
    const reported = new Set(
      records
        .filter(isUsableIPullUPullRecord)
        .map((record) => record["Yard City"].trim().toUpperCase()),
    );
    const missing = IPULLUPULL_KNOWN_CITIES.filter(
      (city) => !reported.has(city),
    );
    if (missing.length > 0)
      return yield* new IPullUPullStreamError({
        message: `iPull-uPull export is missing usable records for known yards ${missing.join(", ")}; verify the unfiltered catalog before retrying. No batches were emitted.`,
      });

    const accounting = {
      recordsProcessed: records.length,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    const observedVins = new Set<string>();
    const warningCounts = new Map<string, number>();
    const warn = (reason: string) =>
      warningCounts.set(reason, (warningCounts.get(reason) ?? 0) + 1);
    const accepted = [];
    for (const record of records) {
      const vin = ipullUPullVin(record);
      const status = record.Status.trim();
      // Sold assets with unsold parts are not available cars. Do not preserve
      // their VINs as active observations, even when their row is 300.
      if (/^Sold(?: \(\d+ unsold parts?\))?$/.test(status)) {
        accounting.recordsExcluded++;
        warn("sold vehicles (remaining parts do not make the car available)");
        continue;
      }
      if (status !== "Available") {
        accounting.recordsExcluded++;
        if (vin) observedVins.add(vin);
        warn(
          `unknown status ${JSON.stringify(status)}; observed VINs preserved, inspect upstream status semantics`,
        );
        continue;
      }
      if (record["Vehicle Row"].trim() === "300") {
        accounting.recordsExcluded++;
        if (vin) observedVins.add(vin);
        warn(
          "row 300 pre-pulled engines/transmissions only; observed VINs preserved",
        );
        continue;
      }
      if (!record["Yard City"].trim()) {
        accounting.recordsExcluded++;
        if (vin) observedVins.add(vin);
        warn(
          "unlocated records; observed VINs preserved where usable, verify the missing yard metadata",
        );
        continue;
      }
      if (!isUsableIPullUPullRecord(record)) {
        accounting.recordsRejected++;
        if (vin) observedVins.add(vin);
        warn(
          "invalid VIN/year/make/model; usable observed VINs preserved, inspect vehicle metadata",
        );
        continue;
      }
      accepted.push(record);
    }
    const cities = new Set(
      accepted.map((record) => record["Yard City"].trim().toUpperCase()),
    );
    const metadata = yield* loadIPullUPullYards(cities, requestGate);
    const vehicles: IPullUPullCanonicalVehicle[] = [];
    const seen = new Set<string>();
    // Prefer the newest published yard timestamp, then stock number and city.
    // This is independent of provider response ordering across identical VINs.
    accepted.sort(
      (a, b) =>
        b["Yard Date"].localeCompare(a["Yard Date"]) ||
        a["Stock Number"].localeCompare(b["Stock Number"]) ||
        a["Yard City"].localeCompare(b["Yard City"]),
    );
    for (const record of accepted) {
      const city = record["Yard City"].trim().toUpperCase();
      const yard = metadata.yards.get(city);
      const vehicle = yard ? transformIPullUPullVehicle(record, yard) : null;
      if (!vehicle) {
        accounting.recordsExcluded++;
        const vin = ipullUPullVin(record);
        if (vin) observedVins.add(vin);
        warn(
          `unresolved yard ${city}; observed VINs preserved, verify the public directory and yard coordinates`,
        );
        continue;
      }
      if (seen.has(vehicle.vin)) {
        accounting.duplicateVehicles++;
        continue;
      }
      seen.add(vehicle.vin);
      vehicles.push(vehicle);
    }
    if (options.onYards) yield* options.onYards([...metadata.yards.values()]);
    for (
      let offset = 0;
      offset < vehicles.length;
      offset += IPULLUPULL_BATCH_SIZE
    )
      yield* options.onBatch(
        vehicles.slice(offset, offset + IPULLUPULL_BATCH_SIZE),
      );
    const warnings = [
      ...metadata.warnings,
      ...[...warningCounts].map(
        ([reason, count]) => `iPull-uPull: ${count} ${reason}.`,
      ),
    ];
    for (const warning of warnings) yield* Effect.logWarning(warning);
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
      duration: "5 minutes",
      onTimeout: () =>
        new IPullUPullStreamError({
          message:
            "iPull-uPull exceeded the five-minute atomic checkpoint budget; retry from cursor 0. No terminal checkpoint was returned.",
        }),
    }),
  );
}

export function streamIPullUPullInventory<E, R>(
  options: IPullUPullStreamOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1 second" }).pipe(
      Effect.flatMap((requestGate) =>
        streamIPullUPullInventoryWithRequestGate(options, requestGate),
      ),
    ),
  );
}
