import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { vehicle } from "~/schema";
import { Database } from "./context";
import { PersistenceError } from "./errors";
import type { PullapartCachedEnrichment } from "./pullapart-connector";
import type { PullapartVehicle } from "./pullapart-client";

const ENRICHMENT_REFRESH_DAYS = 7;
const MILLISECONDS_PER_DAY = 86_400_000;

function stableVinHash(vin: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < vin.length; index += 1) {
    hash ^= vin.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function shouldRefreshPullapartEnrichment(
  vin: string,
  now: Date,
): boolean {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new RangeError("Pull-A-Part enrichment refresh date is invalid");
  }

  const epochDay = Math.floor(timestamp / MILLISECONDS_PER_DAY);
  const refreshCohort = stableVinHash(vin) % ENRICHMENT_REFRESH_DAYS;
  // Refresh one stable VIN cohort per UTC day so cached provider fields cannot
  // remain stale forever without creating a persistent cache timestamp.
  return epochDay % ENRICHMENT_REFRESH_DAYS === refreshCohort;
}

export function loadPullapartCachedEnrichments(
  rows: ReadonlyArray<PullapartVehicle>,
  now = new Date(),
): Effect.Effect<
  ReadonlyMap<string, PullapartCachedEnrichment>,
  PersistenceError,
  Database
> {
  return Effect.gen(function* () {
    const rowsByVin = new Map<string, PullapartVehicle>();
    for (const row of rows) {
      const vin = row.vin.trim();
      if (vin && !rowsByVin.has(vin)) rowsByVin.set(vin, row);
    }
    if (rowsByVin.size === 0) {
      return new Map<string, PullapartCachedEnrichment>();
    }

    const dbClient = yield* Database;
    const existingRows = yield* Effect.tryPromise({
      try: () =>
        dbClient
          .select({
            vin: vehicle.vin,
            stockNumber: vehicle.stockNumber,
            locationCode: vehicle.locationCode,
            color: vehicle.color,
            imageUrl: vehicle.imageUrl,
            engine: vehicle.engine,
            trim: vehicle.trim,
            transmission: vehicle.transmission,
          })
          .from(vehicle)
          .where(
            and(
              eq(vehicle.source, "pullapart"),
              inArray(vehicle.vin, [...rowsByVin.keys()]),
            ),
          ),
      catch: (cause) =>
        new PersistenceError({
          operation: "pullapartEnrichment.select",
          cause,
        }),
    });

    const cached = new Map<string, PullapartCachedEnrichment>();
    for (const existing of existingRows) {
      const incoming = rowsByVin.get(existing.vin);
      if (
        !incoming ||
        existing.stockNumber !== String(incoming.ticketID) ||
        existing.locationCode !== String(incoming.locID) ||
        shouldRefreshPullapartEnrichment(existing.vin, now)
      ) {
        continue;
      }

      cached.set(existing.vin, {
        color: existing.color,
        imageUrl: existing.imageUrl,
        engine: existing.engine,
        trim: existing.trim,
        transmission: existing.transmission,
      });
    }

    return cached;
  });
}
