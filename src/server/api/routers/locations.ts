import { z } from "zod";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Location } from "~/lib/types";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

/**
 * Fetches location data from PYP website with Next.js Data Cache
 * - Uses 'force-cache' for persistent caching across requests
 * - Revalidates every hour to ensure fresh data
 * - Automatic request deduplication within render passes
 * In a real implementation, this would scrape the actual location page
 * For now, we'll use a mock implementation
 */
async function fetchLocationsFromPYP(): Promise<Location[]> {
  try {
    // In production, this would fetch from the actual PYP inventory page
    // and parse the _locationList JavaScript variable
    const response = await fetch(
      `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
      {
        cache: "force-cache", // Use Next.js Data Cache
        next: { revalidate: 3600 }, // Revalidate every hour
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

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

    // Fallback to hardcoded location data for development
    return getMockLocations();
  }
}

/**
 * Mock location data for development
 */
function getMockLocations(): Location[] {
  return [
    {
      locationCode: "1223",
      locationPageURL:
        "https://www.pyp.com/inventory/huntsville-1223/",
      name: "Pick Your Part - Huntsville",
      displayName: "Huntsville",
      address: "6942 Stringfield Rd.",
      city: "Huntsville",
      state: "Alabama",
      stateAbbr: "AL",
      zip: "35806",
      phone: "(800) 962-2277",
      lat: 34.77887,
      lng: -86.652217,
      distance: 0,
      legacyCode: "223",
      primo: "",
      urls: {
        store:
          "https://www.pyp.com/inventory/huntsville-1223/",
        interchange: "/parts/huntsville-1223/",
        inventory: "/inventory/huntsville-1223/",
        prices: "/prices/huntsville-1223/",
        directions:
          "https://www.google.com/maps/dir/?api=1&destination=6942+Stringfield+Rd.+Huntsville+Alabama+35806&dir_action=navigate",
        sellACar: "/sellacar/huntsville-1223/",
        contact: "/contact/huntsville-1223/",
        customerServiceChat: null,
        carbuyChat: null,
        deals: "/deals/huntsville-1223/",
        parts: "/parts/huntsville-1223/",
      },
    },
    // Add more mock locations as needed
  ];
}

export const locationsRouter = createTRPCRouter({
  /**
   * Get all PYP locations
   * Uses Next.js Data Cache for automatic caching and request deduplication
   */
  getAll: publicProcedure.query(async (): Promise<Location[]> => {
    return await fetchLocationsFromPYP();
  }),

  /**
   * Get locations by state
   */
  getByState: publicProcedure
    .input(
      z.object({
        states: z.array(z.string()),
      }),
    )
    .query(async ({ input }): Promise<Location[]> => {
      const allLocations = await fetchLocationsFromPYP();
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
      }),
    )
    .query(async ({ input }): Promise<Location | null> => {
      const allLocations = await fetchLocationsFromPYP();
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
      }),
    )
    .query(async ({ input }): Promise<Location[]> => {
      const allLocations = await fetchLocationsFromPYP();
      const query = input.query.toLowerCase();

      return allLocations.filter(
        (location) =>
          location.displayName.toLowerCase().includes(query) ||
          location.city.toLowerCase().includes(query) ||
          location.state.toLowerCase().includes(query),
      );
    }),

  /**
   * Get unique states that have PYP locations
   */
  getStates: publicProcedure.query(
    async (): Promise<Array<{ code: string; name: string; count: number }>> => {
      const allLocations = await fetchLocationsFromPYP();
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
