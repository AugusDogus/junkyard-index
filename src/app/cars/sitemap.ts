import type { MetadataRoute } from "next";
import { env } from "~/env";
import { MakeInventory } from "~/lib/make-inventory";
import { getMakePageData, getMakes } from "~/server/vehicle-models";
import { getSourcePublishedAt } from "~/server/yard-inventory";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;

/**
 * /cars/sitemap.xml: make and model pages with enough vehicles to be indexed.
 * Their counts change whenever any yard publishes, so lastmod is the latest
 * publish of any source. The /cars index is in the root sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [makes, publishedAt] = await Promise.all([
    getMakes(),
    getSourcePublishedAt(),
  ]);
  const lastModified = Object.values(publishedAt).reduce<string | undefined>(
    (max, date) => (date && (!max || date > max) ? date : max),
    undefined,
  );
  const indexed = makes.filter((make) => MakeInventory.indexable(make));
  const pages = await Promise.all(
    indexed.map(async (make) => {
      const data = await getMakePageData(make.slug);
      const models = (data?.models ?? []).filter((model) =>
        MakeInventory.indexable(model),
      );
      return [make.href, ...models.map((model) => model.href)];
    }),
  );
  return pages.flat().map((href) => ({
    url: new URL(href, env.NEXT_PUBLIC_APP_URL).toString(),
    ...(lastModified && { lastModified }),
  }));
}
