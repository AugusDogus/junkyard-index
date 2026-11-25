import "server-only";

import { db } from "~/lib/db";
import { RETIRED_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { RecentArrivals } from "~/lib/recent-arrivals";
import { getHomepageYards } from "~/server/homepage-yards";
import { getRecentHomepageVehicles } from "~/server/homepage-recent-vehicles";
import { cacheShownInventory } from "~/server/source-control/hidden-sources-loader";

/**
 * Every yard with live inventory, for every listing, yard page and sitemap.
 * Its own entry, apart from the homepage's recent arrivals: those read up to
 * 500 vehicles through a join (20-30K rows in November 2026), and every page
 * that lists yards, rendered thousands of times a day, re-ran that read
 * whenever the shared entry was stale. A hide or show from /admin expires it
 * (see cacheShownInventory).
 */
export const getDirectoryYards = cacheShownInventory(
  (hidden) => getHomepageYards(db, hidden),
  ["directory-yards-v1", "active-yards-v6", ...RETIRED_INGESTION_SOURCES],
);

/** The homepage's showcase of recent arrivals at established yards. */
const getRecentArrivals = cacheShownInventory(
  async (hidden) =>
    // Read more established-yard arrivals so the showcase can vary models
    // and yards. The yard identity varies the pick and dates each card's
    // "Last checked".
    RecentArrivals.pick(
      await getRecentHomepageVehicles(db, hidden, 500),
      12,
    ).map(
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
  [
    "homepage-recent-arrivals-v1",
    "recent-yard-mix-v1",
    ...RETIRED_INGESTION_SOURCES,
  ],
);

/** What the homepage shows: the yard directory and recent arrivals. */
export async function getHomepageInventory() {
  const [yards, recentVehicles] = await Promise.all([
    getDirectoryYards(),
    getRecentArrivals(),
  ]);
  return { yards, recentVehicles };
}

export type HomepageYard = Awaited<
  ReturnType<typeof getDirectoryYards>
>[number];
export type RecentVehicle = Awaited<
  ReturnType<typeof getRecentArrivals>
>[number];
