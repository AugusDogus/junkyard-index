import pMap from "p-map";
import type { Location } from "~/lib/types";
import { PypBrowserSession, type PypFilterResponse } from "./pyp-browser-session";
import { transformPypVehicle } from "./pyp-transform";
import type { CanonicalVehicle } from "./types";

/**
 * PYP JSON API connector.
 *
 * ## Why Browserbase + all-stores query?
 *
 * PYP (pyp.com) runs Cloudflare bot protection that blocks plain Node `fetch()`
 * calls — even with valid cookies. The exact detection mechanism is unknown
 * (likely TLS fingerprinting, JA3 hashes, or browser attestation). The only
 * reliable workaround we've found is routing API calls through a real Chromium
 * instance so requests inherit the browser's full network stack. Browserbase
 * provides managed, stealth-mode remote browsers that handle this.
 *
 * ## Why combined all-stores, not per-store queries?
 *
 * The PYP Filter API (`/DesktopModules/pyp_api/api/Inventory/Filter`) returns
 * different result sets depending on how many stores are queried at once:
 *
 * - Querying a single store (e.g. `store=1265`) returns a **subset** (~210 vehicles).
 * - Querying all 61 stores returns the **full inventory** (~73k vehicles).
 * - The per-store subset is NOT just a filtered view of the global set — entire
 *   vehicles are absent from per-store results that ARE present in the global
 *   results AND visible on the actual pyp.com website (server-side rendered).
 *
 * Summing per-store results yields ~42k vehicles vs ~73k from the global query.
 * We confirmed the "missing" vehicles are real and current on pyp.com, so we
 * MUST use the all-stores combined query to get complete coverage.
 *
 * ## Session rotation
 *
 * Browserbase free-tier sessions cap at 15 minutes. Deep pagination can be
 * unpredictable — server response times vary by time of day, load, and other
 * factors outside our control. Session rotation at 12 minutes (see
 * `pyp-browser-session.ts`) provides a safety net: if a single session can't
 * finish the full crawl, `reopen()` closes the current session (browser +
 * context + page), then creates a fresh Browserbase session and resumes
 * pagination from the last successful page. Only one session is active at a
 * time.
 */

/**
 * PYP silently returns 0 vehicles for pageSize > 500. Hard API limit.
 */
const PAGE_SIZE = 500;

/**
 * Must be 1. Under concurrent pagination (concurrency >= 2), PYP's server
 * degrades exponentially — individual page responses jump from ~4s to 30-60s
 * past page 30, making the full crawl take 2+ hours. Sequential requests stay
 * at a consistent ~4s/page even at page 140+, completing the full ~145-page
 * crawl in ~11 minutes.
 *
 * This is a server-side bottleneck, not a client-side one.
 */
const PAGE_FETCH_CONCURRENCY = 1;

const PAGE_COUNT_WARNING_THRESHOLD = 250;

export interface PypStreamResult {
  source: "pyp";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextPage: number;
  done: boolean;
}

type PageFetchResult = {
  ok: true;
  pageNumber: number;
  data: PypFilterResponse;
};

type PageFetchError = {
  ok: false;
  pageNumber: number;
  error: unknown;
};

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
 * Pages through results using concurrent fetches, rotating Browserbase
 * sessions before they hit the timeout limit.
 */
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
  let sessionCount = 1;
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
      // Rotate Browserbase session if approaching timeout
      if (session.shouldRotate) {
        console.log(
          `[PYP] Rotating Browserbase session (session #${sessionCount} done, page ${nextPage} next)`,
        );
        await session.reopen();
        sessionCount++;
        console.log(`[PYP] New session #${sessionCount} ready, resuming from page ${nextPage}`);
      }

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
      `[PYP] Stream complete: ${totalCount} vehicles across ${pagesProcessed} pages (${sessionCount} session${sessionCount > 1 ? "s" : ""}), ${errors.length} errors`,
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
