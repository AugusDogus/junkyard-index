import type { MetadataRoute } from "next";
import { env } from "~/env";
import { getChains, latestPublishedAt } from "~/server/yard-inventory";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;

/**
 * /chains/sitemap.xml: each chain's hub, with lastmod when the chain's
 * sources last published. The /chains index, outside this sitemap's
 * /chains/ scope, is in the root sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const chains = await getChains();
  return Promise.all(
    chains.map(async (chain) => {
      const lastModified = await latestPublishedAt(chain.yards);
      return {
        url: new URL(chain.href, env.NEXT_PUBLIC_APP_URL).toString(),
        ...(lastModified && { lastModified }),
      };
    }),
  );
}
