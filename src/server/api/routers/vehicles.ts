import { geolocation } from "@vercel/functions";
import * as cheerio from "cheerio";
import { backOff } from "exponential-backoff";
import { unstable_cache } from "next/cache";
import pLimit from "p-limit";
import { z } from "zod";
import { API_ENDPOINTS, SEARCH_CONFIG } from "~/lib/constants";
import type {
  Location,
  ParsedVehicleData,
  SearchFilters,
  SearchResult,
  Vehicle,
  VehicleImage,
} from "~/lib/types";
import { calculateDistance } from "~/lib/utils";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { locationsRouter } from "./locations";

// Schema for search filters
const searchFiltersSchema = z.object({
  query: z.string(),
  makes: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  yearRange: z.tuple([z.number(), z.number()]).optional(),
  dateRange: z.tuple([z.date(), z.date()]).optional(),
  maxDistance: z.number().optional(),
});

/**
 * Utility function to add delay between requests
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and exponential backoff
 * Uses Next.js Data Cache for optimal caching and request deduplication
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  // Merge with Next.js Data Cache options
  const cacheOptions: RequestInit = {
    ...options,
    cache: "force-cache", // Use Next.js Data Cache
    next: { revalidate: 300 }, // Revalidate every 5 minutes
  };

  return backOff(
    async () => {
      const response = await fetch(url, cacheOptions);

      // If successful, return the response
      if (response.ok) {
        return response;
      }

      // If client error (4xx), don't retry
      if (response.status >= 400 && response.status < 500) {
        throw new Error(
          `Client error: ${response.status} - ${response.statusText}`,
        );
      }

      // Server error (5xx) - retry with backoff
      throw new Error(
        `Server error: ${response.status} - ${response.statusText}`,
      );
    },
    {
      numOfAttempts: SEARCH_CONFIG.MAX_RETRIES,
      startingDelay: SEARCH_CONFIG.BASE_RETRY_DELAY,
      maxDelay: SEARCH_CONFIG.MAX_RETRY_DELAY,
      retry: (error: Error, attemptNumber: number) => {
        console.log(
          `Request failed (attempt ${attemptNumber}/${SEARCH_CONFIG.MAX_RETRIES}): ${error.message}`,
        );
        return true; // Always retry unless it's a client error (handled above)
      },
    },
  );
}

/**
 * Extract cookies from a Response's set-cookie header
 */
function extractCookies(response: Response): string {
  const setCookieHeader = response.headers.get("set-cookie");
  if (!setCookieHeader) return "";

  // Parse the set-cookie header and extract cookie name=value pairs
  // The header may contain multiple cookies separated by commas (for multiple Set-Cookie headers)
  // Each cookie has the format: name=value; attributes...
  const cookies: string[] = [];

  // Split by comma but be careful about commas in expires dates
  const parts = setCookieHeader.split(/,(?=\s*[^;=]+=[^;]+)/);
  for (const part of parts) {
    const cookiePart = part.trim().split(";")[0]; // Get just name=value
    if (cookiePart) {
      cookies.push(cookiePart);
    }
  }

  return cookies.join("; ");
}

/**
 * Internal function to fetch vehicle inventory without caching
 */
async function fetchVehicleInventoryInternal(
  location: Location,
  searchQuery: string,
): Promise<ParsedVehicleData[]> {
  try {
    // Step 1: First visit the inventory page to establish a session and get cookies
    const inventoryPageUrl = `${API_ENDPOINTS.PYP_BASE}${location.urls.inventory}`;

    const sessionResponse = await fetch(inventoryPageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
    });

    // Extract cookies from the session response
    const cookies = extractCookies(sessionResponse);

    // Step 2: Now make the AJAX request with the session cookies
    const url = new URL(
      `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.VEHICLE_INVENTORY}`,
    );
    url.searchParams.set("page", "1");
    url.searchParams.set("filter", searchQuery);
    url.searchParams.set("store", location.locationCode);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      SEARCH_CONFIG.REQUEST_TIMEOUT,
    );

    // Make AJAX request with the session cookies
    const response = await fetchWithRetry(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "X-Requested-With": "XMLHttpRequest",
        Referer: inventoryPageUrl,
        Origin: API_ENDPOINTS.PYP_BASE,
        DNT: "1",
        Connection: "keep-alive",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Cache-Control": "no-cache",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    return parseVehicleInventoryHTML(html, location);
  } catch (error) {
    console.error(
      `Error fetching inventory for location ${location.locationCode}:`,
      error,
    );

    // Add delay even on error to avoid hammering the server
    await delay(SEARCH_CONFIG.REQUEST_DELAY);

    return [];
  }
}

/**
 * Cached version of fetchVehicleInventoryInternal using Next.js cache
 *
 */
const fetchVehicleInventory = unstable_cache(
  async (location: Location, searchQuery: string) => {
    return fetchVehicleInventoryInternal(location, searchQuery);
  },
  ["vehicle-inventory"],
  {
    revalidate: 300, // Cache for 5 minutes
    tags: ["vehicles"],
  },
);

/**
 * Helper function to extract text after a label
 */
function extractAfterLabel(text: string, label: string): string {
  const index = text.indexOf(label);
  if (index === -1) return "";
  return text
    .substring(index + label.length)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Helper function to extract first word after a label
 */
function extractWordAfterLabel(text: string, label: string): string {
  const afterLabel = extractAfterLabel(text, label);
  return afterLabel.split(" ")[0] ?? "";
}

/**
 * Determine image type from URL
 */
function getImageType(url: string): VehicleImage["type"] {
  if (url.includes("CAR-FRONT-LEFT")) return "CAR-FRONT-LEFT";
  if (url.includes("CAR-BACK-LEFT")) return "CAR-BACK-LEFT";
  if (url.includes("CAR-BACK-RIGHT")) return "CAR-BACK-RIGHT";
  if (url.includes("CAR-FRONT-RIGHT")) return "CAR-FRONT-RIGHT";
  if (url.includes("CAR-BACK")) return "CAR-BACK";
  if (url.includes("CAR-FRONT")) return "CAR-FRONT";
  if (url.includes("CAR-LEFT")) return "CAR-LEFT";
  if (url.includes("CAR-RIGHT")) return "CAR-RIGHT";
  if (url.includes("ENGINE")) return "ENGINE";
  if (url.includes("INTERIOR")) return "INTERIOR";
  return "OTHER";
}

/**
 * Remove crop parameters from image URL
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

/**
 * Convert text to URL-friendly slug by replacing spaces with hyphens
 */
function createSlug(text: string): string {
  return text.toLowerCase().split(" ").join("-");
}

/**
 * Generate vehicle URLs
 */
function generateVehicleUrls(
  year: number,
  make: string,
  model: string,
  location: Location,
): { detailsUrl: string; partsUrl: string; pricesUrl: string } {
  const modelSlug = createSlug(model);

  return {
    detailsUrl: `${API_ENDPOINTS.PYP_BASE}${location.urls.inventory}${year}-${make.toLowerCase()}-${modelSlug}/`,
    partsUrl: `${API_ENDPOINTS.PYP_BASE}${location.urls.parts}?year=${year}&make=${make}&model=${model}`,
    pricesUrl: `${API_ENDPOINTS.PYP_BASE}${location.urls.prices}`,
  };
}

/**
 * Parses vehicle inventory HTML to extract vehicle data using simplified Cheerio parsing
 */
function parseVehicleInventoryHTML(
  html: string,
  location: Location,
): ParsedVehicleData[] {
  const vehicles: ParsedVehicleData[] = [];

  try {
    const $ = cheerio.load(html);
    const base = new URL(API_ENDPOINTS.PYP_BASE);

    $(".pypvi_resultRow[id]").each((_, el) => {
      try {
        const id = $(el).attr("id");
        if (!id) return;

        // Main image
        const mainImageHref =
          $(el).find("a.fancybox-thumb.pypvi_image").attr("href") ?? "";
        const mainImageUrl = mainImageHref
          ? new URL(mainImageHref, base).toString()
          : "";

        // Thumbnails
        const thumbnails = $(el)
          .find(".pypvi_images a[data-fancybox]")
          .map((_, a) => {
            const href = $(a).attr("href");
            return href ? new URL(href, base).toString() : "";
          })
          .get()
          .filter((url) => url !== "");

        // Combine main image and thumbnails into VehicleImage array
        const images: VehicleImage[] = [];

        if (mainImageUrl) {
          images.push({
            url: removeCropParameters(mainImageUrl),
            thumbnailUrl: mainImageUrl,
            type: getImageType(mainImageUrl),
          });
        }

        thumbnails.forEach((thumbnailUrl) => {
          images.push({
            url: removeCropParameters(thumbnailUrl),
            thumbnailUrl,
            type: getImageType(thumbnailUrl),
          });
        });

        // Year, Make, Model
        const ymmText = $(el).find(".pypvi_ymm").text().trim();
        const normalizedYmm = ymmText.replace(/\s+/g, " ").trim();
        const [yearStr = "", make = "", ...modelParts] =
          normalizedYmm.split(" ");
        const model = modelParts.join(" ");
        const year = parseInt(yearStr) || 0;

        // Details
        const colorText = $(el)
          .find(".pypvi_detailItem:contains('Color:')")
          .text();
        const color = extractAfterLabel(colorText, "Color:");

        const vinText = $(el).find(".pypvi_detailItem:contains('VIN:')").text();
        const vin = extractAfterLabel(vinText, "VIN:");

        const sectionText = $(el)
          .find(".pypvi_detailItem:contains('Section:')")
          .text();
        const section = extractWordAfterLabel(sectionText, "Section:");

        const rowText = $(el).find(".pypvi_detailItem:contains('Row:')").text();
        const row = extractWordAfterLabel(rowText, "Row:");

        const spaceText = $(el)
          .find(".pypvi_detailItem:contains('Space:')")
          .text();
        const space = extractWordAfterLabel(spaceText, "Space:");

        const stockText = $(el)
          .find(".pypvi_detailItem:contains('Stock #:')")
          .text();
        const stockNumber = extractAfterLabel(stockText, "Stock #:");

        // Available date
        let availableDate = new Date().toISOString();
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
        const { detailsUrl, partsUrl, pricesUrl } = generateVehicleUrls(
          year,
          make,
          model,
          location,
        );

        vehicles.push({
          id,
          year,
          make,
          model,
          color,
          vin,
          stockNumber,
          availableDate,
          yardLocation: {
            section,
            row,
            space,
          },
          images,
          detailsUrl,
          partsUrl,
          pricesUrl,
        });
      } catch (error) {
        console.error(`Error parsing vehicle element:`, error);
      }
    });
  } catch (error) {
    console.error("Error parsing vehicle inventory HTML:", error);
  }

  return vehicles;
}

/**
 * Filter vehicles based on search criteria
 */
function filterVehicles(
  vehicles: Vehicle[],
  filters: SearchFilters,
): Vehicle[] {
  return vehicles.filter((vehicle) => {
    // Filter by makes
    if (filters.makes?.length && !filters.makes.includes(vehicle.make)) {
      return false;
    }

    // Filter by models
    if (filters.models?.length && !filters.models.includes(vehicle.model)) {
      return false;
    }

    // Filter by colors
    if (filters.colors?.length && !filters.colors.includes(vehicle.color)) {
      return false;
    }

    // Filter by states
    if (
      filters.states?.length &&
      !filters.states.includes(vehicle.location.stateAbbr)
    ) {
      return false;
    }

    // Filter by year range
    if (filters.yearRange) {
      const [minYear, maxYear] = filters.yearRange;
      if (vehicle.year < minYear || vehicle.year > maxYear) {
        return false;
      }
    }

    // Filter by date range
    if (filters.dateRange) {
      const [startDate, endDate] = filters.dateRange;
      const vehicleDate = new Date(vehicle.availableDate);
      if (vehicleDate < startDate || vehicleDate > endDate) {
        return false;
      }
    }

    // Filter by distance
    if (
      filters.maxDistance &&
      filters.userLocation &&
      vehicle.location.distance > filters.maxDistance
    ) {
      return false;
    }

    return true;
  });
}

export const vehiclesRouter = createTRPCRouter({
  /**
   * Global search across all PYP locations
   */
  search: publicProcedure
    .input(searchFiltersSchema)
    .query(async ({ input, ctx }): Promise<SearchResult> => {
      const startTime = Date.now();

      // Always get user's geolocation for distance calculations
      let userLocation: [number, number] = [39.8283, -98.5795]; // Default to center of US
      try {
        if (ctx.req) {
          const geo = geolocation(ctx.req);
          if (geo?.latitude && geo?.longitude) {
            userLocation = [
              parseFloat(geo.latitude),
              parseFloat(geo.longitude),
            ];
          }
        }
      } catch (error) {
        console.error("Failed to get geolocation:", error);
        // Keep default location
      }

      // Search all locations
      const locationsToSearch = await locationsRouter
        .createCaller({ headers: new Headers() })
        .getAll();

      // Perform parallel searches with concurrency limit using p-limit
      const limit = pLimit(SEARCH_CONFIG.MAX_CONCURRENT_REQUESTS);
      const locationsWithErrors: string[] = [];

      const allVehiclePromises = locationsToSearch.map((location) =>
        limit(async () => {
          try {
            const parsedVehicles = await fetchVehicleInventory(
              location,
              input.query,
            );
            return parsedVehicles.map((vehicle) => {
              // Always calculate distance from user's location
              const distance = calculateDistance(
                userLocation[0],
                userLocation[1],
                location.lat,
                location.lng,
              );

              return {
                ...vehicle,
                location: {
                  ...location,
                  distance,
                },
              } as Vehicle;
            });
          } catch (error) {
            console.error(
              `Error fetching vehicles from ${location.locationCode}:`,
              error,
            );
            locationsWithErrors.push(location.locationCode);
            return [];
          }
        }),
      );

      const allVehicleResults = await Promise.all(allVehiclePromises);
      const allVehicles = allVehicleResults.flat();

      // Apply filters
      const filteredVehicles = filterVehicles(allVehicles, input);

      // Return ALL results - no pagination (sorting is done client-side)
      const allResults = filteredVehicles;

      const searchTime = Date.now() - startTime;

      return {
        vehicles: allResults,
        totalCount: allResults.length,
        page: 1,
        hasMore: false,
        searchTime,
        locationsCovered: locationsToSearch.length - locationsWithErrors.length,
        locationsWithErrors,
      };
    }),

  /**
   * Get vehicle by ID
   */
  getById: publicProcedure
    .input(
      z.object({
        vehicleId: z.string(),
        locationCode: z.string(),
      }),
    )
    .query(async ({ input }): Promise<Vehicle | null> => {
      const location = await locationsRouter
        .createCaller({ headers: new Headers() })
        .getByCode({
          locationCode: input.locationCode,
        });

      if (!location) return null;

      // Fetch specific vehicle (this is simplified - in reality would need to search)
      const vehicles = await fetchVehicleInventory(location, "");
      const vehicleData = vehicles.find((v) => v.id === input.vehicleId);

      if (!vehicleData) return null;

      return {
        ...vehicleData,
        location,
      };
    }),

  /**
   * Get popular makes across all locations
   */
  getPopularMakes: publicProcedure.query(async (): Promise<string[]> => {
    // This would ideally analyze actual inventory data
    // For now, return predefined popular makes
    return [
      "HONDA",
      "TOYOTA",
      "FORD",
      "CHEVROLET",
      "NISSAN",
      "HYUNDAI",
      "KIA",
      "MAZDA",
      "SUBARU",
      "VOLKSWAGEN",
    ];
  }),

  /**
   * Get models for a specific make
   */
  getModelsForMake: publicProcedure
    .input(
      z.object({
        make: z.string(),
      }),
    )
    .query(async ({ input }): Promise<string[]> => {
      // This would ideally query actual inventory data
      // For now, return common models for popular makes
      const makeModels: Record<string, string[]> = {
        HONDA: ["ACCORD", "CIVIC", "CR-V", "PILOT", "ODYSSEY", "FIT", "HR-V"],
        TOYOTA: [
          "CAMRY",
          "COROLLA",
          "RAV4",
          "PRIUS",
          "HIGHLANDER",
          "SIENNA",
          "TACOMA",
        ],
        FORD: [
          "F-150",
          "ESCAPE",
          "FOCUS",
          "FUSION",
          "EXPLORER",
          "EDGE",
          "MUSTANG",
        ],
        CHEVROLET: [
          "SILVERADO",
          "EQUINOX",
          "MALIBU",
          "CRUZE",
          "TAHOE",
          "SUBURBAN",
          "IMPALA",
        ],
        NISSAN: [
          "ALTIMA",
          "SENTRA",
          "ROGUE",
          "PATHFINDER",
          "FRONTIER",
          "TITAN",
          "VERSA",
        ],
      };

      return makeModels[input.make.toUpperCase()] ?? [];
    }),
});
