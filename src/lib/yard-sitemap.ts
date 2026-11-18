import type { MetadataRoute } from "next";
import type { YardMakeInventory } from "./yard-make-inventory";
import { YardPath } from "./yard-path";

type Yard = { source: string; code: string; path: YardPath };

export const YardSitemap = {
  entries(
    baseUrl: string,
    yards: readonly Yard[],
    publications: Readonly<Record<string, string>>,
    makes: readonly YardMakeInventory[],
  ): MetadataRoute.Sitemap {
    const publishedAt = (yard: Yard) => publications[YardPath.key(yard)];
    const entry = (href: string, lastModified: string | undefined) => ({
      url: new URL(href, baseUrl).toString(),
      ...(lastModified && { lastModified }),
    });
    const byKey = new Map(yards.map((yard) => [YardPath.key(yard), yard]));
    return [
      ...YardPath.byRegion(yards).map(({ region, yards }) => {
        const newest = yards
          .map(publishedAt)
          .reduce<string | undefined>(
            (latest, date) =>
              date && (!latest || date > latest) ? date : latest,
            undefined,
          );
        return entry(YardPath.regionHref(region), newest);
      }),
      ...yards.map((yard) => entry(yard.path.href, publishedAt(yard))),
      ...makes.flatMap((make) => {
        const yard = byKey.get(YardPath.key(make));
        return yard
          ? [entry(YardPath.makeHref(yard.path, make.slug), publishedAt(yard))]
          : [];
      }),
    ];
  },
} as const;
