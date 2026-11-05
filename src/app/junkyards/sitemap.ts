import type { MetadataRoute } from "next";
import { env } from "~/env";
import { isIngestionSource } from "~/lib/ingestion-source";
import { YardPath } from "~/lib/yard-path";
import {
  getSourcePublishedAt,
  getYardDirectory,
  type RoutedYard,
} from "~/server/yard-inventory";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;

function latest(dates: readonly (string | undefined)[]): string | undefined {
  return dates.reduce<string | undefined>(
    (max, date) => (date && (!max || date > max) ? date : max),
    undefined,
  );
}

/**
 * /junkyards/sitemap.xml: the directory, each region, and each yard's first
 * inventory page. lastmod is when the yard's source last published, so it
 * only moves when that inventory could have changed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [directory, publishedAt] = await Promise.all([
    getYardDirectory(),
    getSourcePublishedAt(),
  ]);
  const yards = directory.filter(
    (yard): yard is RoutedYard => yard.path !== null,
  );
  const yardPublishedAt = (yard: RoutedYard) =>
    isIngestionSource(yard.source) ? publishedAt[yard.source] : undefined;
  const url = (href: string) =>
    new URL(href, env.NEXT_PUBLIC_APP_URL).toString();
  const entry = (href: string, lastModified: string | undefined) => ({
    url: url(href),
    ...(lastModified && { lastModified }),
  });

  const regions = new Map<string, { href: string; dates: string[] }>();
  for (const yard of yards) {
    const href = YardPath.regionHref(yard.path.region);
    const region = regions.get(href) ?? { href, dates: [] };
    const date = yardPublishedAt(yard);
    if (date) region.dates.push(date);
    regions.set(href, region);
  }

  return [
    entry("/junkyards", latest(yards.map(yardPublishedAt))),
    ...[...regions.values()].map(({ href, dates }) =>
      entry(href, latest(dates)),
    ),
    ...yards.map((yard) => entry(yard.path.href, yardPublishedAt(yard))),
  ];
}
