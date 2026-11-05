import { VehicleName } from "./vehicle-name";

/** Fewer live vehicles than this and a make or model page stays out of search. */
export const INDEXABLE_MINIMUM = 20;

/** A make as one page: every raw spelling providers use for it. */
export type MakeEntry = {
  key: string;
  name: string;
  slug: string;
  href: string;
  rawMakes: string[];
  count: number;
};

/** One model's live vehicles at one yard. */
export type YardModelCount = {
  source: string;
  code: string;
  count: number;
  minYear: number;
  maxYear: number;
};

export type ModelEntry = {
  key: string;
  name: string;
  slug: string;
  href: string;
  rawModels: string[];
  count: number;
  minYear: number;
  maxYear: number;
  /** Yards holding this model, most first. */
  yards: YardModelCount[];
};

/** A row of the per-make rollup: one raw spelling at one yard. */
export type MakeRollupRow = {
  source: string;
  code: string;
  make: string;
  model: string;
  count: number;
  minYear: number;
  maxYear: number;
};

function makeHref(slug: string): string {
  return `/cars/${slug}`;
}

function byCount<Entry extends { count: number; name: string }>(
  a: Entry,
  b: Entry,
): number {
  return b.count - a.count || a.name.localeCompare(b.name);
}

export const MakeInventory = {
  makeHref,

  /** Makes from live counts per raw make, most vehicles first. */
  makes(rows: readonly { make: string; count: number }[]): MakeEntry[] {
    const groups = new Map<string, Map<string, number>>();
    for (const { make, count } of rows) {
      const key = VehicleName.makeKey(make);
      if (!key) continue;
      const spellings = groups.get(key) ?? new Map<string, number>();
      spellings.set(make, (spellings.get(make) ?? 0) + count);
      groups.set(key, spellings);
    }
    return [...groups.entries()]
      .flatMap(([key, spellings]) => {
        const name = VehicleName.preferredSpelling(spellings);
        const slug = VehicleName.slug(name);
        if (!slug) return [];
        return [
          {
            key,
            name,
            slug,
            href: makeHref(slug),
            rawMakes: [...spellings.keys()].sort(),
            count: [...spellings.values()].reduce((sum, n) => sum + n, 0),
          },
        ];
      })
      .sort(byCount);
  },

  /** One make's models from its rollup, most vehicles first. */
  models(make: MakeEntry, rows: readonly MakeRollupRow[]): ModelEntry[] {
    type Group = {
      spellings: Map<string, number>;
      /** Model values as stored, for querying this model's vehicles. */
      raw: Set<string>;
      yards: Map<string, YardModelCount>;
    };
    const groups = new Map<string, Group>();
    for (const row of rows) {
      const key = VehicleName.modelKey(row.make, row.model);
      if (!key) continue;
      const group: Group = groups.get(key) ?? {
        spellings: new Map(),
        raw: new Set(),
        yards: new Map(),
      };
      // Names and URLs use the spelling without a repeated make.
      const name = VehicleName.modelName(row.make, row.model);
      group.spellings.set(name, (group.spellings.get(name) ?? 0) + row.count);
      group.raw.add(row.model);
      const yardKey = `${row.source}:${row.code}`;
      const yard = group.yards.get(yardKey);
      group.yards.set(
        yardKey,
        yard
          ? {
              ...yard,
              count: yard.count + row.count,
              minYear: Math.min(yard.minYear, row.minYear),
              maxYear: Math.max(yard.maxYear, row.maxYear),
            }
          : {
              source: row.source,
              code: row.code,
              count: row.count,
              minYear: row.minYear,
              maxYear: row.maxYear,
            },
      );
      groups.set(key, group);
    }
    return [...groups.entries()]
      .flatMap(([key, group]) => {
        const name = VehicleName.preferredSpelling(group.spellings);
        const slug = VehicleName.slug(name);
        if (!slug) return [];
        const yards = [...group.yards.values()].sort(
          (a, b) => b.count - a.count || a.code.localeCompare(b.code),
        );
        return [
          {
            key,
            name,
            slug,
            href: `${make.href}/${slug}`,
            rawModels: [...group.raw].sort(),
            count: yards.reduce((sum, yard) => sum + yard.count, 0),
            minYear: Math.min(...yards.map((yard) => yard.minYear)),
            maxYear: Math.max(...yards.map((yard) => yard.maxYear)),
            yards,
          },
        ];
      })
      .sort(byCount);
  },

  indexable(entry: { count: number }): boolean {
    return entry.count >= INDEXABLE_MINIMUM;
  },
} as const;
