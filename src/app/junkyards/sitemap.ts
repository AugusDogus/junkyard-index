import type { MetadataRoute } from "next";
import { env } from "~/env";
import { YardSitemap } from "~/lib/yard-sitemap";
import {
  getDormantYards,
  getRoutedYards,
  getYardPublishedAt,
} from "~/server/yard-inventory";

export const revalidate = 86400;

/**
 * Region and yard first pages, with each yard's own last accepted
 * publication, and the first pages of yards that keep theirs while they show
 * no vehicles. Yard-make pages are in /junkyards/sitemap-makes.xml.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [yards, publishedAt, dormant] = await Promise.all([
    getRoutedYards(),
    getYardPublishedAt(),
    getDormantYards(),
  ]);
  return [
    ...YardSitemap.hubs(env.NEXT_PUBLIC_APP_URL, yards, publishedAt),
    ...YardSitemap.dormant(env.NEXT_PUBLIC_APP_URL, dormant),
  ];
}
