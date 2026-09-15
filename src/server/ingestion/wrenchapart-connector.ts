import { Data, Effect, RateLimiter } from "effect";
import { z } from "zod";
import type { IngestionSource } from "~/lib/ingestion-source";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchWrenchApartLocations,
  fetchWrenchApartVehicles,
  type WrenchApartProviderError,
} from "./wrenchapart-client";
import {
  transformWrenchApartVehicle,
  type WrenchApartCanonicalVehicle,
} from "./wrenchapart-transform";
import {
  wrenchapartPricesUrl,
  wrenchapartYard,
  type WrenchApartYard,
} from "./wrenchapart-yard-metadata";

export const WRENCHAPART_REQUEST_INTERVAL = "1100 millis";

// Resume by stable provider yard ID, never by an array offset in a changing catalog.
export const WrenchApartCursorSchema = z.object({
  source: z.literal("wrenchapart"),
  afterLocationId: z.number().int().nonnegative().safe(),
});
export type WrenchApartCursor = z.infer<typeof WrenchApartCursorSchema>;
export const WrenchApartCursor = {
  initial: { source: "wrenchapart", afterLocationId: 0 },
} as const satisfies { initial: WrenchApartCursor };

export class WrenchApartStreamError extends Data.TaggedError(
  "WrenchApartStreamError",
)<{
  message: string;
}> {}

export type WrenchApartStreamResult = Omit<
  ConnectorChunkResult<IngestionSource, WrenchApartCursor>,
  "source"
> & { source: "wrenchapart" };

interface WrenchApartStreamOptions<E, R> {
  onBatch: (
    vehicles: WrenchApartCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: WrenchApartYard[]) => Effect.Effect<void>;
  startCursor?: WrenchApartCursor;
  /** A page is one complete yard catalog. Defaults to one yard per chunk. */
  maxPages?: number;
}

export function streamWrenchApartInventoryWithRequestGate<E, R>(
  options: WrenchApartStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
): Effect.Effect<
  WrenchApartStreamResult,
  WrenchApartProviderError | WrenchApartStreamError | E,
  R
> {
  return Effect.gen(function* () {
    const parsed = WrenchApartCursorSchema.safeParse(
      options.startCursor ?? WrenchApartCursor.initial,
    );
    const maxPages = options.maxPages ?? 1;
    if (!parsed.success || !Number.isSafeInteger(maxPages) || maxPages < 1) {
      return yield* new WrenchApartStreamError({
        message:
          "Invalid Wrench-A-Part cursor or chunk limit; use a nonnegative safe afterLocationId and a positive safe maxPages",
      });
    }
    let cursor = parsed.data;
    const locations = yield* fetchWrenchApartLocations(requestGate);
    if (
      locations.length === 0 ||
      new Set(locations.map((location) => location.id)).size !==
        locations.length
    ) {
      return yield* new WrenchApartStreamError({
        message:
          "Wrench-A-Part returned an empty or duplicate-ID yard directory; no cursor was advanced. Inspect /locations before retrying",
      });
    }
    const remaining = locations
      .filter((location) => location.id > cursor.afterLocationId)
      .sort((a, b) => a.id - b.id);
    const seen = new Set<string>();
    const observedVins = new Set<string>();
    const warnings: string[] = [];
    let pagesProcessed = 0;
    let recordsProcessed = 0;
    let recordsExcluded = 0;
    let recordsRejected = 0;
    let duplicateVehicles = 0;

    for (const location of remaining.slice(0, maxPages)) {
      const records = yield* fetchWrenchApartVehicles(location.id, requestGate);
      // A changed/ignored provider filter must fail before any of this yard is emitted.
      if (records.some((record) => record.yard !== location.id)) {
        return yield* new WrenchApartStreamError({
          message: `Wrench-A-Part locationId=${location.id} returned vehicles from another yard; its filter contract changed. No cursor was advanced for this yard`,
        });
      }
      const yard = wrenchapartYard(location);
      if (yard && options.onYards) yield* options.onYards([yard]);
      recordsProcessed += records.length;
      if (!yard || yard.lat === null || yard.lng === null) {
        recordsExcluded += records.length;
        for (const record of records) {
          const vin = record.vin?.trim().toUpperCase();
          if (vin) observedVins.add(vin);
        }
        warnings.push(
          `Wrench-A-Part yard ${location.id}: skipped ${records.length} vehicles because /locations lacks a name, city, state, or usable yard coordinates. Observed VINs are preserved; metadata will be retried next run`,
        );
      } else {
        const locatedYard = { ...yard, lat: yard.lat, lng: yard.lng };
        const pricesUrl = wrenchapartPricesUrl(location);
        const batch: WrenchApartCanonicalVehicle[] = [];
        for (const record of records) {
          const vehicle = transformWrenchApartVehicle(
            record,
            locatedYard,
            pricesUrl,
          );
          if (!vehicle) {
            recordsRejected += 1;
          } else if (seen.has(vehicle.vin)) {
            duplicateVehicles += 1;
          } else {
            seen.add(vehicle.vin);
            batch.push(vehicle);
          }
        }
        if (batch.length > 0) yield* options.onBatch(batch);
      }
      // Only advance after callbacks finish. A failed chunk can safely replay this yard.
      cursor = { source: "wrenchapart", afterLocationId: location.id };
      pagesProcessed += 1;
    }
    for (const warning of warnings) yield* Effect.logWarning(warning);
    return {
      source: "wrenchapart",
      status: pagesProcessed === remaining.length ? "complete" : "paused",
      cursor,
      count: seen.size,
      pagesProcessed,
      errors: [],
      warnings,
      observedVins: [...observedVins],
      accounting: {
        recordsProcessed,
        recordsExcluded,
        recordsRejected,
        duplicateVehicles,
      },
    };
  });
}

export function streamWrenchApartInventory<E, R>(
  options: WrenchApartStreamOptions<E, R>,
) {
  return Effect.sleep(WRENCHAPART_REQUEST_INTERVAL).pipe(
    Effect.zipRight(
      Effect.scoped(
        RateLimiter.make({
          limit: 1,
          interval: WRENCHAPART_REQUEST_INTERVAL,
        }).pipe(
          Effect.flatMap((requestGate) =>
            streamWrenchApartInventoryWithRequestGate(options, requestGate),
          ),
        ),
      ),
    ),
  );
}
