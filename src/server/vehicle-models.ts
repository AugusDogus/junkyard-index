import "server-only";

import { and, inArray, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "~/lib/db";
import { cacheInventory } from "~/lib/inventory-cache";
import { HiddenSources } from "~/lib/hidden-source";
import { ModelArrivals } from "~/lib/model-arrivals";
import {
  MakeInventory,
  type MakeEntry,
  type ModelEntry,
} from "~/lib/make-inventory";
import { YardMakeInventory } from "~/lib/yard-make-inventory";
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
  ["make-counts-snapshot-v3"],
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
  ["make-rollup-snapshot-v3", ...HiddenSources.list],
);

/** A model's vehicle with the yard it sits in. */
export type ModelArrival = YardVehicle & { source: string; code: string };

const ARRIVALS = 24;

async function loadModelArrivals(
  rawMakes: string[],
  rawModels: string[],
): Promise<ModelArrival[]> {
  // Providers write dates in different formats, so rank in JS. Read only
  // selection fields, preferring photos and mixing yards before repeats,
  // then fetch the selected vehicles in full by VIN.
  const dated = await db
    .select({
      vin: vehicle.vin,
      source: vehicle.source,
      code: vehicle.locationCode,
      imageUrl: vehicle.imageUrl,
      availableDate: vehicle.availableDate,
      firstSeenAt: vehicle.firstSeenAt,
      observedArrivalAt: vehicle.observedArrivalAt,
    })
    .from(vehicle)
    .where(
      and(
        inArray(vehicle.make, rawMakes),
        inArray(vehicle.model, rawModels),
        LIVE_BY_MAKE,
      ),
    );
  const newest = ModelArrivals.pick(
    dated
      .filter(({ source }) => !HiddenSources.has(source))
      .map(
        ({ availableDate, firstSeenAt, observedArrivalAt, ...candidate }) => ({
          ...candidate,
          addedAt: YardInventory.addedAt(
            availableDate,
            firstSeenAt.getTime(),
            observedArrivalAt?.getTime() ?? null,
          ),
        }),
      ),
    ARRIVALS,
  ).map(({ vin }) => vin);
  if (newest.length === 0) return [];
  const rows = await db
    .select({
      vin: vehicle.vin,
      source: vehicle.source,
      code: vehicle.locationCode,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      sourceModel: vehicle.sourceModel,
      trim: vehicle.trim,
      engine: vehicle.engine,
      color: vehicle.color,
      stockNumber: vehicle.stockNumber,
      section: vehicle.section,
      row: vehicle.row,
      space: vehicle.space,
      availableDate: vehicle.availableDate,
      firstSeenAt: vehicle.firstSeenAt,
      observedArrivalAt: vehicle.observedArrivalAt,
      imageUrl: vehicle.imageUrl,
      detailsUrl: vehicle.detailsUrl,
    })
    .from(vehicle)
    .where(inArray(vehicle.vin, newest));
  return YardInventory.sort(
    rows.map(({ source, code, firstSeenAt, observedArrivalAt, ...row }) => ({
      ...YardInventory.vehicle({
        ...row,
        firstSeenAt: firstSeenAt.getTime(),
        observedArrivalAt: observedArrivalAt?.getTime() ?? null,
      }),
      source,
      code,
    })),
  );
}

/** One model's most recently set vehicles, across all yards. */
const getModelArrivals = cacheInventory(loadModelArrivals, [
  "model-arrivals-v5",
  ...HiddenSources.list,
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

/** Canonical yard-make pages meeting the same threshold as their metadata. */
export async function getYardMakePages(): Promise<YardMakeInventory[]> {
  const makes = await getMakes();
  const pages = await Promise.all(
    makes.map(async (make) =>
      YardMakeInventory.indexable(make, await getMakeRollup(make.key)),
    ),
  );
  return pages.flat();
}
