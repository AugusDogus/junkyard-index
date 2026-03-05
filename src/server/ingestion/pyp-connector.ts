import pMap from "p-map";
import type { Location } from "~/lib/types";
import { PypBrowserSession, type PypFilterResponse } from "./pyp-browser-session";
import { transformPypVehicle } from "./pyp-transform";
import type { CanonicalVehicle, IngestionResult } from "./types";

/**
 * PYP JSON API connector.
 *
 * Fetches inventory **per-store** rather than across all stores at once.
 * The PYP Filter API degrades severely with deep pagination across all stores
 * (page 30+ takes 30-60s each), but per-store queries return in ~1s because
 * each store has only 1-3 pages of results.
 *
 * With STORE_CONCURRENCY=3 and ~61 stores averaging ~2.5 pages each,
 * the full ingestion completes in ~1-2 minutes instead of 15+.
 */

const PAGE_SIZE = 500;
const STORE_CONCURRENCY = 3;

export interface PypStreamResult {
  source: "pyp";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextPage: number;
  done: boolean;
}

function processPage(
  data: PypFilterResponse,
  storeCode: string,
  pageNumber: number,
  locationMap: Map<string, Location>,
): {
  vehicleCount: number;
  canonical: CanonicalVehicle[];
  isLastPage: boolean;
  apiError: string | null;
} {
  if (!data.Success) {
    return {
      vehicleCount: 0,
      canonical: [],
      isLastPage: true,
      apiError: `PYP Filter API error on store ${storeCode} page ${pageNumber}: ${data.Errors.join(", ")}`,
    };
  }

  const pageVehicles = data.ResponseData?.Vehicles ?? [];
  if (pageVehicles.length === 0) {
    return { vehicleCount: 0, canonical: [], isLastPage: true, apiError: null };
  }

  const canonical: CanonicalVehicle[] = [];
  for (const v of pageVehicles) {
    const c = transformPypVehicle(v, locationMap);
    if (c) canonical.push(c);
  }

  return {
    vehicleCount: pageVehicles.length,
    canonical,
    isLastPage: pageVehicles.length < PAGE_SIZE,
    apiError: null,
  };
}

function buildLocationContext(locations: Location[]) {
  const locationMap = new Map<string, Location>();
  for (const loc of locations) {
    locationMap.set(loc.locationCode, loc);
  }
  return { locationMap };
}

function assertMinLocations(locations: Location[]) {
  if (locations.length < 20) {
    throw new Error(
      `PYP returned only ${locations.length} locations (expected 20+). ` +
        `This likely means PYP locations are currently unavailable. Aborting PYP ingestion for this run.`,
    );
  }
}

interface StoreResult {
  storeCode: string;
  vehicles: CanonicalVehicle[];
  pages: number;
  error: string | null;
}

/**
 * Fetch all vehicles for a single store, paginating until done.
 */
async function fetchStoreInventory(
  session: PypBrowserSession,
  storeCode: string,
  locationMap: Map<string, Location>,
): Promise<StoreResult> {
  const vehicles: CanonicalVehicle[] = [];
  let page = 1;

  while (true) {
    let data: PypFilterResponse;
    try {
      data = await session.fetchFilterPage(storeCode, page, PAGE_SIZE);
    } catch (error) {
      return {
        storeCode,
        vehicles,
        pages: page - 1,
        error: `Store ${storeCode} page ${page}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const result = processPage(data, storeCode, page, locationMap);

    if (result.apiError) {
      return { storeCode, vehicles, pages: page, error: result.apiError };
    }

    vehicles.push(...result.canonical);

    if (result.isLastPage) break;
    page++;
  }

  return { storeCode, vehicles, pages: page, error: null };
}

/**
 * Fetch ALL PYP inventory by querying each store individually.
 *
 * Opens (and closes) a Browserbase session internally.
 */
export async function fetchPypInventory(
  onBatch?: (vehicles: CanonicalVehicle[]) => Promise<void>,
): Promise<IngestionResult> {
  const allVehicles: CanonicalVehicle[] = [];
  const allErrors: string[] = [];
  let totalProcessed = 0;

  const session = new PypBrowserSession();
  try {
    await session.open();
    assertMinLocations(session.locations);
    const { locationMap } = buildLocationContext(session.locations);
    const storeCodes = session.locations.map((l) => l.locationCode);

    console.log(
      `[PYP] Fetching inventory from ${storeCodes.length} stores (per-store, concurrency=${STORE_CONCURRENCY})`,
    );

    let storesCompleted = 0;

    await pMap(
      storeCodes,
      async (storeCode) => {
        const result = await fetchStoreInventory(session, storeCode, locationMap);
        storesCompleted++;

        if (result.error) {
          console.error(result.error);
          allErrors.push(result.error);
        }

        if (result.vehicles.length > 0) {
          if (onBatch) {
            await onBatch(result.vehicles);
          } else {
            allVehicles.push(...result.vehicles);
          }
        }

        totalProcessed += result.vehicles.length;
        console.log(
          `[PYP] Store ${storeCode}: ${result.vehicles.length} vehicles (${result.pages} pages) [${storesCompleted}/${storeCodes.length} stores, ${totalProcessed} total]`,
        );
      },
      { concurrency: STORE_CONCURRENCY },
    );

    console.log(
      `[PYP] Total: ${totalProcessed} vehicles from ${storeCodes.length} stores, ${allErrors.length} errors`,
    );
  } catch (error) {
    const msg = `PYP connector failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);
  } finally {
    await session.close();
  }

  return {
    source: "pyp",
    vehicles: allVehicles,
    count: totalProcessed,
    errors: allErrors,
  };
}

export async function streamPypInventoryToSink(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Promise<void> | void;
  onProgress?: (progress: {
    storesCompleted: number;
    totalStores: number;
    vehiclesProcessed: number;
    done: boolean;
    errors: string[];
  }) => Promise<void> | void;
}): Promise<PypStreamResult> {
  let totalCount = 0;
  let totalPages = 0;
  let storesCompleted = 0;
  const errors: string[] = [];

  const session = new PypBrowserSession();
  try {
    await session.open();
    assertMinLocations(session.locations);
    const { locationMap } = buildLocationContext(session.locations);
    const storeCodes = session.locations.map((l) => l.locationCode);

    console.log(
      `[PYP] Streaming inventory from ${storeCodes.length} stores (per-store, concurrency=${STORE_CONCURRENCY})`,
    );

    await pMap(
      storeCodes,
      async (storeCode) => {
        const result = await fetchStoreInventory(session, storeCode, locationMap);
        storesCompleted++;

        if (result.error) {
          console.error(result.error);
          errors.push(result.error);
        }

        if (result.vehicles.length > 0) {
          await options.onBatch(result.vehicles);
        }

        totalCount += result.vehicles.length;
        totalPages += result.pages;

        console.log(
          `[PYP] Store ${storeCode}: ${result.vehicles.length} vehicles (${result.pages} pages) [${storesCompleted}/${storeCodes.length} stores, ${totalCount} total]`,
        );

        if (options.onProgress) {
          await options.onProgress({
            storesCompleted,
            totalStores: storeCodes.length,
            vehiclesProcessed: totalCount,
            done: storesCompleted === storeCodes.length,
            errors,
          });
        }
      },
      { concurrency: STORE_CONCURRENCY },
    );

    console.log(
      `[PYP] Stream complete: ${totalCount} vehicles from ${storeCodes.length} stores (${totalPages} pages), ${errors.length} errors`,
    );
  } catch (error) {
    const msg = `PYP connector failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    errors.push(msg);
  } finally {
    await session.close();
  }

  return {
    source: "pyp",
    count: totalCount,
    errors,
    pagesProcessed: totalPages,
    nextPage: 0,
    done: true,
  };
}
