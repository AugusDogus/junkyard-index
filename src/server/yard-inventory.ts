import "server-only";

import { cache } from "react";
import { db } from "~/lib/db";
import { Region } from "~/lib/region";
import { calculateDistance } from "~/lib/utils";
import { YardBrand, type Chain } from "~/lib/yard-brand";
import type { YardPath } from "~/lib/yard-path";
import { getDirectoryYards } from "~/lib/homepage-inventory";
import { cacheInventory, cacheYardInventory } from "~/lib/inventory-cache";
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
import {
  YardInventory,
  type YardInventoryPage,
  type YardSummary,
  type YardVehicle,
} from "~/lib/yard-inventory";
import { getSourceFreshness } from "~/server/ingestion/source-freshness";
import { StateNewArrivals } from "~/server/state-new-arrivals";
import { cacheShownInventory } from "~/server/source-control/hidden-sources-loader";
import { yardCheck, yardInventory } from "~/schema";
import { YardCheck } from "~/lib/yard-check";
import { YardSummaryStore } from "./yard-summary-store";
import { YardVehicles } from "./yard-vehicles";

function loadYardVehicles(source: string, code: string) {
  return YardVehicles.all(db, source, code);
}

/**
 * One read of a yard's live vehicles per render. A whole large yard is over
 * the 2 MB Next.js data-cache limit (Stricker's 12k vehicles are 5.4 MB), so
 * the entries below cache it in pieces; on a miss they share this read.
 */
const readYardVehicles = cache(loadYardVehicles);

/**
 * A yard's count, makes and arrivals. Under its yard's tag, so it is read
 * again only when the yard's vehicles change (see cacheYardInventory).
 */
const getYardSummary = cacheYardInventory(
  async (source: string, code: string): Promise<YardSummary> => {
    // Deploys and each refresh store every yard's summary: reading it back
    // costs one row. Only a yard with none stored (first published since the
    // last refresh) is read whole.
    const stored = await YardSummaryStore.read(db, source, code);
    if (stored) return stored;
    const read = await readYardVehicles(source, code);
    return YardInventory.summary(read.vehicles, read.rawMakes);
  },
  ["yard-summary-v5"],
);

/** A slice of a yard's vehicles and the fingerprint of the read it came from. */
type YardSlice = { fingerprint: string; vehicles: YardVehicle[] };

/** Slice `index` of a yard's live vehicles, newest first. A yard page is one slice. */
const getYardSlice = cacheYardInventory(
  async (source: string, code: string, index: number): Promise<YardSlice> => {
    const { vehicles } = await readYardVehicles(source, code);
    return {
      fingerprint: YardInventory.fingerprint(vehicles),
      vehicles: YardInventory.slice(vehicles, index),
    };
  },
  ["yard-vehicle-slice-v5"],
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
  const read = await readYardVehicles(source, code);
  return {
    summary: YardInventory.summary(read.vehicles, read.rawMakes),
    data: read.vehicles,
  };
}

/** One make's list at a yard and the fingerprint of that list. */
type YardMakeEntry = { fingerprint: string; vehicles: YardVehicle[] };

/**
 * One make's live vehicles at a yard, newest first, read by the raw
 * spellings the yard's summary saw, through vehicle_yard_make_live_idx: a
 * miss reads only the rows the make and model pages show, not the yard. Those
 * pages were most of what crawlers rendered (about 47,000 yard model pages a
 * day in November 2026), and each miss of the old whole-yard slices read
 * 1-12K rows.
 */
const getYardMakeEntry = cacheYardInventory(
  async (
    source: string,
    code: string,
    makeKey: string,
    spellings: readonly string[],
  ): Promise<YardMakeEntry> => {
    const vehicles = await YardVehicles.make(
      db,
      source,
      code,
      makeKey,
      spellings,
    );
    return { fingerprint: YardInventory.fingerprint(vehicles), vehicles };
  },
  ["yard-make-list-v2"],
);

/** Which vehicles of a yard a page lists: all of them, or one make's. */
export type YardScope = { kind: "yard" } | { kind: "make"; key: string };

/**
 * Page `page` of a yard's vehicles in `scope`, newest first (null past the
 * last page), with the summary that agrees with it. A yard page reads only
 * the cached slice that holds it; a make page only its make's list.
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

/**
 * Every vehicle of one make at a yard, by make key, newest first, with a
 * summary that agrees with it. A list read after the summary (ingestion
 * changed the make in between) is shown as read, with the summary's count
 * and arrivals for that make taken from it, so no render reads the yard.
 */
export async function getYardMakeVehicles(
  yard: Pick<RoutedYard, "source" | "code">,
  summary: YardSummary,
  makeKey: string,
): Promise<YardRead<YardVehicle[]>> {
  const list = YardInventory.makeList(summary, makeKey);
  if (!list) return { summary, data: [] };
  const entry = await getYardMakeEntry(
    yard.source,
    yard.code,
    makeKey,
    list.spellings,
  );
  return entry.fingerprint === list.fingerprint
    ? { summary, data: entry.vehicles }
    : {
        summary: YardInventory.withMake(summary, makeKey, entry.vehicles),
        data: entry.vehicles,
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
 * When each yard was last proven checked: the last accepted run that fetched
 * it live (`yard_check`). A blocked, preserved, replayed or unreported yard
 * keeps its earlier date, so its "Last checked" label ages; one never proven
 * fetched is null and reads "Last check unknown". One row per yard, so it
 * stays cheap at build.
 */
export const getYardCheckedAt = cacheInventory(
  async (): Promise<Readonly<Record<string, string | null>>> =>
    YardCheck.checkDates(
      await db
        .select({
          source: yardCheck.source,
          code: yardCheck.locationCode,
          lastCheckedAt: yardCheck.lastCheckedAt,
        })
        .from(yardCheck),
    ),
  ["yard-checked-at-v2"],
);

/**
 * New arrivals per state, from the summary ingestion keeps with each publish:
 * one small cached query serves every state page, at build and on refresh.
 */
const getCachedStateNewCounts = cacheShownInventory(
  (hidden) => StateNewArrivals.counts(db, hidden, new Date().toISOString()),
  ["state-new-counts-v2", ...RETIRED_INGESTION_SOURCES],
);

/** New arrivals in a state, leaving out hidden sources. */
export async function getRegionNewCount(stateAbbr: string): Promise<number> {
  const counts = await getCachedStateNewCounts();
  return counts[stateAbbr] ?? 0;
}

/** Every yard with live inventory, with its page path. */
export const getYardDirectory = cache(getDirectoryYards);

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
 * When every source last had an accepted publication and every yard was last
 * fetched live, for the "Last checked" labels on listings. Both reads are
 * cached with the daily inventory.
 */
export async function getInventoryCheckDates(): Promise<InventoryCheckDates> {
  const [sources, yards] = await Promise.all([
    getSourcePublishedAt(),
    getYardCheckedAt(),
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
      checkUnknown: checkDates.yards[`${yard.source}:${yard.code}`] === null,
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
