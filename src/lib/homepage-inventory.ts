import "server-only";

import { asc, count, desc, isNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "~/lib/db";
import { vehicle } from "~/schema";

async function getHomepageInventoryInternal() {
  const [yards, recentVehicles] = await Promise.all([
    db
      .select({
        source: vehicle.source,
        code: vehicle.locationCode,
        name: vehicle.locationName,
        city: vehicle.locationCity,
        state: vehicle.stateAbbr,
        lat: vehicle.lat,
        lng: vehicle.lng,
        vehicleCount: count(),
      })
      .from(vehicle)
      .where(isNull(vehicle.missingSinceAt))
      .groupBy(vehicle.source, vehicle.locationCode)
      .orderBy(asc(vehicle.stateAbbr), asc(vehicle.locationName)),
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
  ["homepage-inventory"],
  { revalidate: 3600, tags: ["homepage-live-stats"] },
);
