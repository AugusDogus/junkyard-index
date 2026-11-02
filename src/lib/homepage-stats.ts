import { desc, isNotNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "~/lib/db";
import { ingestionRun } from "~/schema";

/**
 * Homepage inventory changes once a day, so its caches last a day and the
 * daily ingestion pass invalidates this tag once every source has published.
 */
export const HOMEPAGE_CACHE_TAG = "homepage-live-stats";
export const HOMEPAGE_CACHE_SECONDS = 24 * 60 * 60;

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
    revalidate: HOMEPAGE_CACHE_SECONDS,
    tags: [HOMEPAGE_CACHE_TAG],
  },
);
