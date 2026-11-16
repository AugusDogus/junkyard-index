import "server-only";

import { unstable_cache } from "next/cache";
import { db } from "~/lib/db";
import {
  HOMEPAGE_CACHE_SECONDS,
  HOMEPAGE_CACHE_TAG,
} from "~/lib/homepage-stats";
import { getRecentHomepageVehicles } from "~/server/homepage-recent-vehicles";
import { getHomepageYards } from "~/server/homepage-yards";

async function getHomepageInventoryInternal() {
  const [yards, recentVehicles] = await Promise.all([
    getHomepageYards(db),
    getRecentHomepageVehicles(db),
  ]);
  return { yards, recentVehicles };
}

export type HomepageYard = Awaited<
  ReturnType<typeof getHomepageInventoryInternal>
>["yards"][number];
export type RecentVehicle = Awaited<
  ReturnType<typeof getHomepageInventoryInternal>
>["recentVehicles"][number];

export const getHomepageInventory = unstable_cache(
  getHomepageInventoryInternal,
  ["homepage-inventory", "yard-metadata-v2"],
  { revalidate: HOMEPAGE_CACHE_SECONDS, tags: [HOMEPAGE_CACHE_TAG] },
);
