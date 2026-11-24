import "server-only";

import { db } from "~/lib/db";
import type { HiddenSources } from "~/lib/hidden-source";
import { RETIRED_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { RecentArrivals } from "~/lib/recent-arrivals";
import { getHomepageYards } from "~/server/homepage-yards";
import { getRecentHomepageVehicles } from "~/server/homepage-recent-vehicles";
import { cacheShownInventory } from "~/server/source-control/hidden-sources-loader";

async function getHomepageInventoryInternal(hidden: HiddenSources) {
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

// A hide or show from /admin expires it (see cacheShownInventory).
export const getHomepageInventory = cacheShownInventory(
  getHomepageInventoryInternal,
  [
    "homepage-inventory",
    "active-yards-v6",
    "recent-yard-mix-v1",
    ...RETIRED_INGESTION_SOURCES,
  ],
);
