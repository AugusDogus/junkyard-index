import { Slug } from "./slug";

type BrandedYard = {
  source: string;
  operator: string | null;
  name: string;
  city: string;
};

/** The business a yard trades as, such as "Pick-n-Pull". */
export type YardBrand = { slug: string; name: string };

/** A brand with more than one yard we track. */
export type Chain<Yard> = YardBrand & { href: string; yards: Yard[] };

// A yard listed under its location ("Atlanta, GA") until its metadata loads.
const PLACE_NAME = /^[^,]+, [A-Z]{2}$/;

/**
 * The yard's brand: fixed for sources that carry one brand, else the
 * operator, else the yard's name without its location ("Paul's - Gary" and
 * "Foss Wilson" become "Paul's" and "Foss"). Null when the name is only a
 * place, which says nothing about who runs the yard.
 */
function brandName(yard: BrandedYard): string | null {
  if (yard.source === "pyp") return "LKQ Pick Your Part";
  if (yard.source === "row52" && /^pick-?n-?pull\b/i.test(yard.name)) {
    return "Pick-n-Pull";
  }
  if (yard.operator?.trim()) return yard.operator.trim();
  const [head, ...location] = yard.name.split(" - ");
  if (head?.trim() && location.length > 0) return head.trim();
  const city = yard.city.trim();
  const name = yard.name.trim();
  if (!name || PLACE_NAME.test(name)) return null;
  if (city && name.toLowerCase().endsWith(` ${city.toLowerCase()}`)) {
    return name.slice(0, -city.length).trim() || null;
  }
  return name;
}

function href(slug: string): string {
  return `/chains/${slug}`;
}

export const YardBrand = {
  href,

  of(yard: BrandedYard): YardBrand | null {
    const name = brandName(yard);
    const slug = name && Slug.from(name);
    return name && slug ? { slug, name } : null;
  },

  /**
   * Brands with at least two yards, largest first. Spellings of one brand
   * ("Paul's", "Pauls") share a slug; the most common spelling names it.
   * Yards without a known brand join no chain.
   */
  chains<Yard extends BrandedYard>(yards: readonly Yard[]): Chain<Yard>[] {
    type Group = { yards: Yard[]; spellings: Map<string, number> };
    const groups = new Map<string, Group>();
    for (const yard of yards) {
      const brand = YardBrand.of(yard);
      if (!brand) continue;
      const { slug, name } = brand;
      const group: Group = groups.get(slug) ?? {
        yards: [],
        spellings: new Map(),
      };
      group.yards.push(yard);
      group.spellings.set(name, (group.spellings.get(name) ?? 0) + 1);
      groups.set(slug, group);
    }
    return [...groups.entries()]
      .filter(([, group]) => group.yards.length > 1)
      .map(([slug, group]) => {
        const [name = slug] =
          [...group.spellings.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
        return { slug, name, href: href(slug), yards: group.yards };
      })
      .sort(
        (a, b) =>
          b.yards.length - a.yards.length || a.name.localeCompare(b.name),
      );
  },
} as const;
