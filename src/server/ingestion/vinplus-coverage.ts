import { transientRejection } from "./ingestion-validation";
import type { parseVinplusAnalytics } from "./vinplus-protocol";

export type VinplusCoverage = {
  unreachable: number;
  lagging: number;
  warnings: string[];
};
type Shortfall = { year: number; missing: number };
const percent = (part: number, whole: number) =>
  ((100 * part) / whole).toFixed(6);
const listed = (rows: readonly Shortfall[]) =>
  rows.map((row) => `${row.year}: ${row.missing}`).join(", ");
const total = (rows: readonly Shortfall[]) =>
  rows.reduce((sum, row) => sum + row.missing, 0);
export const VinplusCoverage = {
  /** The allowances belong to each physical yard, using its advertised total.
   * Unknown identities remain counts, never rejected or fabricated VINs.
   *
   * The year distribution is a cache that lags live search by days in both
   * directions (US Auto Supply kept one distribution from 2026-11-22 to
   * 2026-11-24 while its live inventory turned over). Records beyond an
   * advertised year count are complete, tenant-validated search results, so
   * they are kept and reported.
   *
   * `complete` holds the years an uncapped null-make search answered whole.
   * The search is the inventory authority, so a shortfall in such a year is a
   * vehicle the cache still counts after it left the yard: it is reported as
   * lag, bounded at 10% of the yard, and retried later in the day when the
   * bound is exceeded. Only shortfalls in make-partitioned years, where a
   * vehicle may hide behind a make the controls never reached, are
   * unreachable, bounded at 1%. Surpluses never offset either shortfall.
   * Silent 100-record truncation is guarded by the range reader, not here. */
  fromCounts(
    yardName: string,
    advertised: ReturnType<typeof parseVinplusAnalytics>,
    observed: ReadonlyMap<number, number>,
    complete: ReadonlySet<number>,
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
    const shortfalls = advertised.years.flatMap(({ year, count }) => {
      const missing = count - (observed.get(year) ?? 0);
      return missing > 0 ? [{ year, missing }] : [];
    });
    const deficits = shortfalls.filter((row) => !complete.has(row.year));
    const lag = shortfalls.filter((row) => complete.has(row.year));
    const unreachable = total(deficits);
    const lagging = total(lag);
    const detail = `${yardName}: ${unreachable} unreachable advertised vehicles / ${advertised.count} (${percent(unreachable, advertised.count)}%); year deficits: ${listed(deficits)}`;
    const lagDetail = `${yardName}: ${lagging} advertised vehicles / ${advertised.count} (${percent(lagging, advertised.count)}%) are absent from complete live searches (${listed(lag)})`;
    if (unreachable * 100 > advertised.count)
      throw new Error(
        `${detail}; exceeds the 1% limit. Prior inventory is preserved; inspect the saved enumeration controls`,
      );
    if (lagging * 10 > advertised.count)
      throw transientRejection(
        new Error(
          `${lagDetail}; exceeds the 10% lag limit, so the year distribution is too stale to vouch for this yard. The source retries later in the day; if this repeats, compare the distribution with live year searches`,
        ),
      );
    return {
      unreachable,
      lagging,
      warnings: [
        ...(unreachable
          ? [
              `${detail}; within the 1% limit. No identities are asserted for unreachable vehicles.`,
            ]
          : []),
        ...(lagging
          ? [
              `${lagDetail}; within the 10% lag limit. The lagging year distribution still counts them, so they are treated as gone and not published.`,
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
