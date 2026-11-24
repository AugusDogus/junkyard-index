import type { YardMakeInventory } from "./yard-make-inventory";
import { YardPath } from "./yard-path";

type Yard = { source: string; code: string; path: YardPath };
type Publications = Readonly<Record<string, string>>;

/** One sitemap URL; lastmod is left out when no publication date is known. */
export type SitemapEntry = { url: string; lastModified?: string };

function newest(
  yards: readonly { source: string; code: string }[],
  publications: Publications,
): string | undefined {
  return yards
    .map((yard) => publications[YardPath.key(yard)])
    .reduce<string | undefined>(
      (latest, date) => (date && (!latest || date > latest) ? date : latest),
      undefined,
    );
}

function entry(
  baseUrl: string,
  href: string,
  lastModified: string | undefined,
): SitemapEntry {
  return {
    url: new URL(href, baseUrl).toString(),
    ...(lastModified && { lastModified }),
  };
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/**
 * Directory sitemap entries, dated by each yard's own last accepted
 * publication. Region and yard hubs go in /junkyards/sitemap.xml; the far
 * more numerous yard-make pages get /junkyards/sitemap-makes.xml, so the
 * hubs' sitemap stays small and is read in full first.
 */
export const YardSitemap = {
  hubs(
    baseUrl: string,
    yards: readonly Yard[],
    publications: Publications,
  ): SitemapEntry[] {
    return [
      ...YardPath.byRegion(yards).map(({ region, yards }) =>
        entry(
          baseUrl,
          YardPath.regionHref(region),
          newest(yards, publications),
        ),
      ),
      ...yards.map((yard) =>
        entry(baseUrl, yard.path.href, newest([yard], publications)),
      ),
    ];
  },

  makes(
    baseUrl: string,
    yards: readonly Yard[],
    publications: Publications,
    makes: readonly YardMakeInventory[],
  ): SitemapEntry[] {
    const byKey = new Map(yards.map((yard) => [YardPath.key(yard), yard]));
    return makes.flatMap((make) => {
      const yard = byKey.get(YardPath.key(make));
      return yard
        ? [
            entry(
              baseUrl,
              YardPath.makeHref(yard.path, make.slug),
              newest([yard], publications),
            ),
          ]
        : [];
    });
  },

  /**
   * A chain's lastmod: when its sources last published inside the freshness
   * window, else its most recently published yard, else unknown.
   */
  chainLastModified(
    sourcePublishedAt: string | null,
    yards: readonly { source: string; code: string }[],
    publications: Publications,
  ): string | undefined {
    return sourcePublishedAt ?? newest(yards, publications);
  },

  /** A sitemap urlset in the format Next writes for sitemap.ts files. */
  xml(entries: readonly SitemapEntry[]): string {
    const urls = entries.map(
      ({ url, lastModified }) =>
        `<url>\n<loc>${escapeXml(url)}</loc>\n${
          lastModified ? `<lastmod>${escapeXml(lastModified)}</lastmod>\n` : ""
        }</url>\n`,
    );
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("")}</urlset>\n`;
  },
} as const;
