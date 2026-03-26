import {
  HttpClient,
} from "@effect/platform";
import buildQuery from "odata-query";
import { Effect, Duration, Schema } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import { DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL } from "./constants";
import type {
  Row52Image,
  Row52Location,
  Row52Vehicle,
} from "~/lib/types";
import { Row52ProviderError } from "./errors";
import { fetchRow52OData } from "./row52-transport";
import type { CanonicalVehicle } from "./types";

const PAGE_SIZE = 1000;
const PAGE_DELAY_MS = 200;
const PAGE_FETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 30_000;
const TIMEOUT_RETRY_LIMIT = 2;
const TIMEOUT_RETRY_BASE_DELAY_MS = 1_000;
const ROW52_FETCH_OPTIONS = {
  timeoutMs: FETCH_TIMEOUT_MS,
  retryLimit: TIMEOUT_RETRY_LIMIT,
  retryBaseDelayMs: TIMEOUT_RETRY_BASE_DELAY_MS,
} as const;

const Row52StateSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  abbreviation: Schema.String,
  countryId: Schema.Number,
});

const Row52MakeSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
});

const Row52ModelSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  makeId: Schema.Number,
  make: Schema.optional(Row52MakeSchema),
});

const Row52LocationSchema = Schema.Struct({
  id: Schema.Number,
  accountId: Schema.String,
  name: Schema.String,
  code: Schema.String,
  address1: Schema.String,
  address2: Schema.NullOr(Schema.String),
  city: Schema.String,
  zipCode: Schema.String,
  stateId: Schema.Number,
  phone: Schema.String,
  hours: Schema.String,
  latitude: Schema.Number,
  longitude: Schema.Number,
  isActive: Schema.Boolean,
  isVisible: Schema.Boolean,
  isParticipating: Schema.Boolean,
  webUrl: Schema.String,
  logoUrl: Schema.NullOr(Schema.String),
  partsPricingUrl: Schema.String,
  state: Schema.optional(Row52StateSchema),
});

const Row52ImageSchema = Schema.Struct({
  id: Schema.Number,
  fileName: Schema.String,
  resourceUrl: Schema.String,
  vehicleId: Schema.Number,
  size1: Schema.String,
  size2: Schema.String,
  size3: Schema.String,
  size4: Schema.String,
  original: Schema.String,
  extension: Schema.String,
  caption: Schema.NullOr(Schema.String),
  sortOrder: Schema.Number,
  isActive: Schema.Boolean,
  isVisible: Schema.Boolean,
});

const Row52VehicleSchema = Schema.Struct({
  id: Schema.Number,
  vin: Schema.String,
  modelId: Schema.Number,
  year: Schema.Number,
  locationId: Schema.Number,
  row: Schema.String,
  slot: Schema.NullOr(Schema.String),
  barCodeNumber: Schema.String,
  dateAdded: Schema.String,
  creationDate: Schema.String,
  lastModificationDate: Schema.String,
  isActive: Schema.Boolean,
  isVisible: Schema.Boolean,
  defaultImage: Schema.Number,
  color: Schema.NullOr(Schema.String),
  engine: Schema.NullOr(Schema.String),
  trim: Schema.NullOr(Schema.String),
  transmission: Schema.NullOr(Schema.String),
  model: Schema.optional(Row52ModelSchema),
  location: Schema.optional(Row52LocationSchema),
  images: Schema.optional(Schema.Array(Row52ImageSchema)),
});

function fetchRow52LocationsEffect(): Effect.Effect<
  Map<number, Row52Location>,
  Error,
  HttpClient.HttpClient
> {
  const queryString = buildQuery({
    orderBy: "state/name",
    select: [
      "id",
      "accountId",
      "name",
      "code",
      "address1",
      "address2",
      "city",
      "zipCode",
      "phone",
      "hours",
      "latitude",
      "longitude",
      "isActive",
      "isVisible",
      "isParticipating",
      "webUrl",
      "logoUrl",
      "partsPricingUrl",
      "stateId",
    ],
    expand: "state($select=id,name,abbreviation,countryId)",
    filter: { isParticipating: true },
  });

  return fetchRow52OData({
    endpoint: API_ENDPOINTS.ROW52_LOCATIONS,
    queryString,
    itemSchema: Row52LocationSchema,
    ...ROW52_FETCH_OPTIONS,
  }).pipe(
    Effect.map((data) => {
      const map = new Map<number, Row52Location>();
      for (const loc of data.value) {
        map.set(loc.id, loc);
      }
      return map;
    }),
  );
}

interface Row52VehiclesPage {
  skip: number;
  totalCount?: number;
  vehicles: Row52Vehicle[];
}

export interface Row52StreamResult {
  source: "row52";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextSkip: number;
  done: boolean;
  fullyExhausted: boolean;
  stopped: boolean;
  totalCount?: number;
}

function buildVehicleQuery(skip: number, includeCount: boolean): string {
  return buildQuery({
    filter: { isActive: true },
    expand: ["model($expand=make)", "location($expand=state)", "images"],
    orderBy: "dateAdded desc",
    top: PAGE_SIZE,
    skip,
    count: includeCount,
  });
}

function fetchVehiclePageEffect(
  skip: number,
  includeCount: boolean,
): Effect.Effect<Row52VehiclesPage, Error, HttpClient.HttpClient> {
  const queryString = buildVehicleQuery(skip, includeCount);
  return fetchRow52OData({
    endpoint: API_ENDPOINTS.ROW52_VEHICLES,
    queryString,
    itemSchema: Row52VehicleSchema,
    ...ROW52_FETCH_OPTIONS,
  }).pipe(
    Effect.map((response) => ({
      skip,
      totalCount: response["@odata.count"],
      vehicles: response.value.map((vehicle) => ({
        ...vehicle,
        images: vehicle.images ? [...vehicle.images] : vehicle.images,
      })),
    })),
  );
}

function buildImageUrl(img: Row52Image): string | null {
  if (!img.isActive || !img.isVisible) return null;
  if (!img.size1) return null;
  const baseUrl = img.resourceUrl || `${API_ENDPOINTS.ROW52_CDN}/images/`;
  const ext = img.extension || ".JPG";
  return `${baseUrl}${img.size1}${ext}`;
}

function transformRow52Vehicle(
  vehicle: Row52Vehicle,
  locationMap: Map<number, Row52Location>,
): CanonicalVehicle | null {
  const participatingLocation = locationMap.get(vehicle.locationId);
  const expandedLocation =
    vehicle.location && vehicle.location.isParticipating
      ? vehicle.location
      : undefined;
  const location = participatingLocation ?? expandedLocation;
  if (!location) return null;

  const state = location.state;
  const make = vehicle.model?.make?.name || "";
  const model = vehicle.model?.name || "";

  if (!vehicle.vin) return null;
  if (!make || !model) return null;

  let imageUrl: string | null = null;
  if (vehicle.images && vehicle.images.length > 0) {
    for (const img of vehicle.images) {
      const url = buildImageUrl(img);
      if (url) {
        imageUrl = url;
        break;
      }
    }
  }

  const partsPricingUrl = location.partsPricingUrl || "";

  return {
    vin: vehicle.vin,
    source: "row52",
    year: vehicle.year,
    make,
    model,
    color: vehicle.color || null,
    stockNumber: vehicle.barCodeNumber || null,
    imageUrl,
    availableDate: vehicle.dateAdded || null,
    locationCode: location.id.toString(),
    locationName: location.name,
    state: state?.name || "",
    stateAbbr: state?.abbreviation || "",
    lat: location.latitude,
    lng: location.longitude,
    section: null,
    row: vehicle.row || null,
    space: vehicle.slot || null,
    detailsUrl: `${API_ENDPOINTS.ROW52_WEB}/Vehicle/Index/${vehicle.vin}`,
    partsUrl: partsPricingUrl,
    pricesUrl: partsPricingUrl,
    engine: vehicle.engine ?? null,
    trim: vehicle.trim ?? null,
    transmission: vehicle.transmission ?? null,
  };
}

/**
 * Effect-based Row52 inventory stream.
 */
export function streamRow52Inventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  startSkip?: number;
  pagesPerChunk?: number;
  onProgress?: (progress: {
    nextSkip: number;
    pagesProcessed: number;
    vehiclesProcessed: number;
    fullyExhausted: boolean;
    stopped: boolean;
    totalCount?: number;
    errors: string[];
  }) => Effect.Effect<void, E, R>;
}): Effect.Effect<
  Row52StreamResult,
  Row52ProviderError | E,
  HttpClient.HttpClient | R
> {
  return Effect.gen(function* () {
    const progressEveryPages = Math.max(
      1,
      options.pagesPerChunk ?? DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL,
    );
    let nextSkip = Math.max(0, options.startSkip ?? 0);
    let knownTotalCount: number | undefined;
    let totalCount = 0;
    let pagesProcessed = 0;
    let done = false;
    let fullyExhausted = false;
    let stopped = false;
    let lastProgressPages = 0;
    const errors: string[] = [];

    yield* Effect.logInfo("[Row52] Fetching locations...");
    const locationMap = yield* fetchRow52LocationsEffect().pipe(
      Effect.mapError(
        (cause) => new Row52ProviderError({ skip: -1, cause }),
      ),
    );
    yield* Effect.logInfo(
      `[Row52] Found ${locationMap.size} participating locations`,
    );

    const emitProgress = (force: boolean): Effect.Effect<void, E, R> => {
      if (!options.onProgress) return Effect.succeed(undefined);
      if (!force && pagesProcessed - lastProgressPages < progressEveryPages)
        return Effect.succeed(undefined);
      lastProgressPages = pagesProcessed;
      return options.onProgress({
        nextSkip,
        pagesProcessed,
        vehiclesProcessed: totalCount,
        fullyExhausted,
        stopped,
        totalCount: knownTotalCount,
        errors,
      });
    };

    const processPage = (page: Row52VehiclesPage): Effect.Effect<void, E, R> =>
      Effect.gen(function* () {
        if (page.totalCount !== undefined) {
          knownTotalCount = page.totalCount;
        }

        yield* Effect.logInfo(
          `[Row52] Fetched page at skip=${page.skip}: ${page.vehicles.length} vehicles (total: ${knownTotalCount ?? "unknown"})`,
        );

        const pageCanonical: CanonicalVehicle[] = [];
        for (const row of page.vehicles) {
          const v = transformRow52Vehicle(row, locationMap);
          if (v) pageCanonical.push(v);
        }

        if (pageCanonical.length > 0) {
          yield* options.onBatch(pageCanonical);
        }

        totalCount += pageCanonical.length;
        pagesProcessed += 1;
        nextSkip = page.skip + PAGE_SIZE;
      });

    const firstPage = yield* fetchVehiclePageEffect(nextSkip, true).pipe(
      Effect.mapError(
        (cause) => new Row52ProviderError({ skip: nextSkip, cause }),
      ),
    );
    yield* processPage(firstPage);

    if (firstPage.vehicles.length < PAGE_SIZE) {
      fullyExhausted = true;
      done = true;
      yield* emitProgress(true);
    } else {
      const totalRows = firstPage.totalCount;

      if (totalRows === undefined) {
        let terminatedNormally = false;
        while (!done) {
          const pageResult = yield* fetchVehiclePageEffect(nextSkip, false)
            .pipe(
              Effect.map(
                (page) => ({ ok: true as const, page }) as const,
              ),
              Effect.catchAll((error) =>
                Effect.succeed({
                  ok: false as const,
                  error,
                } as const),
              ),
            );

          if (!pageResult.ok) {
            const msg = `Row52 page at skip=${nextSkip}: ${pageResult.error.message}`;
            yield* Effect.logError(msg);
            errors.push(msg);
            stopped = true;
            done = true;
          } else {
            yield* processPage(pageResult.page);
            if (pageResult.page.vehicles.length < PAGE_SIZE) {
              fullyExhausted = true;
              done = true;
              terminatedNormally = true;
            } else if (PAGE_DELAY_MS > 0) {
              yield* Effect.sleep(Duration.millis(PAGE_DELAY_MS));
            }
          }

          yield* emitProgress(done);
        }
        if (terminatedNormally) {
          yield* Effect.logInfo(
            `[Row52] Paging terminated normally (unknown totalRows) at skip=${nextSkip}`,
          );
        }
      } else {
        const remainingSkips: number[] = [];
        for (
          let skip = firstPage.skip + PAGE_SIZE;
          skip < totalRows;
          skip += PAGE_SIZE
        ) {
          remainingSkips.push(skip);
        }

        let stopPaging = false;
        for (
          let chunkStart = 0;
          chunkStart < remainingSkips.length && !stopPaging;
          chunkStart += PAGE_FETCH_CONCURRENCY
        ) {
          const chunkSkips = remainingSkips.slice(
            chunkStart,
            chunkStart + PAGE_FETCH_CONCURRENCY,
          );

          const pageResults = yield* Effect.all(
            chunkSkips.map((skip, index) =>
              Effect.gen(function* () {
                if (PAGE_DELAY_MS > 0 && index > 0) {
                  yield* Effect.sleep(
                    Duration.millis(index * PAGE_DELAY_MS),
                  );
                }
                return yield* fetchVehiclePageEffect(skip, false).pipe(
                  Effect.map(
                    (page) =>
                      ({ ok: true as const, skip, page }) as const,
                  ),
                  Effect.catchAll((error) =>
                    Effect.succeed({
                      ok: false as const,
                      skip,
                      error,
                    } as const),
                  ),
                );
              }),
            ),
            { concurrency: PAGE_FETCH_CONCURRENCY },
          );

          const failedResults = pageResults.filter(
            (
              result,
            ): result is { ok: false; skip: number; error: Error } => !result.ok,
          );
          const firstFailedSkip =
            failedResults.length > 0
              ? Math.min(...failedResults.map((result) => result.skip))
              : null;
          for (const result of failedResults) {
            const msg = `Row52 page at skip=${result.skip}: ${result.error.message}`;
            yield* Effect.logError(msg);
            errors.push(msg);
          }
          if (firstFailedSkip !== null) {
            stopped = true;
            stopPaging = true;
          }

          const successfulPages = pageResults
            .filter(
              (
                result,
              ): result is {
                ok: true;
                skip: number;
                page: Row52VehiclesPage;
              } => result.ok,
            )
            .sort((left, right) => left.skip - right.skip);

          for (const result of successfulPages) {
            if (firstFailedSkip !== null && result.skip >= firstFailedSkip) {
              break;
            }
            yield* processPage(result.page);
            if (result.page.vehicles.length < PAGE_SIZE) {
              fullyExhausted = true;
              stopPaging = true;
              break;
            }
          }

          done = stopPaging;
          yield* emitProgress(done);
        }

        if (!done) {
          fullyExhausted = true;
          done = true;
          yield* emitProgress(true);
        }
      }
    }

    return {
      source: "row52" as const,
      count: totalCount,
      errors,
      pagesProcessed,
      nextSkip,
      done: fullyExhausted,
      fullyExhausted,
      stopped,
      totalCount: knownTotalCount,
    };
  });
}

