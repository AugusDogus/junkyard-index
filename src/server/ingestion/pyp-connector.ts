import pMap from "p-map";
import type { Location } from "~/lib/types";
import { PypBrowserSession, type PypFilterResponse } from "./pyp-browser-session";
import { transformPypVehicle } from "./pyp-transform";
import type { CanonicalVehicle, IngestionResult } from "./types";

/**
 * PYP JSON API connector.
 *
 * Uses a headed Playwright browser session to bypass Cloudflare's JS challenge,
 * then calls the `/DesktopModules/pyp_api/api/Inventory/Filter` endpoint via
 * `page.evaluate(fetch(...))` to page through the complete inventory as JSON.
 *
 * Cloudflare binds its challenge clearance to the browser's TLS fingerprint, so
 * plain Node `fetch()` calls are always rejected. Routing requests through the
 * Chromium instance preserves the fingerprint and Cloudflare pass-through.
 */

const PAGE_SIZE = 500;
const PAGE_FETCH_CONCURRENCY = 3;
const PAGE_COUNT_WARNING_THRESHOLD = 250;

export interface PypStreamResult {
  source: "pyp";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextPage: number;
  done: boolean;
}

interface PageFetchResult {
  ok: true;
  pageNumber: number;
  data: PypFilterResponse;
}

interface PageFetchError {
  ok: false;
  pageNumber: number;
  error: unknown;
}

function processPage(
  data: PypFilterResponse,
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
      apiError: `PYP Filter API error on page ${pageNumber}: ${data.Errors.join(", ")}`,
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
  const storeCodes = locations.map((l) => l.locationCode).join(",");
  return { locationMap, storeCodes };
}

function assertMinLocations(locations: Location[]) {
  if (locations.length < 20) {
    throw new Error(
      `PYP returned only ${locations.length} locations (expected 20+). ` +
        `This likely means PYP locations are currently unavailable. Aborting PYP ingestion for this run.`,
    );
  }
}

/**
 * Fetch ALL PYP inventory using the Filter API with empty filter.
 * Pages through all results across all stores.
 *
 * Opens (and closes) a Playwright browser session internally.
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
    const { locationMap, storeCodes } = buildLocationContext(session.locations);

    console.log(
      `[PYP] Fetching inventory from ${session.locations.length} locations via browser-proxied JSON API`,
    );

    let nextPage = 1;
    let pagesProcessed = 0;
    let hasMore = true;

    while (hasMore) {
      const pageNumbers: number[] = [];
      for (let i = 0; i < PAGE_FETCH_CONCURRENCY; i++) {
        pageNumbers.push(nextPage + i);
      }

      const chunkResults = await pMap(
        pageNumbers,
        async (pageNumber): Promise<PageFetchResult | PageFetchError> => {
          try {
            const data = await session.fetchFilterPage(storeCodes, pageNumber, PAGE_SIZE);
            return { ok: true, pageNumber, data };
          } catch (error) {
            return { ok: false, pageNumber, error };
          }
        },
        { concurrency: PAGE_FETCH_CONCURRENCY },
      );

      const sorted = [...chunkResults].sort((a, b) => a.pageNumber - b.pageNumber);

      for (const fetchResult of sorted) {
        if (!fetchResult.ok) {
          const msg = `PYP page ${fetchResult.pageNumber}: ${fetchResult.error instanceof Error ? fetchResult.error.message : String(fetchResult.error)}`;
          console.error(msg);
          allErrors.push(msg);
          hasMore = false;
          break;
        }

        const result = processPage(fetchResult.data, fetchResult.pageNumber, locationMap);

        console.log(
          `[PYP] Page ${fetchResult.pageNumber}: ${result.vehicleCount} vehicles fetched, ${result.canonical.length} transformed (${totalProcessed + result.canonical.length} total)`,
        );

        if (result.apiError) {
          allErrors.push(result.apiError);
          hasMore = false;
          break;
        }

        if (result.canonical.length > 0) {
          if (onBatch) {
            try {
              await onBatch(result.canonical);
            } catch (batchError) {
              const batchMsg = `PYP onBatch page ${fetchResult.pageNumber}: ${batchError instanceof Error ? batchError.message : String(batchError)}`;
              console.error(batchMsg);
              allErrors.push(batchMsg);
            }
          } else {
            allVehicles.push(...result.canonical);
          }
        }

        totalProcessed += result.canonical.length;
        pagesProcessed += 1;

        if (fetchResult.pageNumber === PAGE_COUNT_WARNING_THRESHOLD) {
          console.warn(
            `[PYP] Reached ${PAGE_COUNT_WARNING_THRESHOLD} pages (${totalProcessed} vehicles). ` +
              `This is unusually high — verify PYP API is paginating correctly.`,
          );
        }

        if (result.isLastPage) {
          hasMore = false;
          break;
        }
      }

      nextPage += pageNumbers.length;
    }

    console.log(
      `[PYP] Total: ${totalProcessed} vehicles across ${pagesProcessed} pages, ${allErrors.length} errors`,
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
  startPage?: number;
  pagesPerChunk?: number;
  onProgress?: (progress: {
    nextPage: number;
    pagesProcessed: number;
    vehiclesProcessed: number;
    done: boolean;
    errors: string[];
  }) => Promise<void> | void;
}): Promise<PypStreamResult> {
  let nextPage = Math.max(1, options.startPage ?? 1);
  let totalCount = 0;
  let pagesProcessed = 0;
  let done = false;
  const errors: string[] = [];

  const session = new PypBrowserSession();
  try {
    await session.open();
    assertMinLocations(session.locations);
    const { locationMap, storeCodes } = buildLocationContext(session.locations);

    console.log(
      `[PYP] Streaming inventory from ${session.locations.length} locations via browser-proxied JSON API`,
    );

    while (!done) {
      try {
        const pageNumbers: number[] = [];
        for (let i = 0; i < PAGE_FETCH_CONCURRENCY; i++) {
          pageNumbers.push(nextPage + i);
        }

        const chunkResults = await pMap(
          pageNumbers,
          async (pageNumber): Promise<PageFetchResult | PageFetchError> => {
            try {
              const data = await session.fetchFilterPage(storeCodes, pageNumber, PAGE_SIZE);
              return { ok: true, pageNumber, data };
            } catch (error) {
              return { ok: false, pageNumber, error };
            }
          },
          { concurrency: PAGE_FETCH_CONCURRENCY },
        );

        const sorted = [...chunkResults].sort((a, b) => a.pageNumber - b.pageNumber);

        for (const fetchResult of sorted) {
          if (!fetchResult.ok) {
            const msg = `PYP page ${fetchResult.pageNumber}: ${fetchResult.error instanceof Error ? fetchResult.error.message : String(fetchResult.error)}`;
            console.error(msg);
            errors.push(msg);
            done = true;
            break;
          }

          const result = processPage(fetchResult.data, fetchResult.pageNumber, locationMap);

          console.log(
            `[PYP] Page ${fetchResult.pageNumber}: ${result.vehicleCount} vehicles fetched, ${result.canonical.length} transformed (${totalCount + result.canonical.length} total)`,
          );

          if (result.apiError) {
            errors.push(result.apiError);
            done = true;
            break;
          }

          if (result.canonical.length > 0) {
            await options.onBatch(result.canonical);
          }

          totalCount += result.canonical.length;
          pagesProcessed += 1;

          if (fetchResult.pageNumber === PAGE_COUNT_WARNING_THRESHOLD) {
            console.warn(
              `[PYP] Reached ${PAGE_COUNT_WARNING_THRESHOLD} pages (${totalCount} vehicles). ` +
                `This is unusually high — verify PYP API is paginating correctly.`,
            );
          }

          if (result.isLastPage) {
            done = true;
            break;
          }
        }

        nextPage += pageNumbers.length;

        if (options.onProgress) {
          await options.onProgress({
            nextPage,
            pagesProcessed,
            vehiclesProcessed: totalCount,
            done,
            errors,
          });
        }
      } catch (error) {
        const msg = `PYP page ${nextPage}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        errors.push(msg);
        done = true;
      }
    }

    console.log(
      `[PYP] Stream complete: ${totalCount} vehicles across ${pagesProcessed} pages, ${errors.length} errors`,
    );
  } catch (error) {
    const msg = `PYP connector failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    errors.push(msg);
    done = true;
  } finally {
    await session.close();
  }

  return {
    source: "pyp",
    count: totalCount,
    errors,
    pagesProcessed,
    nextPage,
    done: true,
  };
}
