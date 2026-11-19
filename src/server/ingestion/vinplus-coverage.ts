import type { parseVinplusAnalytics } from "./vinplus-protocol";

export type VinplusCoverage = { unreachable: number; warnings: string[] };
export const VinplusCoverage = {
  /** The allowance belongs to each physical yard, using its advertised total.
   * Unknown identities remain counts, never rejected or fabricated VINs.
   *
   * The year distribution lags live search by up to about a day (US Auto
   * Supply, 2026-11-18 and 2026-11-19: new 1976 and 1999 arrivals were searchable
   * before the distribution listed them). Records beyond an advertised year
   * count are complete, tenant-validated search results, so they are kept and
   * reported. They never offset another year's deficit: unreachable counts sum
   * per-year shortfalls only. Silent 100-record truncation is guarded by the
   * range reader, not here. */
  fromCounts(
    yardName: string,
    advertised: ReturnType<typeof parseVinplusAnalytics>,
    observed: ReadonlyMap<number, number>,
  ): VinplusCoverage {
    const published = new Map(
      advertised.years.map((row) => [row.year, row.count]),
    );
    const surplus = [...observed]
      .sort(([a], [b]) => a - b)
      .flatMap(([year, count]) => {
        const expected = published.get(year) ?? 0;
        return count > expected
          ? [{ year, extra: count - expected, count, expected }]
          : [];
      });
    const deficits = advertised.years.flatMap(({ year, count }) => {
      const missing = count - (observed.get(year) ?? 0);
      return missing > 0 ? [{ year, missing }] : [];
    });
    const unreachable = deficits.reduce((sum, row) => sum + row.missing, 0);
    const detail = `${yardName}: ${unreachable} unreachable advertised vehicles / ${advertised.count} (${((100 * unreachable) / advertised.count).toFixed(6)}%); year deficits: ${deficits.map((row) => `${row.year}: ${row.missing}`).join(", ")}`;
    if (unreachable * 100 > advertised.count)
      throw new Error(
        `${detail}; exceeds the 1% limit. Prior inventory is preserved; inspect the saved enumeration controls`,
      );
    return {
      unreachable,
      warnings: [
        ...(unreachable
          ? [
              `${detail}; within the 1% limit. No identities are asserted for unreachable vehicles.`,
            ]
          : []),
        ...(surplus.length
          ? [
              `${yardName}: ${surplus.reduce((sum, row) => sum + row.extra, 0)} searchable vehicles exceed the lagging year distribution (${surplus.map((row) => `${row.year}: ${row.count} of ${row.expected} advertised`).join(", ")}); they are kept and do not offset deficits.`,
            ]
          : []),
      ],
    };
  },
} as const;
