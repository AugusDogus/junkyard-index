import type { parseVinplusAnalytics } from "./vinplus-protocol";

export type VinplusCoverage = { unreachable: number; warnings: string[] };
export const VinplusCoverage = {
  /** The allowance belongs to each physical yard, using its advertised total.
   * Unknown identities remain counts, never rejected or fabricated VINs. */
  fromCounts(
    yardName: string,
    advertised: ReturnType<typeof parseVinplusAnalytics>,
    observed: ReadonlyMap<number, number>,
  ): VinplusCoverage {
    const published = new Map(
      advertised.years.map((row) => [row.year, row.count]),
    );
    for (const [year, count] of observed) {
      const expected = published.get(year);
      if (expected === undefined)
        throw new Error(
          `${yardName}: inventory contains unadvertised year ${year}`,
        );
      if (count > expected)
        throw new Error(
          `${yardName}: ${year} has ${count} records, which exceeds its advertised year count ${expected}`,
        );
    }
    const deficits = advertised.years.flatMap(({ year, count }) => {
      const missing = count - (observed.get(year) ?? 0);
      return missing ? [`${year}: ${missing}`] : [];
    });
    const recovered = [...observed.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    const unreachable = advertised.count - recovered;
    const detail = `${yardName}: ${unreachable} unreachable advertised vehicles / ${advertised.count} (${((100 * unreachable) / advertised.count).toFixed(6)}%); year deficits: ${deficits.join(", ")}`;
    if (unreachable * 100 > advertised.count)
      throw new Error(
        `${detail}; exceeds the 1% limit. Prior inventory is preserved; inspect the saved enumeration controls`,
      );
    return {
      unreachable,
      warnings: unreachable
        ? [
            `${detail}; within the 1% limit. No identities are asserted for unreachable vehicles.`,
          ]
        : [],
    };
  },
} as const;
