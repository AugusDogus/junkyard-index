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
import {
  isIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import { YardInventory, type YardVehicle } from "~/lib/yard-inventory";
import { getDurableSourceFreshness } from "~/server/ingestion/durable-ingestion";
import { vehicle } from "~/schema";

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
    .where(
      and(
        eq(vehicle.locationCode, code),
        eq(vehicle.source, source),
        isNull(vehicle.missingSinceAt),
      ),
    );
  return YardInventory.sort(
    rows.map(({ firstSeenAt, ...row }) =>
      YardInventory.vehicle({ ...row, firstSeenAt: firstSeenAt.getTime() }),
    ),
  );
}

/** A yard's live vehicles, newest first. Refreshed with the daily pass. */
export const getYardVehicles = cacheInventory(loadYardVehicles, [
  "yard-vehicles-v1",
]);

async function loadSourcePublishedAt(): Promise<
  Partial<Record<IngestionSource, string>>
> {
  const freshness = await getDurableSourceFreshness(new Date());
  const published: Partial<Record<IngestionSource, string>> = {};
  for (const { source, lastPublishedAt } of freshness) {
    if (isIngestionSource(source) && lastPublishedAt !== null) {
      published[source] = new Date(lastPublishedAt).toISOString();
    }
  }
  return published;
}

/**
 * When each source last published accepted inventory, within the last three
 * days. A missing source has not published in that window.
 */
export const getSourcePublishedAt = cacheInventory(loadSourcePublishedAt, [
  "source-published-at-v1",
]);

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
    const [vehicles, publishedAt, routed, chains] = await Promise.all([
      getYardVehicles(yard.source, yard.code),
      getSourcePublishedAt(),
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
      vehicles,
      makes: YardInventory.makeCounts(vehicles),
      publishedAt: isIngestionSource(yard.source)
        ? (publishedAt[yard.source] ?? null)
        : null,
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
