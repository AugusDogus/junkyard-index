import { API_ENDPOINTS } from "~/lib/constants";
import type { Location } from "~/lib/types";
import { fetchLocationsFromPYP } from "~/server/api/routers/locations";
import { transformPypVehicle } from "./pyp-transform";
import type { PypVehicleJson } from "./pyp-transform";
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

interface PypSession {
  cookies: string;
  token: string;
  createdAt: number;
}

let cachedSession: PypSession | null = null;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

/**
 * Establish a PYP session by visiting the inventory page.
 * Extracts cookies and the CSRF RequestVerificationToken.
 */
async function getPypSession(): Promise<PypSession> {
  if (cachedSession && Date.now() - cachedSession.createdAt < SESSION_TTL_MS) {
    return cachedSession;
  }

  const response = await fetch(
    `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
    {
      signal: AbortSignal.timeout(30_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to get PYP session: ${response.status}`);
  }

  const html = await response.text();

  // Extract cookies
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");

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
  const url = `${API_ENDPOINTS.PYP_BASE}/DesktopModules/pyp_api/api/Inventory/Filter?store=${storeCodes}&filter=&page=${page}&pageSize=${PAGE_SIZE}`;

  let response = await fetch(url, {
    headers: buildPypHeaders(session),
    signal: AbortSignal.timeout(30_000),
  });

  // Retry on auth failure
  if (response.status === 401 || response.status === 403) {
    console.log("[PYP] Session expired, refreshing...");
    cachedSession = null;
    const newSession = await getPypSession();
    response = await fetch(url, {
      headers: buildPypHeaders(newSession),
      signal: AbortSignal.timeout(30_000),
    });
  }

  if (!response.ok) {
    throw new Error(`PYP Filter API returned ${response.status}`);
  }

  return (await response.json()) as PypFilterResponse;
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

  try {
    // Get locations for metadata (lat/lng, names, URLs)
    const locations = await fetchLocationsFromPYP();
    const locationMap = new Map<string, Location>();
    for (const loc of locations) {
      locationMap.set(loc.locationCode, loc);
    }

    const storeCodes = locations.map((l) => l.locationCode).join(",");
    console.log(
      `[PYP] Fetching inventory from ${locations.length} locations via JSON API`,
    );

    // Page through all results
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES) {
      try {
        // Re-read session each iteration so a 401/403 refresh is picked up
        const session = await getPypSession();
        const data = await fetchPypFilterPage(storeCodes, page, session);

        if (!data.Success) {
          allErrors.push(
            `PYP Filter API error on page ${page}: ${data.Errors.join(", ")}`,
          );
          hasMore = false;
          continue;
        }

        const pageVehicles = data.ResponseData?.Vehicles ?? [];

        if (pageVehicles.length === 0) {
          hasMore = false;
          continue;
        }

        // Transform vehicles
        const pageCanonical: CanonicalVehicle[] = [];
        for (const v of pageVehicles) {
          const canonical = transformPypVehicle(v, locationMap);
          if (canonical) {
            allVehicles.push(canonical);
            pageCanonical.push(canonical);
          }
        }

        // Stream upsert if callback provided
        if (onBatch && pageCanonical.length > 0) {
          await onBatch(pageCanonical);
        }

        if (page % 10 === 0) {
          console.log(
            `[PYP] Page ${page}: ${allVehicles.length} vehicles so far`,
          );
        }

        // If we got fewer than PAGE_SIZE, we've reached the end
        if (pageVehicles.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          page++;
        }
      } catch (error) {
        const msg = `PYP page ${page}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        allErrors.push(msg);
        hasMore = false;
      }
    }

    console.log(
      `[PYP] Total: ${allVehicles.length} vehicles across ${page} pages, ${allErrors.length} errors`,
    );
  } catch (error) {
    const msg = `PYP connector failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);
  }

  return {
    source: "pyp",
    vehicles: allVehicles,
    errors: allErrors,
  };
}
