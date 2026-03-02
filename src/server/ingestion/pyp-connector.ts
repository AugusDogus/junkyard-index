import { API_ENDPOINTS } from "~/lib/constants";
import pMap from "p-map";
import type { Location } from "~/lib/types";
import { fetchLocationsFromPYP } from "~/server/api/routers/locations";
import { fetchWithTimeoutRetry } from "./fetch-with-retry";
import { transformPypVehicle } from "./pyp-transform";
import type { PypVehicleJson } from "./pyp-transform";
import type { SnapshotSink } from "./snapshot-sink";
import type { CanonicalVehicle, IngestionResult } from "./types";

/**
 * PYP JSON API connector.
 *
 * Uses the `/DesktopModules/pyp_api/api/Inventory/Filter` endpoint with an empty
 * filter and all store codes to page through the complete inventory as JSON.
 * No HTML parsing or Cheerio — pure JSON.
 *
 * Auth requirements: session cookies + RequestVerificationToken from a prior page visit.
 */

const PAGE_SIZE = 500;
const MAX_PAGES = 200; // Safety limit (~100k vehicles max)
const PAGE_FETCH_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 30_000;
const TIMEOUT_RETRY_LIMIT = 2;
const TIMEOUT_RETRY_BASE_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = [429, 502, 503, 504];

interface PypSession {
  cookies: string;
  token: string;
  createdAt: number;
}

let cachedSession: PypSession | null = null;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function fetchPypWithRetry(
  url: string,
  init: RequestInit,
  context: string,
): Promise<Response> {
  return fetchWithTimeoutRetry(url, init, {
    context,
    logPrefix: "[PYP]",
    timeoutMs: FETCH_TIMEOUT_MS,
    retries: TIMEOUT_RETRY_LIMIT,
    baseDelayMs: TIMEOUT_RETRY_BASE_DELAY_MS,
    retryStatusCodes: RETRYABLE_STATUS_CODES,
  });
}

/**
 * PYP /api/Inventory/Filter response shape.
 */
interface PypFilterResponse {
  Success: boolean;
  Errors: string[];
  ResponseData: {
    Request: {
      YardCode: string[];
      Filter: string;
      PageSize: number;
      PageNumber: number;
      FilterDeals: boolean;
    };
    Vehicles: PypVehicleJson[];
  };
  Messages: string[];
}

export interface PypChunkOptions {
  startPage: number;
  maxPages: number;
  onBatch?: (vehicles: CanonicalVehicle[]) => Promise<void>;
}

export interface PypChunkResult {
  source: "pyp";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextPage: number;
  done: boolean;
}

export interface PypStreamResult {
  source: "pyp";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextPage: number;
  done: boolean;
}

/**
 * Establish a PYP session by visiting the inventory page.
 * Extracts cookies and the CSRF RequestVerificationToken.
 */
async function getPypSession(): Promise<PypSession> {
  if (cachedSession && Date.now() - cachedSession.createdAt < SESSION_TTL_MS) {
    return cachedSession;
  }

  const response = await fetchPypWithRetry(
    `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    },
    "session bootstrap",
  );

  if (!response.ok) {
    throw new Error(`Failed to get PYP session: ${response.status}`);
  }

  const html = await response.text();

  // Extract session cookies from the response.
  // We manage cookies manually here because this is a server-side cron job
  // making outbound HTTP requests to pyp.com — not a Next.js request/response
  // context. Next.js cookies() helpers are for incoming request cookies.
  // A cookie jar library would be overkill for this single session cookie need.
  const setCookies = response.headers.getSetCookie();
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookies) {
    throw new Error("PYP session response set no cookies");
  }

  // Extract CSRF token from HTML
  const tokenMatch = html.match(
    /name="__RequestVerificationToken"[^>]*value="([^"]+)"/,
  );
  if (!tokenMatch?.[1]) {
    throw new Error("Could not extract RequestVerificationToken from PYP page");
  }

  cachedSession = { cookies, token: tokenMatch[1], createdAt: Date.now() };
  return cachedSession;
}

/**
 * Build HTTP headers for PYP API requests.
 */
function buildPypHeaders(session: PypSession): Record<string, string> {
  return {
    Cookie: session.cookies,
    RequestVerificationToken: session.token,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    Referer: `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
    Accept: "application/json, text/plain, */*",
  };
}

/**
 * Fetch a single page from the PYP Filter API.
 * On 401/403, refreshes the session and retries once.
 */
async function fetchPypFilterPage(
  storeCodes: string,
  page: number,
  session: PypSession,
): Promise<PypFilterResponse> {
  const url = `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.PYP_FILTER_INVENTORY}?store=${storeCodes}&filter=&page=${page}&pageSize=${PAGE_SIZE}`;

  let response = await fetchPypWithRetry(
    url,
    {
      headers: buildPypHeaders(session),
    },
    `page ${page}`,
  );

  // Retry on auth failure.
  if (response.status === 401 || response.status === 403) {
    console.log("[PYP] Session expired, refreshing...");
    cachedSession = null;
    const newSession = await getPypSession();
    response = await fetchPypWithRetry(
      url,
      {
        headers: buildPypHeaders(newSession),
      },
      `page ${page} after session refresh`,
    );
  }

  if (!response.ok) {
    throw new Error(`PYP Filter API returned ${response.status}`);
  }

  return (await response.json()) as PypFilterResponse;
}

export async function fetchPypInventoryChunk(
  options: PypChunkOptions,
): Promise<PypChunkResult> {
  const allErrors: string[] = [];
  let totalProcessed = 0;
  let pagesProcessed = 0;
  let nextPage = Math.max(1, options.startPage);
  let done = false;

  try {
    const locations = await fetchLocationsFromPYP();
    if (locations.length < 20) {
      throw new Error(
        `PYP returned only ${locations.length} locations (expected 20+). ` +
          `This likely means PYP locations are currently unavailable. Aborting PYP ingestion for this run.`,
      );
    }

    const locationMap = new Map<string, Location>();
    for (const location of locations) {
      locationMap.set(location.locationCode, location);
    }

    const storeCodes = locations
      .map((location) => location.locationCode)
      .join(",");
    console.log(
      `[PYP] Fetching inventory chunk from ${locations.length} locations (start_page=${nextPage})`,
    );

    let remainingPages = Math.max(0, options.maxPages);
    while (!done && remainingPages > 0 && nextPage <= MAX_PAGES) {
      const session = await getPypSession();
      const data = await fetchPypFilterPage(storeCodes, nextPage, session);

      if (!data.Success) {
        allErrors.push(
          `PYP Filter API error on page ${nextPage}: ${data.Errors.join(", ")}`,
        );
        done = true;
        break;
      }

      const pageVehicles = data.ResponseData?.Vehicles ?? [];
      if (pageVehicles.length === 0) {
        done = true;
        break;
      }

      const pageCanonical: CanonicalVehicle[] = [];
      for (const pageVehicle of pageVehicles) {
        const canonical = transformPypVehicle(pageVehicle, locationMap);
        if (canonical) {
          pageCanonical.push(canonical);
        }
      }

      if (options.onBatch && pageCanonical.length > 0) {
        await options.onBatch(pageCanonical);
      }

      totalProcessed += pageCanonical.length;
      pagesProcessed += 1;
      remainingPages -= 1;

      if (nextPage % 10 === 0) {
        console.log(
          `[PYP] Page ${nextPage}: ${totalProcessed} vehicles processed in chunk so far`,
        );
      }

      if (pageVehicles.length < PAGE_SIZE) {
        done = true;
      } else {
        nextPage += 1;
      }
    }

    if (nextPage > MAX_PAGES) {
      done = true;
    }

    console.log(
      `[PYP] Chunk complete: ${totalProcessed} vehicles across ${pagesProcessed} pages (next_page=${nextPage}, done=${done})`,
    );
  } catch (error) {
    const msg = `PYP chunk failed at page ${nextPage}: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);
    done = true;
  }

  return {
    source: "pyp",
    count: totalProcessed,
    errors: allErrors,
    pagesProcessed,
    nextPage,
    done,
  };
}

/**
 * Fetch ALL PYP inventory using the Filter API with empty filter.
 * Pages through all results across all stores.
 *
 * @param onBatch - Optional callback called with each page's vehicles for streaming upserts.
 */
export async function fetchPypInventory(
  onBatch?: (vehicles: CanonicalVehicle[]) => Promise<void>,
): Promise<IngestionResult> {
  const allVehicles: CanonicalVehicle[] = [];
  const allErrors: string[] = [];
  let totalProcessed = 0;

  try {
    // Get locations for metadata (lat/lng, names, URLs).
    // If PYP locations are unavailable, skip this source for safety.
    const locations = await fetchLocationsFromPYP();
    if (locations.length < 20) {
      throw new Error(
        `PYP returned only ${locations.length} locations (expected 20+). ` +
          `This likely means PYP locations are currently unavailable. Aborting PYP ingestion for this run.`,
      );
    }

    const locationMap = new Map<string, Location>();
    for (const loc of locations) {
      locationMap.set(loc.locationCode, loc);
    }

    const storeCodes = locations.map((l) => l.locationCode).join(",");
    console.log(
      `[PYP] Fetching inventory from ${locations.length} locations via JSON API`,
    );

    // Page through all results in bounded-concurrency chunks.
    let nextPage = 1;
    let pagesProcessed = 0;
    let hasMore = true;

    while (hasMore && nextPage <= MAX_PAGES) {
      const pageNumbers: number[] = [];
      for (
        let idx = 0;
        idx < PAGE_FETCH_CONCURRENCY && nextPage <= MAX_PAGES;
        idx += 1
      ) {
        pageNumbers.push(nextPage);
        nextPage += 1;
      }

      // Re-read session each chunk so a 401/403 refresh is picked up.
      const session = await getPypSession();
      const chunkResults = await pMap(
        pageNumbers,
        async (pageNumber) => {
          try {
            const data = await fetchPypFilterPage(
              storeCodes,
              pageNumber,
              session,
            );
            return { ok: true as const, pageNumber, data };
          } catch (error) {
            return { ok: false as const, pageNumber, error };
          }
        },
        { concurrency: PAGE_FETCH_CONCURRENCY },
      );

      const orderedResults = [...chunkResults].sort(
        (a, b) => a.pageNumber - b.pageNumber,
      );

      for (const result of orderedResults) {
        if (!result.ok) {
          const msg = `PYP page ${result.pageNumber}: ${result.error instanceof Error ? result.error.message : String(result.error)}`;
          console.error(msg);
          allErrors.push(msg);
          hasMore = false;
          break;
        }

        const data = result.data;
        if (!data.Success) {
          allErrors.push(
            `PYP Filter API error on page ${result.pageNumber}: ${data.Errors.join(", ")}`,
          );
          hasMore = false;
          break;
        }

        const pageVehicles = data.ResponseData?.Vehicles ?? [];
        if (pageVehicles.length === 0) {
          hasMore = false;
          break;
        }

        const pageCanonical: CanonicalVehicle[] = [];
        for (const pageVehicle of pageVehicles) {
          const canonical = transformPypVehicle(pageVehicle, locationMap);
          if (canonical) {
            if (!onBatch) allVehicles.push(canonical);
            pageCanonical.push(canonical);
          }
        }
        totalProcessed += pageCanonical.length;
        pagesProcessed += 1;

        if (onBatch && pageCanonical.length > 0) {
          try {
            await onBatch(pageCanonical);
          } catch (batchError) {
            const batchMsg = `PYP onBatch page ${result.pageNumber}: ${batchError instanceof Error ? batchError.message : String(batchError)}`;
            console.error(batchMsg);
            allErrors.push(batchMsg);
          }
        }

        if (result.pageNumber % 10 === 0) {
          console.log(
            `[PYP] Page ${result.pageNumber}: ${totalProcessed} vehicles processed so far`,
          );
        }

        if (pageVehicles.length < PAGE_SIZE) {
          hasMore = false;
          break;
        }
      }
    }

    console.log(
      `[PYP] Total: ${totalProcessed} vehicles across ${pagesProcessed} pages, ${allErrors.length} errors`,
    );
  } catch (error) {
    const msg = `PYP connector failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);
  }

  return {
    source: "pyp",
    vehicles: allVehicles,
    count: totalProcessed,
    errors: allErrors,
  };
}

export async function streamPypInventoryToSink(options: {
  sink: SnapshotSink;
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
  const pagesPerChunk = Math.max(1, options.pagesPerChunk ?? 10);
  let nextPage = Math.max(1, options.startPage ?? 1);
  let totalCount = 0;
  let pagesProcessed = 0;
  let done = false;
  const errors: string[] = [];

  while (!done && nextPage <= MAX_PAGES) {
    const chunkResult = await fetchPypInventoryChunk({
      startPage: nextPage,
      maxPages: pagesPerChunk,
      onBatch: async (vehicles) => {
        await options.sink.enqueue("pyp", vehicles);
      },
    });

    totalCount += chunkResult.count;
    pagesProcessed += chunkResult.pagesProcessed;
    errors.push(...chunkResult.errors);
    nextPage = chunkResult.nextPage;
    done =
      chunkResult.done ||
      chunkResult.errors.length > 0 ||
      chunkResult.pagesProcessed === 0;

    if (options.onProgress) {
      await options.onProgress({
        nextPage,
        pagesProcessed,
        vehiclesProcessed: totalCount,
        done,
        errors,
      });
    }
  }

  return {
    source: "pyp",
    count: totalCount,
    errors,
    pagesProcessed,
    nextPage,
    done: done || nextPage > MAX_PAGES,
  };
}
