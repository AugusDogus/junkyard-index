import "server-only";

import { and, gte, lte } from "drizzle-orm";
import { env } from "~/env";
import { db } from "~/lib/db";
import { IndexNow, type IndexNowSubmission } from "~/lib/indexnow";
import { MakeInventory } from "~/lib/make-inventory";
import { PageWarmup, type PageWarmupResult } from "~/lib/page-warmup";
import { VehicleName } from "~/lib/vehicle-name";
import { YardBrand } from "~/lib/yard-brand";
import { YardPath } from "~/lib/yard-path";
import {
  InventoryAnnouncement,
  type AnnouncementWindow,
} from "~/server/inventory-announcement";
import { getMakeModels, getMakes } from "~/server/vehicle-models";
import { getRoutedYards, getSourcePublishedAt } from "~/server/yard-inventory";
import { vehicle } from "~/schema";

/**
 * Pages whose inventory changed in the window: yards with arrivals or
 * removals, their state and chain pages, the make and model pages of
 * arrivals, and the directories that list counts.
 */
export async function changedInventoryPaths(
  window: AnnouncementWindow,
): Promise<string[]> {
  // Each reads only the changed rows, through an index range on first_seen_at
  // or missing_since_at. Not DISTINCT: SQLite then scans the whole table
  // through vehicle_source_idx to get sorted output. Sets dedupe below.
  const [arrivals, removals, yards, makes] = await Promise.all([
    db
      .select({
        source: vehicle.source,
        code: vehicle.locationCode,
        make: vehicle.make,
        model: vehicle.model,
      })
      .from(vehicle)
      .where(
        and(
          gte(vehicle.firstSeenAt, window.since),
          lte(vehicle.firstSeenAt, window.until),
        ),
      ),
    db
      .select({ source: vehicle.source, code: vehicle.locationCode })
      .from(vehicle)
      .where(
        and(
          gte(vehicle.missingSinceAt, window.since),
          lte(vehicle.missingSinceAt, window.until),
        ),
      ),
    getRoutedYards(),
    getMakes(),
  ]);
  const changed = new Set(
    [...arrivals, ...removals].map(({ source, code }) => `${source}:${code}`),
  );
  const changedYards = yards.filter((yard) => changed.has(YardPath.key(yard)));
  if (changedYards.length === 0) return [];

  const paths = new Set(["/junkyards", "/chains", "/cars"]);
  for (const yard of changedYards) {
    paths.add(yard.path.href);
    paths.add(YardPath.regionHref(yard.path.region));
  }
  const changedHrefs = new Set(changedYards.map((yard) => yard.path.href));
  // From the yards already loaded: React's cache does not dedupe outside a
  // render, so getChains() would read the yard directory again.
  for (const chain of YardBrand.chains(yards)) {
    if (chain.yards.some((yard) => changedHrefs.has(yard.path.href))) {
      paths.add(chain.href);
    }
  }

  // Arrivals change make and model pages; only indexable ones are worth a crawl.
  const arrivedModels = new Map<string, Set<string>>();
  for (const { make, model } of arrivals) {
    const makeKey = VehicleName.makeKey(make);
    const modelKey = VehicleName.modelKey(make, model);
    if (!makeKey || !modelKey) continue;
    arrivedModels.set(
      makeKey,
      (arrivedModels.get(makeKey) ?? new Set()).add(modelKey),
    );
  }
  const arrivedMakes = makes.flatMap((make) => {
    const modelKeys = arrivedModels.get(make.key);
    return modelKeys && MakeInventory.indexable(make)
      ? [{ make, modelKeys }]
      : [];
  });
  // Each make's models come from its cached rollup, not its page data, which
  // would also reread the yard directory and the make list.
  const arrivedMakeModels = await Promise.all(
    arrivedMakes.map(async ({ make, modelKeys }) => ({
      make,
      modelKeys,
      models: await getMakeModels(make),
    })),
  );
  for (const { make, modelKeys, models } of arrivedMakeModels) {
    paths.add(make.href);
    for (const model of models) {
      if (modelKeys.has(model.key) && MakeInventory.indexable(model)) {
        paths.add(model.href);
      }
    }
  }
  return [...paths];
}

/**
 * Pages changed by the publications not yet announced, through this one.
 * Production only: previews must not warm or announce their URLs.
 */
async function unannouncedInventoryPaths(
  publicationSequence: number,
): Promise<string[]> {
  if (process.env.VERCEL_ENV !== "production") return [];
  const window = await InventoryAnnouncement.window(
    db,
    publicationSequence,
    new Date(),
  );
  return window ? changedInventoryPaths(window) : [];
}

/**
 * Reads the inventory caches the changed pages share. Right after a refresh
 * those reads get the old data and rebuild it in the background, once, so the
 * pages regenerating later read fresh data instead of each rebuilding it.
 * Returns how many pages changed.
 */
export async function primeChangedInventory(
  publicationSequence: number,
): Promise<number> {
  const paths = await unannouncedInventoryPaths(publicationSequence);
  // Yard pages also share the sources' publish times.
  if (paths.length > 0) await getSourcePublishedAt();
  return paths.length;
}

/** Requests each changed page so it regenerates with the new inventory. */
export async function warmChangedInventory(
  publicationSequence: number,
): Promise<PageWarmupResult & { paths: string[] }> {
  const paths = await unannouncedInventoryPaths(publicationSequence);
  const warmup = await PageWarmup.run(env.NEXT_PUBLIC_APP_URL, paths);
  return { ...warmup, paths };
}

/**
 * Tells IndexNow engines these pages changed, then records the publication
 * as announced. A failed submission leaves the checkpoint behind, so the next
 * publication's announcement includes these changes.
 */
export async function announceInventoryPaths(
  publicationSequence: number,
  paths: readonly string[],
): Promise<IndexNowSubmission> {
  const submission = await IndexNow.submit(env.NEXT_PUBLIC_APP_URL, paths);
  if (submission.status !== "failed") {
    await InventoryAnnouncement.record(db, publicationSequence);
  }
  return submission;
}
