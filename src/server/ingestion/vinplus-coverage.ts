import { transientRejection } from "./ingestion-validation";
import { VINPLUS_NOT_PUBLISHED } from "./vinplus-error";
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
   * The search is the inventory authority, so a shortfall in such a year is
   * lag: a vehicle the cache still counts after it left the yard.
   * - Confirmed lag: the same yard also has searchable vehicles the cache
   *   does not count yet, so this run has shown the cache is stale. It may
   *   reach 50% of the yard, so a cache frozen for days does not block every
   *   VinPlus yard. That is tighter than the per-yard floors (about a third
   *   of each yard); the 50% drift guard is source-wide.
   * - Unconfirmed lag: nothing shows the cache is stale, so the shortfall
   *   could be a search that silently returned fewer rows. It keeps the 1%
   *   bound that every shortfall had before lag was separated.
   * Both reject as transient, because a refreshed cache clears them.
   * Shortfalls in make-partitioned years, where a vehicle may hide behind a
   * make the controls never reached, are unreachable and bounded at 1%.
   * Surpluses never offset either shortfall. Silent 100-record truncation is
   * guarded by the range reader, not here. */
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
    const extra = surplus.reduce((sum, row) => sum + row.extra, 0);
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
    const lagLimit = extra
      ? {
          percent: 50,
          evidence: `The same searches found ${extra} vehicles the distribution does not count yet, so it is stale`,
          over: lagging * 2 > advertised.count,
        }
      : {
          percent: 1,
          evidence:
            "No searchable vehicle exceeds the distribution, so nothing shows it is stale and the searches may have silently returned fewer rows",
          over: lagging * 100 > advertised.count,
        };
    // Unreachable rows reject deterministically on their own; lag in the
    // same yard must not turn that into a same-day retry.
    if (unreachable * 100 > advertised.count)
      throw new Error(
        `${detail}; exceeds the 1% limit, so ${VINPLUS_NOT_PUBLISHED}. Inspect the saved enumeration controls for those years${lagLimit.over ? `. Lag also exceeds its ${lagLimit.percent}% limit: ${lagDetail}` : ""}`,
      );
    if (lagLimit.over)
      throw transientRejection(
        new Error(
          `${lagDetail}. ${lagLimit.evidence}. This exceeds the ${lagLimit.percent}% lag limit, so ${VINPLUS_NOT_PUBLISHED}. The source retries later today; if this repeats, compare the distribution with live single-year searches for those years before changing the limit`,
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
              `${lagDetail}. ${lagLimit.evidence}; within the ${lagLimit.percent}% lag limit, so the absent vehicles are treated as gone and not published.`,
            ]
          : []),
        ...(surplus.length
          ? [
              `${yardName}: ${extra} searchable vehicles exceed the lagging year distribution (${surplus.map((row) => `${row.year}: ${row.count} of ${row.expected} advertised`).join(", ")}); they are kept and do not offset deficits.`,
            ]
          : []),
      ],
    };
  },
} as const;
