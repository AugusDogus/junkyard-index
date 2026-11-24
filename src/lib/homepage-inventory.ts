import "server-only";

import { db } from "~/lib/db";
import { cacheInventory } from "~/lib/inventory-cache";
import { HiddenSources } from "~/lib/hidden-source";
import { RETIRED_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { RecentArrivals } from "~/lib/recent-arrivals";
import { getHomepageYards } from "~/server/homepage-yards";
import { getRecentHomepageVehicles } from "~/server/homepage-recent-vehicles";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";

async function getHomepageInventoryInternal(hiddenList: readonly string[]) {
  const hidden = HiddenSources.of(hiddenList);
  const [yards, recentVehicles] = await Promise.all([
    getHomepageYards(db, hidden),
    // Read more established-yard arrivals so the showcase can vary models
    // and yards.
    getRecentHomepageVehicles(db, hidden, 500),
  ]);

  return {
    yards,
    // The yard identity varies the pick and dates each card's "Last checked".
    recentVehicles: RecentArrivals.pick(recentVehicles, 12).map(
      ({
        year,
        make,
        model,
        source,
        locationCode,
        city,
        state,
        imageUrl,
        indexedAt,
      }) => ({
        year,
        make,
        model,
        source,
        locationCode,
        city,
        state,
        imageUrl,
        indexedAt,
      }),
    ),
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
  [
    "homepage-inventory",
    "active-yards-v5",
    "recent-yard-mix-v1",
    ...RETIRED_INGESTION_SOURCES,
  ],
);

export async function getHomepageInventory() {
  return getCachedHomepageInventory((await getHiddenSources()).list);
}
