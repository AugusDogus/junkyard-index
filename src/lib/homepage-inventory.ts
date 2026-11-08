import "server-only";

import { db } from "~/lib/db";
import { cacheInventory } from "~/lib/inventory-cache";
import { RecentArrivals } from "~/lib/recent-arrivals";
import { getHomepageYards } from "~/server/homepage-yards";
import { getRecentHomepageVehicles } from "~/server/homepage-recent-vehicles";

async function getHomepageInventoryInternal() {
  const [yards, recentVehicles] = await Promise.all([
    getHomepageYards(db),
    // Read more established-yard arrivals so the showcase can vary models.
    getRecentHomepageVehicles(db, 80),
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

export const getHomepageInventory = cacheInventory(
  getHomepageInventoryInternal,
  ["homepage-inventory", "varied-arrivals-v2"],
);
