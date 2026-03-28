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
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import type { CanonicalVehicle } from "./types";

const PAGE_SIZE = 1000;
const PAGE_DELAY_MS = 200;
const PAGE_FETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 30_000;
const TIMEOUT_RETRY_LIMIT = 2;
const TIMEOUT_RETRY_BASE_DELAY_MS = 1_000;
const LOCATION_PAGE_SIZE = 100;
// Measured against live Row52 OData on 2026-03-27:
// 19 locationId OR clauses succeed, 20 fails with node-count-limit=100.
export const ROW52_LOCATION_FILTER_CHUNK_SIZE = 19;
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

export const Row52LocationSchema = Schema.Struct({
  id: Schema.Number,
  accountId: Schema.String,
  name: Schema.String,
  code: Schema.String,
  address1: Schema.String,
  address2: Schema.NullOr(Schema.String),
  city: Schema.String,
  zipCode: Schema.String,
  stateId: Schema.Number,
  phone: Schema.NullOr(Schema.String),
  hours: Schema.String,
  latitude: Schema.Number,
  longitude: Schema.Number,
  isActive: Schema.Boolean,
  isVisible: Schema.Boolean,
  isParticipating: Schema.Boolean,
  webUrl: Schema.NullOr(Schema.String),
  logoUrl: Schema.NullOr(Schema.String),
  partsPricingUrl: Schema.NullOr(Schema.String),
  state: Schema.optional(Row52StateSchema),
});

const Row52SearchLocationSchema = Schema.Struct({
  locationId: Schema.Number,
  name: Schema.String,
  code: Schema.String,
  address1: Schema.String,
  address2: Schema.NullOr(Schema.String),
  state: Schema.String,
  stateAbbreviation: Schema.NullOr(Schema.String),
  hours: Schema.String,
  phone: Schema.NullOr(Schema.String),
  city: Schema.String,
  zipCode: Schema.String,
  latitude: Schema.Number,
  longitude: Schema.Number,
  webUrl: Schema.NullOr(Schema.String),
  logoUrl: Schema.NullOr(Schema.String),
  partsPricingUrl: Schema.NullOr(Schema.String),
  isParticipating: Schema.Boolean,
  isPublishable: Schema.Boolean,
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

export const Row52VehicleSchema = Schema.Struct({
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
  const fetchPage = (skip: number) =>
    fetchRow52OData({
      endpoint: API_ENDPOINTS.ROW52_LOCATION_SEARCH,
      queryString: buildQuery({
        filter: { isPublishable: true },
        orderBy: "name asc",
        count: skip === 0,
        skip,
        top: LOCATION_PAGE_SIZE,
      }),
      itemSchema: Row52SearchLocationSchema,
      ...ROW52_FETCH_OPTIONS,
    });

  return Effect.gen(function* () {
    const map = new Map<number, Row52Location>();
    let skip = 0;
    let totalCount: number | undefined;

    while (totalCount === undefined || skip < totalCount) {
      const data = yield* fetchPage(skip);
      totalCount ??= data["@odata.count"];

      for (const loc of data.value) {
        if (!loc.isParticipating || !loc.isPublishable) continue;
        const region = normalizeRegion(
          loc.state,
          loc.stateAbbreviation ?? loc.state,
        );
        map.set(loc.locationId, {
          id: loc.locationId,
          accountId: "",
          name: loc.name,
          code: loc.code,
          address1: loc.address1,
          address2: loc.address2,
          city: loc.city,
          zipCode: loc.zipCode,
          stateId: 0,
          phone: loc.phone || null,
          hours: loc.hours,
          latitude: loc.latitude,
          longitude: loc.longitude,
          isActive: true,
          isVisible: true,
          isParticipating: loc.isParticipating,
          webUrl: loc.webUrl,
          logoUrl: loc.logoUrl,
          partsPricingUrl: loc.partsPricingUrl,
          state: {
            id: 0,
            name: region.state,
            abbreviation: region.stateAbbr,
            countryId: 0,
          },
        });
      }

      if (data.value.length < LOCATION_PAGE_SIZE) {
        break;
      }
      skip += LOCATION_PAGE_SIZE;
    }

    return map;
  });
}

interface Row52VehiclesPage {
  chunkIndex: number;
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

export function chunkLocationIds(
  locationIds: ReadonlyArray<number>,
  chunkSize: number,
): number[][] {
  const chunks: number[][] = [];
  for (let start = 0; start < locationIds.length; start += chunkSize) {
    chunks.push(locationIds.slice(start, start + chunkSize));
  }
  return chunks;
}

export function buildLocationIdFilter(
  locationIds: ReadonlyArray<number>,
): string {
  if (locationIds.length === 0) {
    throw new Error("Row52 vehicle query requires at least one locationId");
  }

  return `isActive eq true and (${locationIds
    .map((locationId) => `locationId eq ${locationId}`)
    .join(" or ")})`;
}

export function buildVehicleQuery(
  skip: number,
  includeCount: boolean,
  locationIds: ReadonlyArray<number>,
): string {
  const params = new URLSearchParams({
    $filter: buildLocationIdFilter(locationIds),
    $expand: "model($expand=make),location($expand=state),images",
    $orderby: "dateAdded desc",
    $top: String(PAGE_SIZE),
    $skip: String(skip),
  });

  if (includeCount) {
    params.set("$count", "true");
  }

  return `?${params.toString()}`;
}

function fetchVehiclePageEffect(
  skip: number,
  includeCount: boolean,
  locationIds: ReadonlyArray<number>,
  chunkIndex: number,
): Effect.Effect<Row52VehiclesPage, Error, HttpClient.HttpClient> {
  const queryString = buildVehicleQuery(skip, includeCount, locationIds);
  return fetchRow52OData({
    endpoint: API_ENDPOINTS.ROW52_VEHICLES,
    queryString,
    itemSchema: Row52VehicleSchema,
    ...ROW52_FETCH_OPTIONS,
  }).pipe(
    Effect.map((response) => ({
      chunkIndex,
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

export function transformRow52Vehicle(
  vehicle: Row52Vehicle,
  locationMap: Map<number, Row52Location>,
): CanonicalVehicle | null {
  const location = locationMap.get(vehicle.locationId);
  if (!location) return null;

  const state = location.state;
  const rawMake = vehicle.model?.make?.name || "";
  const model = vehicle.model?.name || "";
  const make = normalizeCanonicalMake(rawMake);

  if (!vehicle.vin) return null;
  if (!rawMake || !model) return null;

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
    color: normalizeCanonicalColor(vehicle.color),
    stockNumber: vehicle.barCodeNumber || null,
    imageUrl,
    availableDate: vehicle.dateAdded || null,
    locationCode: location.id.toString(),
    locationName: location.name,
    locationCity: location.city,
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
    let nextSkip = 0;
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
    const locationChunks = chunkLocationIds(
      Array.from(locationMap.keys()).sort((left, right) => left - right),
      ROW52_LOCATION_FILTER_CHUNK_SIZE,
    );
    const chunkTotals = new Map<number, number>();
    yield* Effect.logInfo(
      `[Row52] Crawling ${locationChunks.length} filtered vehicle chunk${locationChunks.length === 1 ? "" : "s"} across ${locationMap.size} yards (chunkSize=${ROW52_LOCATION_FILTER_CHUNK_SIZE})`,
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
          chunkTotals.set(page.chunkIndex, page.totalCount);
          knownTotalCount = Array.from(chunkTotals.values()).reduce(
            (sum, count) => sum + count,
            0,
          );
        }

        yield* Effect.logInfo(
          `[Row52] Fetched chunk=${page.chunkIndex + 1}/${locationChunks.length} page skip=${page.skip}: ${page.vehicles.length} vehicles (total: ${knownTotalCount ?? "unknown"})`,
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
        nextSkip = pagesProcessed * PAGE_SIZE;
      });

    for (
      let chunkIndex = 0;
      chunkIndex < locationChunks.length && !stopped;
      chunkIndex += 1
    ) {
      const locationIds = locationChunks[chunkIndex];
      if (!locationIds || locationIds.length === 0) continue;

      const firstPage = yield* fetchVehiclePageEffect(
        0,
        true,
        locationIds,
        chunkIndex,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new Row52ProviderError({
              skip: 0,
              cause: new Error(
                `chunk=${chunkIndex + 1}/${locationChunks.length}: ${cause.message}`,
              ),
            }),
        ),
      );
      yield* processPage(firstPage);

      if (firstPage.vehicles.length < PAGE_SIZE) {
        yield* emitProgress(false);
        continue;
      }

      const totalRows = firstPage.totalCount;

      if (totalRows === undefined) {
        let chunkSkip = PAGE_SIZE;
        let terminatedNormally = false;
        while (!stopped) {
          const pageResult = yield* fetchVehiclePageEffect(
            chunkSkip,
            false,
            locationIds,
            chunkIndex,
          ).pipe(
            Effect.map((page) => ({ ok: true as const, page }) as const),
            Effect.catchAll((error) =>
              Effect.succeed({
                ok: false as const,
                error,
              } as const),
            ),
          );

          if (!pageResult.ok) {
            const msg = `Row52 chunk=${chunkIndex + 1}/${locationChunks.length} page at skip=${chunkSkip}: ${pageResult.error.message}`;
            yield* Effect.logError(msg);
            errors.push(msg);
            stopped = true;
          } else {
            yield* processPage(pageResult.page);
            if (pageResult.page.vehicles.length < PAGE_SIZE) {
              terminatedNormally = true;
              break;
            }
            chunkSkip += PAGE_SIZE;
            if (PAGE_DELAY_MS > 0) {
              yield* Effect.sleep(Duration.millis(PAGE_DELAY_MS));
            }
          }

          yield* emitProgress(stopped);
        }
        if (terminatedNormally) {
          yield* Effect.logInfo(
            `[Row52] Chunk ${chunkIndex + 1}/${locationChunks.length} terminated normally (unknown totalRows) at skip=${chunkSkip}`,
          );
        }
        continue;
      }

      const remainingSkips: number[] = [];
      for (let skip = PAGE_SIZE; skip < totalRows; skip += PAGE_SIZE) {
        remainingSkips.push(skip);
      }

      let stopChunk = false;
      for (
        let chunkStart = 0;
        chunkStart < remainingSkips.length && !stopChunk;
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
                yield* Effect.sleep(Duration.millis(index * PAGE_DELAY_MS));
              }
              return yield* fetchVehiclePageEffect(
                skip,
                false,
                locationIds,
                chunkIndex,
              ).pipe(
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
          const msg = `Row52 chunk=${chunkIndex + 1}/${locationChunks.length} page at skip=${result.skip}: ${result.error.message}`;
          yield* Effect.logError(msg);
          errors.push(msg);
        }
        if (firstFailedSkip !== null) {
          stopped = true;
          stopChunk = true;
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
            stopChunk = true;
            break;
          }
        }

        yield* emitProgress(stopped || stopChunk);
      }
    }

    if (!stopped) {
      fullyExhausted = true;
      done = true;
      yield* emitProgress(true);
    } else {
      done = true;
    }

    return {
      source: "row52" as const,
      count: totalCount,
      errors,
      pagesProcessed,
      nextSkip,
      done,
      fullyExhausted,
      stopped,
      totalCount: knownTotalCount,
    };
  });
}
