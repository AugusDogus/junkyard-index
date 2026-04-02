import { HttpClient } from "@effect/platform";
import { Effect } from "effect";
import {
  fetchPullapartVehicleExtendedInfo,
  fetchPullapartVehicleImage,
  fetchZipGeo,
  fetchPullapartLocations,
  fetchPullapartMakesOnYard,
  searchPullapartVehicles,
} from "./pullapart-client";
import { DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL } from "./constants";
import { PullapartProviderError } from "./errors";
import { transformPullapartVehicle } from "./pullapart-transform";
import type { CanonicalVehicle } from "./types";

const VEHICLE_ENRICH_CONCURRENCY = 8;

export interface PullapartStreamResult {
  source: "pullapart";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextCursor: string;
  done: boolean;
  fullyExhausted: boolean;
  stopped: boolean;
}

type PullapartProgress = {
  nextCursor: string;
  pagesProcessed: number;
  vehiclesProcessed: number;
  fullyExhausted: boolean;
  stopped: boolean;
  errors: string[];
};

export function streamPullapartInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  pagesPerChunk?: number;
  onProgress?: (
    progress: PullapartProgress,
  ) => Effect.Effect<void, E, R>;
}): Effect.Effect<
  PullapartStreamResult,
  PullapartProviderError | E,
  R | HttpClient.HttpClient
> {
  const makeQueryIndex = (locationIndex: number, makeIndex: number) =>
    locationIndex * 1000 + makeIndex;

  return Effect.gen(function* () {
    const progressEveryPages = Math.max(
      1,
      options.pagesPerChunk ?? DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL,
    );
    let pagesProcessed = 0;
    let vehiclesProcessed = 0;
    let nextCursor = "0:0";
    let fullyExhausted = false;
    let stopped = false;
    let lastProgressPages = 0;
    const errors: string[] = [];
    const geoByZip = new Map<string, { lat: number; lng: number }>();

    const emitProgress = (force: boolean): Effect.Effect<void, E, R> => {
      if (!options.onProgress) return Effect.succeed(undefined);
      if (!force && pagesProcessed - lastProgressPages < progressEveryPages) {
        return Effect.succeed(undefined);
      }
      lastProgressPages = pagesProcessed;
      return options.onProgress({
        nextCursor,
        pagesProcessed,
        vehiclesProcessed,
        fullyExhausted,
        stopped,
        errors,
      });
    };

    const locations = yield* fetchPullapartLocations().pipe(
      Effect.mapError(
        (cause) => new PullapartProviderError({ cursor: "locations", cause }),
      ),
    );

    yield* Effect.logInfo(
      `[Pull-A-Part] Streaming inventory from ${locations.length} locations`,
    );

    for (
      let locationIndex = 0;
      locationIndex < locations.length && !stopped;
      locationIndex += 1
    ) {
      const location = locations[locationIndex]!;
      const cursorPrefix = `${location.locationID}`;

      const makes = yield* fetchPullapartMakesOnYard(location.locationID).pipe(
        Effect.mapError(
          (cause) =>
            new PullapartProviderError({
              cursor: `${cursorPrefix}:makes:${makeQueryIndex(locationIndex, -1)}`,
              cause,
            }),
        ),
      );

      yield* Effect.logInfo(
        `[Pull-A-Part] Location ${location.locationID} (${location.locationName}): ${makes.length} makes on yard`,
      );

      for (
        let makeIndex = 0;
        makeIndex < makes.length && !stopped;
        makeIndex += 1
      ) {
        const make = makes[makeIndex]!;
        nextCursor = `${location.locationID}:${make.makeID}`;

        const response = yield* searchPullapartVehicles({
          locationId: location.locationID,
          makeId: make.makeID,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new PullapartProviderError({
                cursor: `${cursorPrefix}:make:${make.makeID}:${makeQueryIndex(locationIndex, makeIndex)}`,
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

        const enriched = yield* Effect.all(
          [...uniqueRowsByVin.values()].map((row) =>
            Effect.gen(function* () {
              const detail = yield* fetchPullapartVehicleExtendedInfo({
                locationId: row.locID,
                ticketId: row.ticketID,
                lineId: row.lineID,
              });

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
        yield* emitProgress(false);
      }
    }

    if (!stopped) {
      fullyExhausted = true;
      yield* emitProgress(true);
    }

    return {
      source: "pullapart" as const,
      count: vehiclesProcessed,
      errors,
      pagesProcessed,
      nextCursor,
      done: true,
      fullyExhausted,
      stopped,
    };
  });
}
