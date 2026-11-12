import "server-only";

import { and, inArray, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "~/lib/db";
import { cacheInventory } from "~/lib/inventory-cache";
import {
  MakeInventory,
  type MakeEntry,
  type ModelEntry,
} from "~/lib/make-inventory";
import { VehicleName } from "~/lib/vehicle-name";
import { YardInventory, type YardVehicle } from "~/lib/yard-inventory";
import { InventorySnapshot } from "~/server/inventory-snapshot";
import { getRoutedYards, type RoutedYard } from "~/server/yard-inventory";
import { vehicle } from "~/schema";

// SQLite has no statistics here, so for any "live vehicles" filter it picks
// vehicle_missing_since_at_idx and walks every live vehicle. Writing the
// filter as `+missing_since_at` keeps it off that index, so the model
// arrivals query below reads only its model's rows via vehicle_make_model_idx.
const LIVE_BY_MAKE = sql`+${vehicle.missingSinceAt} is null`;

/** Live vehicles per raw make, from the stored inventory snapshot. */
const getMakeCounts = cacheInventory(
  () => InventorySnapshot.makeCounts(db),
  ["make-counts-snapshot-v1"],
);

/** Every make with live vehicles, most first. */
export const getMakes = cache(
  async (): Promise<MakeEntry[]> => MakeInventory.makes(await getMakeCounts()),
);

/** Each make's URL slug, by make key, for linking from yard pages. */
export const getMakeSlugs = cache(
  async (): Promise<ReadonlyMap<string, string>> =>
    new Map((await getMakes()).map((make) => [make.key, make.slug])),
);

/**
 * The make at /cars/{slug}. Also matches other spellings and aliases
 * ("mercedesbenz", "vw", "chevy"), which the page redirects to its slug.
 */
export const findMake = cache(
  async (slug: string): Promise<MakeEntry | null> => {
    const key = VehicleName.makeKey(slug);
    return (
      (await getMakes()).find(
        (make) => VehicleName.sameSlug(make.slug, slug) || make.key === key,
      ) ?? null
    );
  },
);

/** One make's live vehicles per yard and raw model, from the snapshot. */
const getMakeRollup = cacheInventory(
  (makeKey: string) => InventorySnapshot.makeModels(db, makeKey),
  ["make-rollup-snapshot-v1"],
);

/** A model's vehicle with the yard it sits in. */
export type ModelArrival = YardVehicle & { source: string; code: string };

const ARRIVALS = 24;

async function loadModelArrivals(
  rawMakes: string[],
  rawModels: string[],
): Promise<ModelArrival[]> {
  // Rank by the yard's own set date. Providers write it in different formats,
  // so SQL can't sort it; read just the dates for the model, then fetch the
  // newest vehicles in full by VIN.
  const dated = await db
    .select({
      vin: vehicle.vin,
      availableDate: vehicle.availableDate,
      firstSeenAt: vehicle.firstSeenAt,
    })
    .from(vehicle)
    .where(
      and(
        inArray(vehicle.make, rawMakes),
        inArray(vehicle.model, rawModels),
        LIVE_BY_MAKE,
      ),
    );
  const newest = dated
    .map(({ vin, availableDate, firstSeenAt }) => ({
      vin,
      addedAt: YardInventory.addedAt(availableDate, firstSeenAt.getTime()),
    }))
    .sort((a, b) => b.addedAt - a.addedAt || a.vin.localeCompare(b.vin))
    .slice(0, ARRIVALS)
    .map(({ vin }) => vin);
  if (newest.length === 0) return [];
  const rows = await db
    .select({
      vin: vehicle.vin,
      source: vehicle.source,
      code: vehicle.locationCode,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      engine: vehicle.engine,
      color: vehicle.color,
      stockNumber: vehicle.stockNumber,
      section: vehicle.section,
      row: vehicle.row,
      space: vehicle.space,
      availableDate: vehicle.availableDate,
      firstSeenAt: vehicle.firstSeenAt,
      imageUrl: vehicle.imageUrl,
      detailsUrl: vehicle.detailsUrl,
    })
    .from(vehicle)
    .where(inArray(vehicle.vin, newest));
  return YardInventory.sort(
    rows.map(({ source, code, firstSeenAt, ...row }) => ({
      ...YardInventory.vehicle({ ...row, firstSeenAt: firstSeenAt.getTime() }),
      source,
      code,
    })),
  );
}

/** One model's most recently set vehicles, across all yards. */
const getModelArrivals = cacheInventory(loadModelArrivals, [
  "model-arrivals-v3",
]);

function yardsByKey(yards: readonly RoutedYard[]): Map<string, RoutedYard> {
  return new Map(yards.map((yard) => [`${yard.source}:${yard.code}`, yard]));
}

/** A make's models, most vehicles first. */
export async function getMakeModels(make: MakeEntry): Promise<ModelEntry[]> {
  return MakeInventory.models(make, await getMakeRollup(make.key));
}

/** A make's models and the yard pages they link to. */
export const getMakePageData = cache(async (makeSlug: string) => {
  const make = await findMake(makeSlug);
  if (!make) return null;
  const [models, yards] = await Promise.all([
    getMakeModels(make),
    getRoutedYards(),
  ]);
  return { make, models, yards: yardsByKey(yards) };
});

/** A model's yards and newest arrivals, or null when it has none. */
export const getModelPageData = cache(
  async (makeSlug: string, modelSlug: string) => {
    const makeData = await getMakePageData(makeSlug);
    // Match by identity, so other spellings of the model ("mazda-3", "3")
    // reach it; the page redirects them to its slug.
    const wanted =
      makeData &&
      VehicleName.modelKey(makeData.make.name, modelSlug.replace(/-/g, " "));
    const model =
      makeData?.models.find((candidate) => candidate.key === wanted) ??
      makeData?.models.find((candidate) =>
        VehicleName.sameSlug(candidate.slug, modelSlug),
      );
    if (!makeData || !model) return null;
    const arrivals = await getModelArrivals(
      makeData.make.rawMakes,
      model.rawModels,
    );
    return { ...makeData, model, arrivals };
  },
);

export type MakePageData = NonNullable<
  Awaited<ReturnType<typeof getMakePageData>>
>;
export type { MakeEntry, ModelEntry };
