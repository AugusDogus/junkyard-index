import "server-only";

import { db } from "~/lib/db";
import { cacheInventory } from "~/lib/inventory-cache";
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

export const getHomepageInventory = cacheInventory(
  getHomepageInventoryInternal,
  ["homepage-inventory", "yard-paths-v3"],
);
