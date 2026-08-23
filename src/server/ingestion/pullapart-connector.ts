import { Effect, RateLimiter } from "effect";
import {
  fetchPullapartVehicleExtendedInfo,
  fetchPullapartVehicleImage,
  fetchZipGeo,
  fetchPullapartLocations,
  fetchPullapartMakesOnYard,
  searchPullapartVehicles,
  type PullapartRequestGate,
  type PullapartVehicle,
} from "./pullapart-client";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { PullapartDurableCursor } from "./durable-source";
import { PullapartProviderError } from "./errors";
import { transformPullapartVehicle } from "./pullapart-transform";
import type { CanonicalVehicle } from "./types";

const VEHICLE_ENRICH_CONCURRENCY = 8;
const INVENTORY_REQUESTS_PER_SECOND = 4;

export type PullapartStreamResult = ConnectorChunkResult<
  "pullapart",
  PullapartDurableCursor
>;

export interface PullapartCachedEnrichment {
  color: string | null;
  imageUrl: string | null;
  engine: string | null;
  trim: string | null;
  transmission: string | null;
}

export interface PullapartStreamOptions<E, R> {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  loadCachedEnrichments?: (
    vehicles: ReadonlyArray<PullapartVehicle>,
  ) => Effect.Effect<ReadonlyMap<string, PullapartCachedEnrichment>, E, R>;
  startAfter?: PullapartDurableCursor;
  maxPages?: number;
}

export function streamPullapartInventoryWithRequestGate<E, R>(
  options: PullapartStreamOptions<E, R>,
  inventoryRequestGate: PullapartRequestGate,
): Effect.Effect<PullapartStreamResult, PullapartProviderError | E, R> {
  return Effect.gen(function* () {
    let pagesProcessed = 0;
    let vehiclesProcessed = 0;
    const startAfter = options.startAfter ?? {
      source: "pullapart",
      locationId: 0,
      makeId: 0,
    };
    const { locationId: lastLocationId, makeId: lastMakeId } = startAfter;
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);
    let cursor = startAfter;
    let paused = false;
    const errors: string[] = [];
    const geoByZip = new Map<string, { lat: number; lng: number }>();

    const locations = [
      ...(yield* fetchPullapartLocations().pipe(
        Effect.mapError(
          (cause) => new PullapartProviderError({ cursor: "locations", cause }),
        ),
      )),
    ].sort((left, right) => left.locationID - right.locationID);

    yield* Effect.logInfo(
      `[Pull-A-Part] Streaming inventory from ${locations.length} locations`,
    );

    locationLoop: for (const location of locations) {
      if (location.locationID < lastLocationId) continue;
      const cursorPrefix = `${location.locationID}`;

      const makes = [
        ...(yield* fetchPullapartMakesOnYard(
          location.locationID,
          inventoryRequestGate,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new PullapartProviderError({
                cursor: `${cursorPrefix}:makes`,
                cause,
              }),
          ),
        )),
      ].sort((left, right) => left.makeID - right.makeID);

      yield* Effect.logInfo(
        `[Pull-A-Part] Location ${location.locationID} (${location.locationName}): ${makes.length} makes on yard`,
      );

      for (const make of makes) {
        if (
          location.locationID === lastLocationId &&
          make.makeID <= lastMakeId
        ) {
          continue;
        }
        cursor = {
          source: "pullapart",
          locationId: location.locationID,
          makeId: make.makeID,
        };

        const response = yield* searchPullapartVehicles(
          {
            locationId: location.locationID,
            makeId: make.makeID,
          },
          inventoryRequestGate,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new PullapartProviderError({
                cursor: `${cursorPrefix}:make:${make.makeID}`,
                cause,
              }),
          ),
        );

        const groupedResult = response.find(
          (entry) => entry.locationID === location.locationID,
        );
        const rows = [
          ...(groupedResult?.exact ?? []),
          ...(groupedResult?.other ?? []),
        ];
        let geo = geoByZip.get(location.zipCode);
        if (!geo) {
          geo = yield* fetchZipGeo(location.zipCode).pipe(
            Effect.mapError(
              (cause) =>
                new PullapartProviderError({
                  cursor: `${cursorPrefix}:geo`,
                  cause,
                }),
            ),
          );
          geoByZip.set(location.zipCode, geo);
        }

        const uniqueRowsByVin = new Map<string, (typeof rows)[number]>();
        for (const row of rows) {
          const vin = row.vin?.trim();
          if (!vin || uniqueRowsByVin.has(vin)) continue;
          uniqueRowsByVin.set(vin, row);
        }

        const cachedEnrichments = options.loadCachedEnrichments
          ? yield* options.loadCachedEnrichments([...uniqueRowsByVin.values()])
          : new Map<string, PullapartCachedEnrichment>();

        const enriched = yield* Effect.all(
          [...uniqueRowsByVin.values()].map((row) =>
            Effect.gen(function* () {
              const cached = cachedEnrichments.get(row.vin.trim());
              if (cached) {
                const vehicle = transformPullapartVehicle(row, location, geo);
                if (!vehicle) return null;

                return {
                  ...vehicle,
                  color: cached.color ?? vehicle.color,
                  imageUrl: cached.imageUrl,
                  engine: cached.engine ?? vehicle.engine,
                  trim: cached.trim ?? vehicle.trim,
                  transmission: cached.transmission ?? vehicle.transmission,
                };
              }

              const detail = yield* fetchPullapartVehicleExtendedInfo(
                {
                  locationId: row.locID,
                  ticketId: row.ticketID,
                  lineId: row.lineID,
                },
                inventoryRequestGate,
              );

              const imageUrl = yield* fetchPullapartVehicleImage({
                locationId: row.locID,
                ticketId: row.ticketID,
                lineId: row.lineID,
              });

              return transformPullapartVehicle(row, location, geo, {
                detail,
                imageUrl,
              });
            }).pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  const message = `[Pull-A-Part] Vehicle enrichment failed loc=${row.locID} ticket=${row.ticketID} line=${row.lineID}: ${error.message}`;
                  yield* Effect.logWarning(message);
                  errors.push(message);
                  return null;
                }),
              ),
            ),
          ),
          { concurrency: VEHICLE_ENRICH_CONCURRENCY },
        );

        const batch = enriched.filter(
          (vehicle): vehicle is CanonicalVehicle => vehicle !== null,
        );
        if (batch.length > 0) {
          yield* options.onBatch(batch);
        }

        vehiclesProcessed += batch.length;
        pagesProcessed += 1;
        yield* Effect.logInfo(
          `[Pull-A-Part] Location ${location.locationID} make ${make.makeName}: ${batch.length} vehicles`,
        );
        if (pagesProcessed >= maxPages) {
          const lastLocation = locations.at(-1);
          const lastMake = makes.at(-1);
          if (
            lastLocation?.locationID !== location.locationID ||
            lastMake?.makeID !== make.makeID
          ) {
            paused = true;
            break locationLoop;
          }
        }
      }
    }

    const status =
      errors.length > 0 ? "failed" : paused ? "paused" : "complete";

    return {
      source: "pullapart" as const,
      status,
      cursor,
      count: vehiclesProcessed,
      errors,
      pagesProcessed,
    };
  });
}

export function streamPullapartInventory<E, R>(
  options: PullapartStreamOptions<E, R>,
): Effect.Effect<PullapartStreamResult, PullapartProviderError | E, R> {
  return Effect.scoped(
    RateLimiter.make({
      limit: INVENTORY_REQUESTS_PER_SECOND,
      interval: "1 second",
    }).pipe(
      Effect.flatMap((inventoryRateLimit) =>
        streamPullapartInventoryWithRequestGate(options, inventoryRateLimit),
      ),
    ),
  );
}
