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
  const [result] = await db
    .select({
      vehicleCount: sql<number>`COUNT(*)`,
      yardCount: sql<number>`COUNT(DISTINCT ${vehicle.locationCode})`,
    })
    .from(vehicle);

  return {
    vehicleCount: result?.vehicleCount ?? 0,
    yardCount: result?.yardCount ?? 0,
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
