import { unstable_cache } from "next/cache";
import { API_ENDPOINTS } from "~/lib/constants";

interface ODataCountResponse {
  "@odata.count"?: number;
}

export interface HomepageLiveStats {
  vehicleCount: number;
  yardCount: number;
  updatedAt: string;
}

async function fetchPypYardCount(): Promise<number> {
  const response = await fetch(
    `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
    {
      cache: "force-cache",
      next: { revalidate: 3600 },
    },
  );

  if (!response.ok) {
    throw new Error(
      `PYP location fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();
  const locationListMatch = /var _locationList\s*=\s*(\[.*?\]);/s.exec(html);
  if (!locationListMatch) {
    throw new Error("Could not parse PYP location list from inventory page");
  }

  const parsed = JSON.parse(locationListMatch[1] ?? "[]") as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("PYP location list format was invalid");
  }

  return parsed.length;
}

async function fetchRow52Count(
  endpoint: string,
  filter: string,
): Promise<number> {
  const url = new URL(`${API_ENDPOINTS.ROW52_BASE}${endpoint}`);
  url.searchParams.set("$filter", filter);
  url.searchParams.set("$count", "true");
  url.searchParams.set("$top", "1");

  const response = await fetch(url.toString(), {
    cache: "force-cache",
    next: { revalidate: 3600 },
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Row52 count fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as ODataCountResponse;
  if (typeof data["@odata.count"] !== "number") {
    throw new Error("Row52 response did not include an @odata.count value");
  }

  return data["@odata.count"];
}

async function getLiveHomepageStatsInternal(): Promise<HomepageLiveStats> {
  const [pypYards, row52Yards, row52Vehicles] = await Promise.all([
    fetchPypYardCount(),
    fetchRow52Count(API_ENDPOINTS.ROW52_LOCATIONS, "isParticipating eq true"),
    fetchRow52Count(API_ENDPOINTS.ROW52_VEHICLES, "isActive eq true"),
  ]);

  return {
    vehicleCount: row52Vehicles,
    yardCount: pypYards + row52Yards,
    updatedAt: new Date().toISOString(),
  };
}

export const getLiveHomepageStats = unstable_cache(
  getLiveHomepageStatsInternal,
  ["homepage-live-stats"],
  {
    revalidate: 3600,
    tags: ["homepage-live-stats"],
  },
);
