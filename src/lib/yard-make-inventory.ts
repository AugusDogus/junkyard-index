import type { MakeEntry, MakeRollupRow } from "./make-inventory";
export const YARD_MAKE_INDEXABLE_MINIMUM = 5;

export type YardMakeInventory = {
  source: string;
  code: string;
  slug: string;
  count: number;
};

export const YardMakeInventory = {
  /** Include every raw model, even when it cannot name a national model page. */
  indexable(
    make: MakeEntry,
    rows: readonly MakeRollupRow[],
  ): YardMakeInventory[] {
    const counts = new Map<string, YardMakeInventory>();
    for (const row of rows) {
      const key = `${row.source}:${row.code}`;
      const previous = counts.get(key);
      counts.set(key, {
        source: row.source,
        code: row.code,
        slug: make.slug,
        count: (previous?.count ?? 0) + row.count,
      });
    }
    return [...counts.values()].filter(
      (entry) => entry.count >= YARD_MAKE_INDEXABLE_MINIMUM,
    );
  },
} as const;
