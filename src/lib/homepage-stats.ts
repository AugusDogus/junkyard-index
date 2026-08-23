import { desc, isNotNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "~/lib/db";
import { ingestionRun } from "~/schema";

export interface HomepageLiveStats {
  vehicleCount: number;
  yardCount: number;
  updatedAt: string;
}

async function getLiveHomepageStatsInternal(): Promise<HomepageLiveStats> {
  const [result] = await db
    .select({
      vehicleCount: ingestionRun.publishedVehicleCount,
      yardCount: ingestionRun.publishedYardCount,
      searchPublishedAt: ingestionRun.searchPublishedAt,
    })
    .from(ingestionRun)
    .where(isNotNull(ingestionRun.searchPublishedAt))
    .orderBy(desc(ingestionRun.searchPublishedAt))
    .limit(1);

  return {
    vehicleCount: result?.vehicleCount ?? 0,
    yardCount: result?.yardCount ?? 0,
    updatedAt: (result?.searchPublishedAt ?? new Date(0)).toISOString(),
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
