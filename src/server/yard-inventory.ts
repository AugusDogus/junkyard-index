import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { db } from "~/lib/db";
import { Region } from "~/lib/region";
import { calculateDistance } from "~/lib/utils";
import { YardBrand, type Chain } from "~/lib/yard-brand";
import type { YardPath } from "~/lib/yard-path";
import { getHomepageInventory } from "~/lib/homepage-inventory";
import { cacheInventory } from "~/lib/inventory-cache";
import { HiddenSources } from "~/lib/hidden-source";
import {
  isIngestionSource,
  isRetiredIngestionSource,
  RETIRED_INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  InventoryStaleness,
  type InventoryCheckDates,
  type InventoryFreshness,
} from "~/lib/inventory-staleness";
import { VehicleName } from "~/lib/vehicle-name";
import {
  YardInventory,
  type YardInventoryPage,
  type YardSummary,
  type YardVehicle,
} from "~/lib/yard-inventory";
import { getSourceFreshness } from "~/server/ingestion/source-freshness";
import { StateNewArrivals } from "~/server/state-new-arrivals";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";
import { vehicle, yardInventory } from "~/schema";

async function loadYardVehicles(
  source: string,
  code: string,
): Promise<YardVehicle[]> {
  // No ORDER BY: with it, SQLite walks vehicle_recent_idx across every live
  // vehicle in the country. Without it, vehicle_location_code_idx reads only
  // this yard's rows, which sort cheaply here.
  const rows = await db
    .select({
      vin: vehicle.vin,
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
    .where(
      and(
        eq(vehicle.locationCode, code),
        eq(vehicle.source, source),
        isNull(vehicle.missingSinceAt),
      ),
    );
  return YardInventory.sort(
    rows.map(({ firstSeenAt, observedArrivalAt, ...row }) =>
      YardInventory.vehicle({
        ...row,
        firstSeenAt: firstSeenAt.getTime(),
        observedArrivalAt: observedArrivalAt?.getTime() ?? null,
      }),
    ),
  );
}

/**
 * One read of a yard's live vehicles per render. A whole large yard is over
 * the 2 MB Next.js data-cache limit (Stricker's 12k vehicles are 5.4 MB), so
 * the entries below cache it in pieces; on a miss they share this read.
 */
const readYardVehicles = cache(loadYardVehicles);

/** A yard's count, makes and arrivals. Refreshed with the daily pass. */
const getYardSummary = cacheInventory(
  async (source: string, code: string): Promise<YardSummary> =>
    YardInventory.summary(await readYardVehicles(source, code)),
  ["yard-summary-v2"],
);

/** A slice of a yard's vehicles and the fingerprint of the read it came from. */
type YardSlice = { fingerprint: string; vehicles: YardVehicle[] };

/**
 * Slice `index` of a yard's live vehicles, newest first. A yard's pages are
 * each one slice. Make pages filter all of them: per-make entries built from
 * these would nest one unstable_cache in another, and Next.js skips the cache
 * for the inner call, so every miss would read the whole yard again.
 */
const getYardSlice = cacheInventory(
  async (source: string, code: string, index: number): Promise<YardSlice> => {
    const vehicles = await readYardVehicles(source, code);
    return {
      fingerprint: YardInventory.fingerprint(vehicles),
      vehicles: YardInventory.slice(vehicles, index),
    };
  },
  ["yard-vehicle-slice-v3"],
);

/**
 * The summary and a list read together, so counts and rows agree. Cached
 * entries are written at different times, and ingestion writes rows before
 * it invalidates the cache, so a slice can come from another read than the
 * summary, even one with as many vehicles. Then this render reads the yard
 * afresh.
 */
type YardRead<Data> = { summary: YardSummary; data: Data };

async function freshYard(
  source: string,
  code: string,
): Promise<YardRead<YardVehicle[]>> {
  const vehicles = await readYardVehicles(source, code);
  return { summary: YardInventory.summary(vehicles), data: vehicles };
}

/** Every live vehicle of a yard, newest first, from its cached slices. */
const getAllYardVehicles = cache(
  async (
    source: string,
    code: string,
    summary: YardSummary,
  ): Promise<YardRead<YardVehicle[]>> => {
    const slices = await Promise.all(
      Array.from(
        { length: YardInventory.sliceCount(summary.total) },
        (_, index) => getYardSlice(source, code, index),
      ),
    );
    return slices.every((slice) => slice.fingerprint === summary.fingerprint)
      ? { summary, data: slices.flatMap((slice) => slice.vehicles) }
      : freshYard(source, code);
  },
);

/** Which vehicles of a yard a page lists: all of them, or one make's. */
export type YardScope = { kind: "yard" } | { kind: "make"; key: string };

/**
 * Page `page` of a yard's vehicles in `scope`, newest first (null past the
 * last page), with the summary that agrees with it. A yard page reads only
 * the cached slice that holds it.
 */
export async function getYardVehiclePage(
  yard: Pick<RoutedYard, "source" | "code">,
  summary: YardSummary,
  scope: YardScope,
  page: number,
): Promise<YardRead<YardInventoryPage | null>> {
  if (scope.kind === "make") {
    const read = await getYardMakeVehicles(yard, summary, scope.key);
    return { ...read, data: YardInventory.page(read.data, page) };
  }
  const range = YardInventory.pageRange(summary.total, page);
  if (!range) return { summary, data: null };
  // An empty yard has an empty first page; there is no slice to read.
  if (summary.total === 0) return { summary, data: { ...range, vehicles: [] } };
  const index = YardInventory.sliceIndex(range);
  const slice = await getYardSlice(yard.source, yard.code, index);
  if (slice.fingerprint === summary.fingerprint) {
    return {
      summary,
      data: YardInventory.pageInSlice(slice.vehicles, index, range),
    };
  }
  const fresh = await freshYard(yard.source, yard.code);
  return { ...fresh, data: YardInventory.page(fresh.data, page) };
}

/** Every vehicle of one make at a yard, by make key, newest first. */
export async function getYardMakeVehicles(
  yard: Pick<RoutedYard, "source" | "code">,
  summary: YardSummary,
  makeKey: string,
): Promise<YardRead<YardVehicle[]>> {
  const read = await getAllYardVehicles(yard.source, yard.code, summary);
  return {
    ...read,
    data: read.data.filter(
      (vehicle) => VehicleName.makeKey(vehicle.make) === makeKey,
    ),
  };
}

async function loadSourcePublishedAt(): Promise<
  Partial<Record<IngestionSource, string>>
> {
  const freshness = await getSourceFreshness(new Date());
  const published: Partial<Record<IngestionSource, string>> = {};
  for (const { source, lastPublishedAt } of freshness) {
    if (
      isIngestionSource(source) &&
      !isRetiredIngestionSource(source) &&
      lastPublishedAt !== null
    ) {
      published[source] = new Date(lastPublishedAt).toISOString();
    }
  }
  return published;
}

/**
 * When each source last published accepted inventory, within the last
 * SOURCE_FRESHNESS_LOOKBACK_DAYS. A missing source has not published in that
 * window, so it is hidden from the site.
 */
export const getSourcePublishedAt = cacheInventory(loadSourcePublishedAt, [
  "active-source-published-at-v3",
  ...RETIRED_INGESTION_SOURCES,
]);

/**
 * Last accepted publication per yard, including stale dates for sitemap lastmod.
 * Existing yards are filled by their first accepted publication after 0021.
 * Until then they stay unknown: a source date could describe a partial scrape
 * that preserved this yard, and summary updated_at also advances on rebuilds.
 */
export const getYardPublishedAt = cacheInventory(async (): Promise<
  Readonly<Record<string, string>>
> => {
  const rows = await db
    .select({
      source: yardInventory.source,
      code: yardInventory.locationCode,
      at: yardInventory.lastPublishedAt,
    })
    .from(yardInventory);
  return Object.fromEntries(
    rows.flatMap(({ source, code, at }) =>
      at ? [[`${source}:${code}`, at.toISOString()]] : [],
    ),
  );
}, ["yard-published-at-v1"]);

/**
 * New arrivals per state, from the summary ingestion keeps with each publish:
 * one small cached query serves every state page, at build and on refresh.
 */
const getCachedStateNewCounts = cacheInventory(
  (hiddenList: readonly string[]) =>
    StateNewArrivals.counts(
      db,
      HiddenSources.of(hiddenList),
      new Date().toISOString(),
    ),
  ["state-new-counts-v1", ...RETIRED_INGESTION_SOURCES],
);

/** New arrivals in a state; the hidden list keys the cache entry. */
export async function getRegionNewCount(stateAbbr: string): Promise<number> {
  const counts = await getCachedStateNewCounts((await getHiddenSources()).list);
  return counts[stateAbbr] ?? 0;
}

/** Every yard with live inventory, with its page path. */
export const getYardDirectory = cache(async () => {
  const { yards } = await getHomepageInventory();
  return yards;
});

export type DirectoryYard = Awaited<
  ReturnType<typeof getYardDirectory>
>[number];

/** A yard that has a page, with its path known to be present. */
export type RoutedYard = DirectoryYard & { path: YardPath };

function isRouted(yard: DirectoryYard): yard is RoutedYard {
  return yard.path !== null;
}

/** The directory's yards that have a page. */
export function routedYards(yards: readonly DirectoryYard[]): RoutedYard[] {
  return yards.filter(isRouted);
}

/** Every yard that has a page. */
export const getRoutedYards = cache(
  async (): Promise<RoutedYard[]> => routedYards(await getYardDirectory()),
);

/** Brands with more than one yard, largest first. */
export const getChains = cache(
  async (): Promise<Chain<RoutedYard>[]> =>
    YardBrand.chains(await getRoutedYards()),
);

/** The chain at /chains/{slug}, if there is one. */
export const findChain = cache(
  async (slug: string): Promise<Chain<RoutedYard> | null> =>
    (await getChains()).find((chain) => chain.slug === slug) ?? null,
);

/**
 * When the most recently published of these yards' sources published, or
 * null when none has published in the freshness window.
 */
export async function latestPublishedAt(
  yards: readonly { source: string }[],
): Promise<string | null> {
  const publishedAt = await getSourcePublishedAt();
  return yards.reduce<string | null>((latest, yard) => {
    const date = isIngestionSource(yard.source)
      ? publishedAt[yard.source]
      : undefined;
    return date && (!latest || date > latest) ? date : latest;
  }, null);
}

export type { InventoryFreshness };

/**
 * How current these yards' inventory is. A page that lists several sources
 * says how many are current instead of quoting only the newest date.
 */
export async function inventoryFreshness(
  yards: readonly { source: string }[],
): Promise<InventoryFreshness> {
  return InventoryStaleness.coverage(
    yards,
    await getSourcePublishedAt(),
    Date.now(),
  );
}

/**
 * When every source and yard last had an accepted publication, for the
 * "Last checked" labels on listings. Both reads are cached with the daily
 * inventory.
 */
export async function getInventoryCheckDates(): Promise<InventoryCheckDates> {
  const [sources, yards] = await Promise.all([
    getSourcePublishedAt(),
    getYardPublishedAt(),
  ]);
  return { sources, yards };
}

/** The region for a URL segment and its yards, or null if it has none. */
export const findRegionYards = cache(async (regionSlug: string) => {
  const region = Region.fromSlug(regionSlug);
  if (!region) return null;
  const yards = (await getRoutedYards()).filter(
    (yard) => yard.path.region.slug === region.slug,
  );
  return yards.length > 0 ? { region, yards } : null;
});

const NEARBY_YARDS = 6;

/**
 * Everything a yard's inventory pages show, or null when no yard lives at
 * /junkyards/{regionSlug}/{yardSlug}.
 */
export const getYardPageData = cache(
  async (regionSlug: string, yardSlug: string) => {
    const yard = await findYard(regionSlug, yardSlug);
    if (!yard) return null;
    const [summary, checkDates, routed, chains] = await Promise.all([
      getYardSummary(yard.source, yard.code),
      getInventoryCheckDates(),
      getRoutedYards(),
      getChains(),
    ]);
    const chain = chains.find((candidate) =>
      candidate.yards.some((member) => member.path.href === yard.path.href),
    );
    const nearby = routed
      .filter((other) => other.path.href !== yard.path.href)
      .map((other) => ({
        yard: other,
        miles: calculateDistance(yard.lat, yard.lng, other.lat, other.lng),
      }))
      .sort((a, b) => a.miles - b.miles)
      .slice(0, NEARBY_YARDS);
    return {
      yard,
      summary,
      publishedAt: checkDates.yards[`${yard.source}:${yard.code}`] ?? null,
      checkedAt: InventoryStaleness.checkedAt(
        checkDates,
        yard.source,
        yard.code,
      ),
      nearby,
      chain: chain
        ? { name: chain.name, href: chain.href, yards: chain.yards.length }
        : null,
    };
  },
);

/** The yard at /junkyards/{regionSlug}/{yardSlug}, if one lives there. */
export const findYard = cache(
  async (regionSlug: string, yardSlug: string): Promise<RoutedYard | null> =>
    (await getRoutedYards()).find(
      (yard) =>
        yard.path.region.slug === regionSlug && yard.path.slug === yardSlug,
    ) ?? null,
);
