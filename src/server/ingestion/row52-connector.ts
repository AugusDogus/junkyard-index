import buildQuery from "odata-query";
import { Effect, Duration, Schema } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Row52Image, Row52Location, Row52Vehicle } from "~/lib/types";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { Row52DurableCursor } from "./durable-source";
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
  Error
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

export type Row52StreamResult = ConnectorChunkResult<
  "row52",
  Row52DurableCursor
>;

export function selectRow52LocationGroup(
  cursor: Row52DurableCursor,
  currentLocationIds: ReadonlyArray<number>,
): number[] {
  if (cursor.locationIds.length > 0) return cursor.locationIds;
  return currentLocationIds
    .filter((locationId) => locationId > cursor.afterLocationId)
    .slice(0, ROW52_LOCATION_FILTER_CHUNK_SIZE);
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
): Effect.Effect<Row52VehiclesPage, Error> {
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
  cursor?: Row52DurableCursor;
  maxPages?: number;
}): Effect.Effect<Row52StreamResult, Row52ProviderError | E, R> {
  return Effect.gen(function* () {
    const initialCursor = options.cursor ?? {
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    };
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);
    let cursor: Row52DurableCursor = initialCursor;
    let totalCount = 0;
    let pagesProcessed = 0;
    const errors: string[] = [];

    yield* Effect.logInfo("[Row52] Fetching locations...");
    const locationMap = yield* fetchRow52LocationsEffect().pipe(
      Effect.mapError((cause) => new Row52ProviderError({ skip: -1, cause })),
    );
    yield* Effect.logInfo(
      `[Row52] Found ${locationMap.size} participating locations`,
    );
    const allLocationIds = Array.from(locationMap.keys()).sort(
      (left, right) => left - right,
    );
    yield* Effect.logInfo(
      `[Row52] Crawling ${locationMap.size} yards in stable filtered groups (chunkSize=${ROW52_LOCATION_FILTER_CHUNK_SIZE})`,
    );

    const processPage = (page: Row52VehiclesPage): Effect.Effect<void, E, R> =>
      Effect.gen(function* () {
        yield* Effect.logInfo(
          `[Row52] Fetched group=${page.chunkIndex + 1} page skip=${page.skip}: ${page.vehicles.length} vehicles (group total: ${page.totalCount ?? "unknown"})`,
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
      });

    while (pagesProcessed < maxPages) {
      const groupAfterLocationId = cursor.afterLocationId;
      const locationIds = selectRow52LocationGroup(cursor, allLocationIds);
      if (locationIds.length === 0) break;
      const groupIndex = Math.max(
        0,
        Math.floor(
          allLocationIds.findIndex(
            (locationId) => locationId === locationIds[0],
          ) / ROW52_LOCATION_FILTER_CHUNK_SIZE,
        ),
      );

      let groupSkip = cursor.locationIds.length > 0 ? cursor.skip : 0;
      let totalRows: number | undefined;
      let pagesFetchedForGroup = 0;

      while (pagesProcessed < maxPages) {
        const page = yield* fetchVehiclePageEffect(
          groupSkip,
          pagesFetchedForGroup === 0,
          locationIds,
          groupIndex,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new Row52ProviderError({
                skip: groupSkip,
                cause: new Error(`group=${groupIndex + 1}: ${cause.message}`),
              }),
          ),
        );
        totalRows ??= page.totalCount;
        pagesFetchedForGroup += 1;

        yield* processPage(page);
        const followingSkip = groupSkip + PAGE_SIZE;
        const groupComplete =
          page.vehicles.length < PAGE_SIZE ||
          (totalRows !== undefined && followingSkip >= totalRows);

        if (groupComplete) {
          cursor = {
            source: "row52",
            afterLocationId: Math.max(...locationIds),
            locationIds: [],
            skip: 0,
          };
        } else {
          cursor = {
            source: "row52",
            afterLocationId: groupAfterLocationId,
            locationIds,
            skip: followingSkip,
          };
        }

        if (groupComplete) break;

        groupSkip = followingSkip;
        if (PAGE_DELAY_MS > 0 && pagesProcessed < maxPages) {
          yield* Effect.sleep(Duration.millis(PAGE_DELAY_MS));
        }
      }
    }

    const hasRemainingLocations = allLocationIds.some(
      (locationId) => locationId > cursor.afterLocationId,
    );
    const complete = cursor.locationIds.length === 0 && !hasRemainingLocations;

    return {
      source: "row52" as const,
      status: complete ? "complete" : "paused",
      cursor,
      count: totalCount,
      errors,
      pagesProcessed,
    };
  });
}
