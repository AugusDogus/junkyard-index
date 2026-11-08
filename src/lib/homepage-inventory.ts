import "server-only";

import { asc, desc, isNull } from "drizzle-orm";
import { db } from "~/lib/db";
import { cacheInventory } from "~/lib/inventory-cache";
import { RecentArrivals } from "~/lib/recent-arrivals";
import { getHomepageYards } from "~/server/homepage-yards";
import { vehicle } from "~/schema";

async function getHomepageInventoryInternal() {
  const [yards, recentVehicles] = await Promise.all([
    getHomepageYards(db),
    db
      .select({
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        city: vehicle.locationCity,
        state: vehicle.stateAbbr,
        imageUrl: vehicle.imageUrl,
        indexedAt: vehicle.firstSeenAt,
      })
      .from(vehicle)
      .where(isNull(vehicle.missingSinceAt))
      .orderBy(desc(vehicle.firstSeenAt), asc(vehicle.vin))
      // A batch lists many of one model in a row; read enough to vary them.
      .limit(80),
  ]);

  return {
    yards,
    recentVehicles: RecentArrivals.pick(recentVehicles, 12).map((entry) => ({
      ...entry,
      indexedAt: entry.indexedAt.toISOString(),
    })),
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
  ["homepage-inventory", "varied-arrivals-v1"],
);
