import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "~/lib/db";
import { vehicle } from "~/schema";

export interface HomepageLiveStats {
  vehicleCount: number;
  yardCount: number;
  updatedAt: string;
}

async function getLiveHomepageStatsInternal(): Promise<HomepageLiveStats> {
  // Query the canonical vehicle table for counts
  const [vehicleCountResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(vehicle);

  const [yardCountResult] = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${vehicle.locationCode})` })
    .from(vehicle);

  return {
    vehicleCount: vehicleCountResult?.count ?? 0,
    yardCount: yardCountResult?.count ?? 0,
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
