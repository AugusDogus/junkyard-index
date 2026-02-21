import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Location } from "~/lib/types";
import { fetchLocationsFromPYP } from "~/server/api/routers/locations";
import type { CanonicalVehicle, IngestionResult } from "./types";

const PYP_PAGE_SIZE = 25; // PYP returns 25 vehicles per page
const MAX_CONCURRENT_LOCATIONS = 5;
const MAX_CONCURRENT_PAGES = 3;
const REQUEST_DELAY_MS = 300;

interface PypSession {
  cookies: string;
  createdAt: number;
}

let cachedSession: PypSession | null = null;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get a PYP session by visiting a store inventory page to establish cookies.
 * Caches the session for 10 minutes.
 */
async function getPypSession(): Promise<string> {
  if (cachedSession && Date.now() - cachedSession.createdAt < SESSION_TTL_MS) {
    return cachedSession.cookies;
  }

  const response = await fetch(
    `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
    {
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

  const setCookies = response.headers.getSetCookie?.() ?? [];
  const cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");

  cachedSession = { cookies: cookieStr, createdAt: Date.now() };
  return cookieStr;
}

/**
 * Fetch a single page of vehicle inventory HTML from PYP for a specific location.
 */
async function fetchPypPage(
  locationCode: string,
  page: number,
  cookies: string,
): Promise<string> {
  const url = `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.VEHICLE_INVENTORY}?page=${page}&filter=&store=${locationCode}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
      Cookie: cookies,
    },
  });

  if (response.status === 403 || response.status === 401) {
    // Session expired, clear cache and retry once
    cachedSession = null;
    const newCookies = await getPypSession();
    const retryResponse = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
        Cookie: newCookies,
      },
    });
    if (!retryResponse.ok) {
      throw new Error(
        `PYP page fetch failed after session refresh: ${retryResponse.status}`,
      );
    }
    return retryResponse.text();
  }

  if (!response.ok) {
    throw new Error(`PYP page fetch failed: ${response.status}`);
  }

  return response.text();
}

/**
 * Remove crop parameters from image URL.
 */
function removeCropParameters(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.searchParams.delete("w");
    urlObj.searchParams.delete("h");
    urlObj.searchParams.delete("mode");
    return urlObj.toString();
  } catch {
    return url;
  }
}

function extractAfterLabel(text: string, label: string): string {
  const index = text.indexOf(label);
  if (index === -1) return "";
  return text
    .substring(index + label.length)
    .replace(/\s+/g, " ")
    .trim();
}

function extractWordAfterLabel(text: string, label: string): string {
  const afterLabel = extractAfterLabel(text, label);
  const firstWord = afterLabel.split(" ")[0] ?? "";
  if (firstWord.endsWith(":")) return "";
  return firstWord;
}

function createSlug(text: string): string {
  return text.toLowerCase().split(" ").join("-");
}

/**
 * Parse vehicle inventory HTML into CanonicalVehicle objects.
 */
function parsePypHtml(
  html: string,
  location: Location,
): CanonicalVehicle[] {
  const vehicles: CanonicalVehicle[] = [];
  const $ = cheerio.load(html);
  const base = new URL(API_ENDPOINTS.PYP_BASE);

  $(".pypvi_resultRow[id]").each((_, el) => {
    try {
      // Main image
      const mainImageHref =
        $(el).find("a.fancybox-thumb.pypvi_image").attr("href") ?? "";
      const mainImageUrl = mainImageHref
        ? removeCropParameters(new URL(mainImageHref, base).toString())
        : null;

      const ymmText = $(el).find(".pypvi_ymm").text().trim();
      const normalizedYmm = ymmText.replace(/\s+/g, " ").trim();
      const [yearStr = "", make = "", ...modelParts] =
        normalizedYmm.split(" ");
      const model = modelParts.join(" ");
      const year = parseInt(yearStr) || 0;

      const colorText = $(el)
        .find(".pypvi_detailItem:contains('Color:')")
        .text();
      const color = extractAfterLabel(colorText, "Color:") || null;

      const vinText = $(el).find(".pypvi_detailItem:contains('VIN:')").text();
      const vin = extractAfterLabel(vinText, "VIN:");

      if (!vin) return; // Skip vehicles without VIN

      const sectionText = $(el)
        .find(".pypvi_detailItem:contains('Section:')")
        .text();
      const section = extractWordAfterLabel(sectionText, "Section:") || null;

      const rowText = $(el).find(".pypvi_detailItem:contains('Row:')").text();
      const row = extractWordAfterLabel(rowText, "Row:") || null;

      const spaceText = $(el)
        .find(".pypvi_detailItem:contains('Space:')")
        .text();
      const space = extractWordAfterLabel(spaceText, "Space:") || null;

      const stockText = $(el)
        .find(".pypvi_detailItem:contains('Stock #:')")
        .text();
      const stockNumber = extractAfterLabel(stockText, "Stock #:") || null;

      // Available date
      let availableDate: string | null = null;
      const datetimeAttr = $(el).find("time[datetime]").attr("datetime");
      if (datetimeAttr) {
        const parsedDate = new Date(datetimeAttr);
        if (!isNaN(parsedDate.getTime())) {
          availableDate = parsedDate.toISOString();
        }
      } else {
        const availableText = $(el)
          .find(".pypvi_detailItem:contains('Available:')")
          .text();
        const availableRaw = extractAfterLabel(availableText, "Available:");
        if (availableRaw) {
          const dateMatch = /(\d{1,2}\/\d{1,2}\/\d{4})/.exec(availableRaw);
          if (dateMatch?.[1]) {
            const parsedDate = new Date(dateMatch[1]);
            if (!isNaN(parsedDate.getTime())) {
              availableDate = parsedDate.toISOString();
            }
          }
        }
      }

      // Generate URLs
      const modelSlug = createSlug(model);
      const detailsUrl = `${API_ENDPOINTS.PYP_BASE}${location.urls.inventory}${year}-${make.toLowerCase()}-${modelSlug}/`;
      const partsUrl = `${API_ENDPOINTS.PYP_BASE}${location.urls.parts}?year=${year}&make=${make}&model=${model}`;
      const pricesUrl = `${API_ENDPOINTS.PYP_BASE}${location.urls.prices}`;

      vehicles.push({
        vin,
        source: "pyp",
        year,
        make,
        model,
        color,
        stockNumber,
        imageUrl: mainImageUrl,
        availableDate,
        locationCode: location.locationCode,
        locationName: location.name,
        state: location.state,
        stateAbbr: location.stateAbbr,
        lat: location.lat,
        lng: location.lng,
        section,
        row,
        space,
        detailsUrl,
        partsUrl,
        pricesUrl,
        engine: null,
        trim: null,
        transmission: null,
      });
    } catch (error) {
      // Skip individual vehicle parse errors
      console.error("Error parsing PYP vehicle element:", error);
    }
  });

  return vehicles;
}

/**
 * Fetch ALL pages of inventory for a single PYP location.
 */
async function fetchLocationInventory(
  location: Location,
  cookies: string,
): Promise<{ vehicles: CanonicalVehicle[]; errors: string[] }> {
  const vehicles: CanonicalVehicle[] = [];
  const errors: string[] = [];
  const pageLimit = pLimit(MAX_CONCURRENT_PAGES);

  // Fetch page 1 first to establish the pattern
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const currentPage = page;
    try {
      const html = await fetchPypPage(location.locationCode, currentPage, cookies);
      const pageVehicles = parsePypHtml(html, location);

      if (pageVehicles.length === 0) {
        // No more vehicles on this page, we've reached the end
        hasMore = false;
      } else {
        vehicles.push(...pageVehicles);
        page++;

        // Safety: don't fetch more than 100 pages (2500 vehicles per location max)
        if (page > 100) {
          hasMore = false;
        }

        // Small delay between pages to be polite
        await delay(REQUEST_DELAY_MS);
      }
    } catch (error) {
      const msg = `PYP location ${location.locationCode} page ${currentPage}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(msg);
      errors.push(msg);
      hasMore = false; // Stop on error for this location
    }
  }

  return { vehicles, errors };
}

/**
 * Fetch all PYP inventory across all locations.
 * Returns CanonicalVehicle[] with deduplication by VIN.
 */
export async function fetchPypInventory(): Promise<IngestionResult> {
  const allVehicles: CanonicalVehicle[] = [];
  const allErrors: string[] = [];

  try {
    const locations = await fetchLocationsFromPYP();
    console.log(`[PYP] Fetching inventory from ${locations.length} locations`);

    const cookies = await getPypSession();
    const locationLimit = pLimit(MAX_CONCURRENT_LOCATIONS);

    const results = await Promise.all(
      locations.map((location) =>
        locationLimit(async () => {
          try {
            const { vehicles, errors } = await fetchLocationInventory(
              location,
              cookies,
            );
            console.log(
              `[PYP] ${location.locationCode} (${location.displayName}): ${vehicles.length} vehicles`,
            );
            return { vehicles, errors };
          } catch (error) {
            const msg = `PYP location ${location.locationCode} failed: ${error instanceof Error ? error.message : String(error)}`;
            console.error(msg);
            return { vehicles: [] as CanonicalVehicle[], errors: [msg] };
          }
        }),
      ),
    );

    for (const result of results) {
      allVehicles.push(...result.vehicles);
      allErrors.push(...result.errors);
    }

    console.log(
      `[PYP] Total: ${allVehicles.length} vehicles, ${allErrors.length} errors`,
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
