import "server-only";

import { asc, desc, isNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "~/lib/db";
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
      .limit(12),
  ]);

  return {
    yards,
    recentVehicles: recentVehicles.map((entry) => ({
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

export const getHomepageInventory = unstable_cache(
  getHomepageInventoryInternal,
  ["homepage-inventory", "yard-metadata-v2"],
  { revalidate: 3600, tags: ["homepage-live-stats"] },
);
