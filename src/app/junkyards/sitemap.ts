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
 * /junkyards/sitemap.xml: each region and each yard's first inventory page.
 * A yard's lastmod is when its source last published. A region's is the
 * latest publish of any source: a removed yard also changes the region page,
 * and its source's last date leaves with it. The directory itself, outside
 * this sitemap's /junkyards/ scope, is in the root sitemap.
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

  const newest = latest(Object.values(publishedAt));
  const regions = new Set(
    yards.map((yard) => YardPath.regionHref(yard.path.region)),
  );

  return [
    ...[...regions].map((href) => entry(href, newest)),
    ...yards.map((yard) => entry(yard.path.href, yardPublishedAt(yard))),
  ];
}
