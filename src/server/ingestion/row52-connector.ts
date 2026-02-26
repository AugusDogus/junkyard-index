import buildQuery from "odata-query";
import pLimit from "p-limit";
import { API_ENDPOINTS } from "~/lib/constants";
import type {
  Row52Image,
  Row52Location,
  Row52ODataResponse,
  Row52Vehicle,
} from "~/lib/types";
import type { CanonicalVehicle, IngestionResult } from "./types";

const PAGE_SIZE = 1000;
const PAGE_DELAY_MS = 200;
const PAGE_FETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 30_000;
const TIMEOUT_RETRY_LIMIT = 2;
const TIMEOUT_RETRY_BASE_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lowerMessage = error.message.toLowerCase();
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    lowerMessage.includes("aborted due to timeout") ||
    lowerMessage.includes("timeout")
  );
}

async function fetchWithTimeoutRetry(
  url: string,
  init: RequestInit,
  context: string,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= TIMEOUT_RETRY_LIMIT + 1; attempt += 1) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      const shouldRetry =
        isTimeoutError(error) && attempt <= TIMEOUT_RETRY_LIMIT;
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = TIMEOUT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[Row52] ${context} timed out (attempt ${attempt}/${TIMEOUT_RETRY_LIMIT + 1}), retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`[Row52] ${context} failed after timeout retries`);
}

async function fetchRow52<T>(
  endpoint: string,
  queryString: string,
): Promise<Row52ODataResponse<T>> {
  const url = `${API_ENDPOINTS.ROW52_BASE}${endpoint}${queryString}`;
  const response = await fetchWithTimeoutRetry(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    },
    endpoint,
  );

  if (!response.ok) {
    throw new Error(
      `Row52 API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<Row52ODataResponse<T>>;
}

interface Row52VehiclesPage {
  skip: number;
  totalCount?: number;
  vehicles: Row52Vehicle[];
}

export interface Row52ChunkOptions {
  startSkip: number;
  maxPages: number;
  knownTotalCount?: number;
  onBatch?: (vehicles: CanonicalVehicle[]) => Promise<void>;
}

export interface Row52ChunkResult {
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

async function fetchVehiclePage(
  skip: number,
  includeCount: boolean,
): Promise<Row52VehiclesPage> {
  const queryString = buildVehicleQuery(skip, includeCount);
  const response = await fetchRow52<Row52Vehicle>(
    API_ENDPOINTS.ROW52_VEHICLES,
    queryString,
  );

  return {
    skip,
    totalCount: response["@odata.count"],
    vehicles: response.value,
  };
}

export async function fetchRow52InventoryChunk(
  options: Row52ChunkOptions,
): Promise<Row52ChunkResult> {
  const allErrors: string[] = [];
  let totalProcessed = 0;
  let pagesProcessed = 0;
  let skip = Math.max(0, options.startSkip);
  let totalCount = options.knownTotalCount;
  let done = false;

  try {
    console.log("[Row52] Fetching locations...");
    const locationMap = await fetchRow52Locations();
    console.log(`[Row52] Found ${locationMap.size} participating locations`);

    while (!done && pagesProcessed < options.maxPages) {
      const includeCount = totalCount === undefined;
      const page = await fetchVehiclePage(skip, includeCount);
      if (totalCount === undefined && page.totalCount !== undefined) {
        totalCount = page.totalCount;
      }

      console.log(
        `[Row52] Fetched page at skip=${page.skip}: ${page.vehicles.length} vehicles (total: ${totalCount ?? "unknown"})`,
      );

      const pageCanonical: CanonicalVehicle[] = [];
      for (const row of page.vehicles) {
        const vehicle = transformRow52Vehicle(row, locationMap);
        if (vehicle) {
          pageCanonical.push(vehicle);
        }
      }

      if (options.onBatch && pageCanonical.length > 0) {
        await options.onBatch(pageCanonical);
      }

      totalProcessed += pageCanonical.length;
      pagesProcessed += 1;

      if (page.vehicles.length < PAGE_SIZE) {
        done = true;
      } else if (
        totalCount !== undefined &&
        skip + page.vehicles.length >= totalCount
      ) {
        done = true;
      } else {
        skip += PAGE_SIZE;
        if (PAGE_DELAY_MS > 0) {
          await sleep(PAGE_DELAY_MS);
        }
      }
    }

    console.log(
      `[Row52] Chunk complete: ${totalProcessed} vehicles across ${pagesProcessed} pages (next_skip=${skip}, done=${done})`,
    );
  } catch (error) {
    const msg = `Row52 chunk failed at skip=${skip}: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);
    done = true;
  }

  return {
    source: "row52",
    count: totalProcessed,
    errors: allErrors,
    pagesProcessed,
    nextSkip: skip,
    done,
    totalCount,
  };
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

  // Get primary image URL
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

  // Build location URLs
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
 * Fetch all locations from Row52 to build a location lookup map.
 */
async function fetchRow52Locations(): Promise<Map<number, Row52Location>> {
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

  const response = await fetchRow52<Row52Location>(
    API_ENDPOINTS.ROW52_LOCATIONS,
    queryString,
  );

  const map = new Map<number, Row52Location>();
  for (const loc of response.value) {
    map.set(loc.id, loc);
  }
  return map;
}

/**
 * Fetch all active vehicles from Row52, paginating with $top/$skip.
 *
 * @param onBatch - Optional callback called with each page's vehicles for streaming upserts.
 */
export async function fetchRow52Inventory(
  onBatch?: (vehicles: CanonicalVehicle[]) => Promise<void>,
): Promise<IngestionResult> {
  const allVehicles: CanonicalVehicle[] = [];
  const allErrors: string[] = [];
  let totalProcessed = 0;
  let knownTotalCount: number | undefined;

  try {
    console.log("[Row52] Fetching locations...");
    const locationMap = await fetchRow52Locations();
    console.log(`[Row52] Found ${locationMap.size} participating locations`);

    const processPage = async (page: Row52VehiclesPage): Promise<void> => {
      if (page.totalCount !== undefined) {
        knownTotalCount = page.totalCount;
      }

      console.log(
        `[Row52] Fetched page at skip=${page.skip}: ${page.vehicles.length} vehicles (total: ${knownTotalCount ?? "unknown"})`,
      );

      const pageCanonical: CanonicalVehicle[] = [];
      for (const rv of page.vehicles) {
        const vehicle = transformRow52Vehicle(rv, locationMap);
        if (vehicle) {
          if (!onBatch) allVehicles.push(vehicle);
          pageCanonical.push(vehicle);
        }
      }

      totalProcessed += pageCanonical.length;

      if (onBatch && pageCanonical.length > 0) {
        await onBatch(pageCanonical);
      }
    };

    // First page is fetched independently so we can determine total page count.
    const firstPage = await fetchVehiclePage(0, true);
    await processPage(firstPage);

    const totalCount = firstPage.totalCount;
    const firstPageIsLast = firstPage.vehicles.length < PAGE_SIZE;
    if (!firstPageIsLast) {
      if (totalCount === undefined) {
        // Fallback to sequential paging if upstream omits @odata.count.
        let skip = PAGE_SIZE;
        let hasMore = true;

        while (hasMore) {
          try {
            const page = await fetchVehiclePage(skip, false);
            await processPage(page);

            if (page.vehicles.length < PAGE_SIZE) {
              hasMore = false;
            } else {
              skip += PAGE_SIZE;
              await sleep(PAGE_DELAY_MS);
            }
          } catch (error) {
            const msg = `Row52 page at skip=${skip}: ${error instanceof Error ? error.message : String(error)}`;
            console.error(msg);
            allErrors.push(msg);
            hasMore = false;
          }
        }
      } else {
        const remainingSkips: number[] = [];
        for (let skip = PAGE_SIZE; skip < totalCount; skip += PAGE_SIZE) {
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
          const limit = pLimit(PAGE_FETCH_CONCURRENCY);

          const pageResults = await Promise.all(
            chunkSkips.map((skip, index) =>
              limit(async () => {
                if (PAGE_DELAY_MS > 0 && index > 0) {
                  await sleep(index * PAGE_DELAY_MS);
                }
                try {
                  const page = await fetchVehiclePage(skip, false);
                  return { ok: true as const, skip, page };
                } catch (error) {
                  return { ok: false as const, skip, error };
                }
              }),
            ),
          );

          const successfulPages = pageResults
            .filter((result) => result.ok)
            .map((result) => result.page)
            .sort((a, b) => a.skip - b.skip);

          for (const page of successfulPages) {
            await processPage(page);
            if (page.vehicles.length < PAGE_SIZE) {
              stopPaging = true;
              break;
            }
          }

          for (const result of pageResults) {
            if (!result.ok) {
              const msg = `Row52 page at skip=${result.skip}: ${result.error instanceof Error ? result.error.message : String(result.error)}`;
              console.error(msg);
              allErrors.push(msg);
              stopPaging = true;
            }
          }
        }
      }
    }

    console.log(
      `[Row52] Total: ${totalProcessed} vehicles, ${allErrors.length} errors`,
    );
  } catch (error) {
    const msg = `Row52 connector failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);
  }

  return {
    source: "row52",
    vehicles: allVehicles,
    count: totalProcessed,
    errors: allErrors,
  };
}
