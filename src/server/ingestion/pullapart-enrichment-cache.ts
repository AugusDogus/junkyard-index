import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { vehicle } from "~/schema";
import { Database } from "./context";
import { PersistenceError } from "./errors";
import type { PullapartCachedEnrichment } from "./pullapart-connector";
import type { PullapartVehicle } from "./pullapart-client";

export function loadPullapartCachedEnrichments(
  rows: ReadonlyArray<PullapartVehicle>,
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
        existing.locationCode !== String(incoming.locID)
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
