import { Region } from "./region";
import { Slug } from "./slug";

type YardIdentity = {
  source: string;
  code: string;
  name: string;
  city: string;
  state: string;
};

/** Where a yard's public inventory pages live: /junkyards/{region}/{slug}. */
export type YardPath = {
  region: Region;
  slug: string;
  href: string;
};

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(-6);
}

function key(yard: { source: string; code: string }): string {
  return `${yard.source}:${yard.code}`;
}

function regionHref(region: Region): string {
  return `/junkyards/${region.slug}`;
}

/**
 * The yard's name, plus its city when the name doesn't already say it. New
 * yards elsewhere can't change it. A yard with the same name and city in the
 * same region would, since `assign` then hashes both slugs.
 */
function baseSlug(yard: YardIdentity): string {
  const name = Slug.from(yard.name) || "yard";
  const city = Slug.from(yard.city);
  return !city || `-${name}-`.includes(`-${city}-`) ? name : `${name}-${city}`;
}

export const YardPath = {
  key,
  regionHref,
  /** Yards grouped by region, regions in alphabetical order. */
  byRegion<Yard extends { path: YardPath }>(
    yards: readonly Yard[],
  ): { region: Region; yards: Yard[] }[] {
    const groups = new Map<string, { region: Region; yards: Yard[] }>();
    for (const yard of yards) {
      const { region } = yard.path;
      const group = groups.get(region.slug) ?? { region, yards: [] };
      group.yards.push(yard);
      groups.set(region.slug, group);
    }
    return [...groups.values()].sort((a, b) =>
      a.region.name.localeCompare(b.region.name),
    );
  },
  /** The URL of page `page` (1-based) of a yard's inventory. */
  pageHref(path: YardPath, page: number): string {
    return page <= 1 ? path.href : `${path.href}/page/${page}`;
  },
  /**
   * Gives every yard in a recognized region a slug from its name and city.
   * Yards whose slugs still collide within a region add a stable hash of
   * their source and code. Yards outside known regions get no path.
   */
  assign(yards: readonly YardIdentity[]): Map<string, YardPath> {
    const candidates = yards.flatMap((yard) => {
      const region = Region.fromAbbr(yard.state);
      return region ? [{ yard, region, slug: baseSlug(yard) }] : [];
    });
    const uses = new Map<string, number>();
    for (const { region, slug } of candidates) {
      const href = `${regionHref(region)}/${slug}`;
      uses.set(href, (uses.get(href) ?? 0) + 1);
    }

    const paths = new Map<string, YardPath>();
    for (const { yard, region, slug: base } of candidates) {
      const shared = (uses.get(`${regionHref(region)}/${base}`) ?? 0) > 1;
      const slug = shared ? `${base}-${fnv1a(key(yard))}` : base;
      paths.set(key(yard), {
        region,
        slug,
        href: `${regionHref(region)}/${slug}`,
      });
    }
    return paths;
  },
} as const;
