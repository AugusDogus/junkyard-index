import "server-only";

import { db } from "~/lib/db";
import { cacheInventory } from "~/lib/inventory-cache";
import { HiddenSources } from "~/lib/hidden-source";
import { RecentArrivals } from "~/lib/recent-arrivals";
import { getHomepageYards } from "~/server/homepage-yards";
import { getRecentHomepageVehicles } from "~/server/homepage-recent-vehicles";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";

async function getHomepageInventoryInternal(hiddenList: readonly string[]) {
  const hidden = HiddenSources.of(hiddenList);
  const [yards, recentVehicles] = await Promise.all([
    getHomepageYards(db, hidden),
    // Read more established-yard arrivals so the showcase can vary models.
    getRecentHomepageVehicles(db, hidden, 80),
  ]);

  return {
    yards,
    recentVehicles: RecentArrivals.pick(recentVehicles, 12),
  };
}

export type HomepageYard = Awaited<
  ReturnType<typeof getHomepageInventoryInternal>
>["yards"][number];
export type RecentVehicle = Awaited<
  ReturnType<typeof getHomepageInventoryInternal>
>["recentVehicles"][number];

// The hidden list is an argument, so it is part of the cache key: a hide or
// show reads a fresh entry at once.
const getCachedHomepageInventory = cacheInventory(
  getHomepageInventoryInternal,
  ["homepage-inventory", "active-yards-v4"],
);

export async function getHomepageInventory() {
  return getCachedHomepageInventory((await getHiddenSources()).list);
}
