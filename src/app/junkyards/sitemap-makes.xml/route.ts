import { env } from "~/env";
import { YardSitemap } from "~/lib/yard-sitemap";
import { getYardMakePages } from "~/server/vehicle-models";
import { getRoutedYards, getYardPublishedAt } from "~/server/yard-inventory";

// Built at deploy like the other sitemaps, and rebuilt after each daily
// ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;

/**
 * /junkyards/sitemap-makes.xml: each yard's page for one make, about 86% of
 * the directory's URLs. Kept apart from /junkyards/sitemap.xml so the region
 * and yard hubs there are read first. Next names sitemap.ts files only
 * sitemap.xml, so this one is a route handler.
 */
export async function GET(): Promise<Response> {
  const [yards, publishedAt, makePages] = await Promise.all([
    getRoutedYards(),
    getYardPublishedAt(),
    getYardMakePages(),
  ]);
  return new Response(
    YardSitemap.xml(
      YardSitemap.makes(env.NEXT_PUBLIC_APP_URL, yards, publishedAt, makePages),
    ),
    { headers: { "Content-Type": "application/xml" } },
  );
}
