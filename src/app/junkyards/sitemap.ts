import type { MetadataRoute } from "next";
import { env } from "~/env";
import { YardSitemap } from "~/lib/yard-sitemap";
import { getYardMakePages } from "~/server/vehicle-models";
import { getRoutedYards, getYardPublishedAt } from "~/server/yard-inventory";

export const revalidate = 86400;

/** First pages only, with each yard's own last accepted publication. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [yards, publishedAt, makePages] = await Promise.all([
    getRoutedYards(),
    getYardPublishedAt(),
    getYardMakePages(),
  ]);
  return YardSitemap.entries(
    env.NEXT_PUBLIC_APP_URL,
    yards,
    publishedAt,
    makePages,
  );
}
