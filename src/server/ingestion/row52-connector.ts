import buildQuery from "odata-query";
import { Effect, Duration } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import type {
  Row52Image,
  Row52Location,
  Row52ODataResponse,
  Row52Vehicle,
} from "~/lib/types";
import { fetchWithRetry } from "./fetch-with-retry";
import { Row52ProviderError } from "./errors";
import type { CanonicalVehicle } from "./types";

const PAGE_SIZE = 1000;
const PAGE_DELAY_MS = 200;
const PAGE_FETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 30_000;
const TIMEOUT_RETRY_LIMIT = 2;
const TIMEOUT_RETRY_BASE_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = [429, 502, 503, 504];

function fetchRow52Effect(
  endpoint: string,
  queryString: string,
): Effect.Effect<Row52ODataResponse<Row52Vehicle>, Error> {
  const url = `${API_ENDPOINTS.ROW52_BASE}${endpoint}${queryString}`;
  return fetchWithRetry(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    },
    {
      context: endpoint,
      logPrefix: "[Row52]",
      timeoutMs: FETCH_TIMEOUT_MS,
      retries: TIMEOUT_RETRY_LIMIT,
      baseDelayMs: TIMEOUT_RETRY_BASE_DELAY_MS,
      retryStatusCodes: RETRYABLE_STATUS_CODES,
    },
  ).pipe(
    Effect.flatMap((response) => {
      if (!response.ok) {
        return Effect.fail(
          new Error(
            `Row52 API error: ${response.status} ${response.statusText}`,
          ),
        );
      }
      return Effect.tryPromise({
        try: () =>
          response.json() as Promise<Row52ODataResponse<Row52Vehicle>>,
        catch: (cause) =>
          cause instanceof Error
            ? cause
            : new Error(`Failed to parse Row52 JSON: ${String(cause)}`),
      });
    }),
  );
}

function fetchRow52LocationsEffect(): Effect.Effect<
  Map<number, Row52Location>,
  Error
> {
  const queryString = buildQuery({
    orderBy: "state/name",
    select: [
      "id",
      "name",
      "code",
      "address1",
      "city",
      "zipCode",
      "phone",
      "latitude",
      "longitude",
      "isActive",
      "isVisible",
      "isParticipating",
      "webUrl",
      "partsPricingUrl",
      "stateId",
    ],
    expand: "state($select=id,name,abbreviation,countryId)",
    filter: { isParticipating: true },
  });

  const url = `${API_ENDPOINTS.ROW52_BASE}${API_ENDPOINTS.ROW52_LOCATIONS}${queryString}`;
  return fetchWithRetry(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    },
    {
      context: API_ENDPOINTS.ROW52_LOCATIONS,
      logPrefix: "[Row52]",
      timeoutMs: FETCH_TIMEOUT_MS,
      retries: TIMEOUT_RETRY_LIMIT,
      baseDelayMs: TIMEOUT_RETRY_BASE_DELAY_MS,
      retryStatusCodes: RETRYABLE_STATUS_CODES,
    },
  ).pipe(
    Effect.flatMap((response) => {
      if (!response.ok) {
        return Effect.fail(
          new Error(
            `Row52 Locations API error: ${response.status} ${response.statusText}`,
          ),
        );
      }
      return Effect.tryPromise({
        try: () =>
          response.json() as Promise<Row52ODataResponse<Row52Location>>,
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
    }),
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
): Effect.Effect<Row52VehiclesPage, Error> {
  const queryString = buildVehicleQuery(skip, includeCount);
  return fetchRow52Effect(API_ENDPOINTS.ROW52_VEHICLES, queryString).pipe(
    Effect.map((response) => ({
      skip,
      totalCount: response["@odata.count"],
      vehicles: response.value,
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
  const location = vehicle.location ?? locationMap.get(vehicle.locationId);
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
export function streamRow52Inventory(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Promise<void> | void;
  startSkip?: number;
  pagesPerChunk?: number;
  onProgress?: (progress: {
    nextSkip: number;
    pagesProcessed: number;
    vehiclesProcessed: number;
    done: boolean;
    totalCount?: number;
    errors: string[];
  }) => Promise<void> | void;
}): Effect.Effect<Row52StreamResult, Row52ProviderError> {
  return Effect.gen(function* () {
    const progressEveryPages = Math.max(1, options.pagesPerChunk ?? 10);
    let nextSkip = Math.max(0, options.startSkip ?? 0);
    let knownTotalCount: number | undefined;
    let totalCount = 0;
    let pagesProcessed = 0;
    let done = false;
    let lastProgressPages = 0;
    const errors: string[] = [];

    console.log("[Row52] Fetching locations...");
    const locationMap = yield* fetchRow52LocationsEffect().pipe(
      Effect.mapError(
        (cause) => new Row52ProviderError({ skip: -1, cause }),
      ),
    );
    console.log(`[Row52] Found ${locationMap.size} participating locations`);

    const emitProgress = async (force: boolean): Promise<void> => {
      if (!options.onProgress) return;
      if (!force && pagesProcessed - lastProgressPages < progressEveryPages)
        return;
      lastProgressPages = pagesProcessed;
      await options.onProgress({
        nextSkip,
        pagesProcessed,
        vehiclesProcessed: totalCount,
        done,
        totalCount: knownTotalCount,
        errors,
      });
    };

    const processPage = (page: Row52VehiclesPage): void => {
      if (page.totalCount !== undefined) {
        knownTotalCount = page.totalCount;
      }

      console.log(
        `[Row52] Fetched page at skip=${page.skip}: ${page.vehicles.length} vehicles (total: ${knownTotalCount ?? "unknown"})`,
      );

      const pageCanonical: CanonicalVehicle[] = [];
      for (const row of page.vehicles) {
        const v = transformRow52Vehicle(row, locationMap);
        if (v) pageCanonical.push(v);
      }

      if (pageCanonical.length > 0) {
        options.onBatch(pageCanonical);
      }

      totalCount += pageCanonical.length;
      pagesProcessed += 1;
      nextSkip = page.skip + PAGE_SIZE;
    };

    const firstPage = yield* fetchVehiclePageEffect(nextSkip, true).pipe(
      Effect.mapError(
        (cause) => new Row52ProviderError({ skip: nextSkip, cause }),
      ),
    );
    processPage(firstPage);

    if (firstPage.vehicles.length < PAGE_SIZE) {
      done = true;
      yield* Effect.promise(() => emitProgress(true));
    } else {
      const totalRows = firstPage.totalCount;

      if (totalRows === undefined) {
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
            console.error(msg);
            errors.push(msg);
            done = true;
          } else {
            processPage(pageResult.page);
            if (pageResult.page.vehicles.length < PAGE_SIZE) {
              done = true;
            } else if (PAGE_DELAY_MS > 0) {
              yield* Effect.sleep(Duration.millis(PAGE_DELAY_MS));
            }
          }

          yield* Effect.promise(() => emitProgress(done));
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

          const successfulPages = pageResults
            .filter(
              (
                r,
              ): r is {
                ok: true;
                skip: number;
                page: Row52VehiclesPage;
              } => r.ok,
            )
            .map((r) => r.page)
            .sort((a, b) => a.skip - b.skip);

          for (const page of successfulPages) {
            processPage(page);
            if (page.vehicles.length < PAGE_SIZE) {
              stopPaging = true;
              break;
            }
          }

          for (const result of pageResults) {
            if (!result.ok) {
              const msg = `Row52 page at skip=${result.skip}: ${result.error.message}`;
              console.error(msg);
              errors.push(msg);
              stopPaging = true;
            }
          }

          done = stopPaging;
          yield* Effect.promise(() => emitProgress(done));
        }

        if (!done) {
          done = true;
          yield* Effect.promise(() => emitProgress(true));
        }
      }
    }

    return {
      source: "row52" as const,
      count: totalCount,
      errors,
      pagesProcessed,
      nextSkip,
      done: true,
      totalCount: knownTotalCount,
    };
  });
}

