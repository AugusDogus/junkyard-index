import { z } from "zod";
import { API_ENDPOINTS } from "~/lib/constants";
import type { DataSource, Location } from "~/lib/types";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { fetchLocationsFromRow52 } from "./row52";
import { fetchWithTimeoutRetry } from "~/server/ingestion/fetch-with-retry";

const PYP_LOCATION_TIMEOUT_MS = 15_000;
const PYP_LOCATION_RETRIES = 2;
const PYP_LOCATION_BASE_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = [429, 502, 503, 504];

function shouldDisablePypFetch(): boolean {
  const value = process.env.DISABLE_PYP_FETCH;
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
}

async function fetchPypLocationHtml(): Promise<string> {
  const response = await fetchWithTimeoutRetry(
    `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "force-cache",
      next: { revalidate: 3600 },
    },
    {
      context: "PYP locations page",
      logPrefix: "[PYP locations]",
      timeoutMs: PYP_LOCATION_TIMEOUT_MS,
      retries: PYP_LOCATION_RETRIES,
      baseDelayMs: PYP_LOCATION_BASE_DELAY_MS,
      retryStatusCodes: RETRYABLE_STATUS_CODES,
    },
  );

  if (!response.ok) {
    throw new Error(`PYP locations HTTP error: ${response.status}`);
  }

  return response.text();
}

/**
 * Fetches location data from PYP website with Next.js Data Cache
 * - Uses 'force-cache' for persistent caching across requests
 * - Revalidates every hour to ensure fresh data
 * - Automatic request deduplication within render passes
 * In a real implementation, this would scrape the actual location page.
 */
export async function fetchLocationsFromPYP(): Promise<Location[]> {
  if (shouldDisablePypFetch()) {
    console.warn(
      "[PYP locations] DISABLE_PYP_FETCH is enabled; skipping PYP locations",
    );
    return [];
  }

  try {
    const html = await fetchPypLocationHtml();

    // Parse the _locationList variable from the HTML
    // Handle both spaced and non-spaced formats: "var _locationList = [" and "var _locationList=["
    const locationListMatch = /var _locationList\s*=\s*(\[.*?\]);/s.exec(html);

    if (!locationListMatch) {
      throw new Error("Could not find _locationList in HTML");
    }

    const locationData = JSON.parse(locationListMatch[1] ?? "[]") as Array<{
      LocationCode: string;
      LocationPageURL: string;
      Name: string;
      DisplayName: string;
      Address: string;
      City: string;
      State: string;
      StateAbbr: string;
      Zip: string;
      Phone: string;
      Lat: number;
      Lng: number;
      Distance: number;
      LegacyCode: string;
      Primo: string;
      Urls: {
        Store: string;
        Interchange: string;
        Inventory: string;
        Prices: string;
        Directions: string;
        SellACar: string;
        Contact: string;
        CustomerServiceChat: string | null;
        CarbuyChat: string | null;
        Deals: string;
        Parts: string;
      };
    }>;

    // Transform to our interface format
    const locations: Location[] = locationData.map((loc) => ({
      locationCode: loc.LocationCode,
      locationPageURL: loc.LocationPageURL,
      name: loc.Name,
      displayName: loc.DisplayName,
      address: loc.Address,
      city: loc.City,
      state: loc.State,
      stateAbbr: loc.StateAbbr,
      zip: loc.Zip,
      phone: loc.Phone,
      lat: loc.Lat,
      lng: loc.Lng,
      distance: loc.Distance,
      legacyCode: loc.LegacyCode,
      primo: loc.Primo,
      source: "pyp" as const,
      urls: {
        store: loc.Urls.Store,
        interchange: loc.Urls.Interchange,
        inventory: loc.Urls.Inventory,
        prices: loc.Urls.Prices,
        directions: loc.Urls.Directions,
        sellACar: loc.Urls.SellACar,
        contact: loc.Urls.Contact,
        customerServiceChat: loc.Urls.CustomerServiceChat,
        carbuyChat: loc.Urls.CarbuyChat,
        deals: loc.Urls.Deals,
        parts: loc.Urls.Parts,
      },
    }));

    return locations;
  } catch (error) {
    console.error("Error fetching locations from PYP:", error);
    return [];
  }
}

async function fetchAllLocations(sources?: DataSource[]): Promise<Location[]> {
  const sourcesToFetch = sources ?? ["pyp", "row52"];
  const sourceFetchers: Array<{
    source: DataSource;
    load: () => Promise<Location[]>;
  }> = [];

  if (sourcesToFetch.includes("pyp")) {
    sourceFetchers.push({ source: "pyp", load: fetchLocationsFromPYP });
  }
  if (sourcesToFetch.includes("row52")) {
    sourceFetchers.push({ source: "row52", load: fetchLocationsFromRow52 });
  }

  const settled = await Promise.allSettled(
    sourceFetchers.map(async (entry) => ({
      source: entry.source,
      locations: await entry.load(),
    })),
  );

  const allLocations: Location[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      allLocations.push(...result.value.locations);
    } else {
      console.error("[Locations] Source load failed:", result.reason);
    }
  }

  if (allLocations.length === 0) {
    console.warn("[Locations] All sources unavailable; returning empty list");
    return [];
  }

  return allLocations;
}

export const locationsRouter = createTRPCRouter({
  /**
   * Get all locations from all sources
   * Uses Next.js Data Cache for automatic caching and request deduplication
   */
  getAll: publicProcedure
    .input(
      z
        .object({
          sources: z.array(z.enum(["pyp", "row52"])).optional(),
        })
        .optional(),
    )
    .query(async ({ input }): Promise<Location[]> => {
      return await fetchAllLocations(input?.sources);
    }),

  /**
   * Get locations by state
   */
  getByState: publicProcedure
    .input(
      z.object({
        states: z.array(z.string()),
        sources: z.array(z.enum(["pyp", "row52"])).optional(),
      }),
    )
    .query(async ({ input }): Promise<Location[]> => {
      const allLocations = await fetchAllLocations(input.sources);
      return allLocations.filter((location) =>
        input.states.includes(location.stateAbbr),
      );
    }),

  /**
   * Get a specific location by code
   */
  getByCode: publicProcedure
    .input(
      z.object({
        locationCode: z.string(),
        source: z.enum(["pyp", "row52"]).optional(),
      }),
    )
    .query(async ({ input }): Promise<Location | null> => {
      const allLocations = await fetchAllLocations(
        input.source ? [input.source] : undefined,
      );
      return (
        allLocations.find(
          (location) => location.locationCode === input.locationCode,
        ) ?? null
      );
    }),

  /**
   * Search locations by name or city
   */
  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1),
        sources: z.array(z.enum(["pyp", "row52"])).optional(),
      }),
    )
    .query(async ({ input }): Promise<Location[]> => {
      const allLocations = await fetchAllLocations(input.sources);
      const query = input.query.toLowerCase();

      return allLocations.filter(
        (location) =>
          location.displayName.toLowerCase().includes(query) ||
          location.city.toLowerCase().includes(query) ||
          location.state.toLowerCase().includes(query),
      );
    }),

  /**
   * Get unique states that have locations
   */
  getStates: publicProcedure
    .input(
      z
        .object({
          sources: z.array(z.enum(["pyp", "row52"])).optional(),
        })
        .optional(),
    )
    .query(
      async ({
        input,
      }): Promise<Array<{ code: string; name: string; count: number }>> => {
        const allLocations = await fetchAllLocations(input?.sources);
        const stateMap = new Map<string, { name: string; count: number }>();

        allLocations.forEach((location) => {
          const existing = stateMap.get(location.stateAbbr);
          if (existing) {
            existing.count++;
          } else {
            stateMap.set(location.stateAbbr, {
              name: location.state,
              count: 1,
            });
          }
        });

        return Array.from(stateMap.entries())
          .map(([code, data]) => ({
            code,
            name: data.name,
            count: data.count,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      },
    ),
});
