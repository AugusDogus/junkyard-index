/**
 * What one accepted run learned about one yard.
 * - fetched: the run made a live request for the yard's inventory.
 * - replayed: its inventory came from a census, cursor, cache or replay of an
 *   earlier run, not a live request this run.
 * - preserved: the yard deliberately kept its previously published inventory.
 * - blocked: the provider blocked the run's requests for the yard.
 * - unreported: the source does not report per-yard results (yet). Only
 *   reconciliation assigns it; a connector never reports it.
 */
export const YARD_CHECK_OUTCOMES = [
  "fetched",
  "preserved",
  "blocked",
  "replayed",
  "unreported",
] as const;

export type YardCheckOutcome = (typeof YARD_CHECK_OUTCOMES)[number];

/** An outcome a connector can report for a yard it covered. */
export type ReportedYardCheckOutcome = Exclude<YardCheckOutcome, "unreported">;

export const REPORTED_YARD_CHECK_OUTCOMES = [
  "fetched",
  "preserved",
  "blocked",
  "replayed",
] as const satisfies readonly ReportedYardCheckOutcome[];

/** One yard's result in a connector chunk. */
export type YardCheckReport = {
  locationCode: string;
  outcome: ReportedYardCheckOutcome;
};

/** Reported results by location code. */
export type YardCheckReports = ReadonlyMap<string, ReportedYardCheckOutcome>;

// Least proven first: a later, weaker report for the same yard wins.
const PROOF_RANK: Record<ReportedYardCheckOutcome, number> = {
  fetched: 0,
  replayed: 1,
  preserved: 2,
  blocked: 3,
};

function weaker(
  a: ReportedYardCheckOutcome,
  b: ReportedYardCheckOutcome,
): ReportedYardCheckOutcome {
  return PROOF_RANK[b] > PROOF_RANK[a] ? b : a;
}

export const YardCheck = {
  /**
   * Adds reports to `into`. A yard reported twice in one run keeps the less
   * proven outcome, so one live request never covers inventory the same run
   * replayed, preserved or was blocked from.
   */
  merge(
    into: Map<string, ReportedYardCheckOutcome>,
    reports: Iterable<YardCheckReport>,
  ): void {
    for (const { locationCode, outcome } of reports) {
      const previous = into.get(locationCode);
      into.set(
        locationCode,
        previous === undefined ? outcome : weaker(previous, outcome),
      );
    }
  },

  /**
   * Yards a source's snapshot lists vehicles at but reported no result for,
   * sorted. Reconciliation records them as unreported.
   */
  unreported(
    vehicles: Iterable<{ locationCode: string }>,
    reports: YardCheckReports,
  ): string[] {
    const codes = new Set<string>();
    for (const { locationCode } of vehicles)
      if (!reports.has(locationCode)) codes.add(locationCode);
    return [...codes].sort();
  },

  /**
   * Each yard's last proven check as an ISO string, keyed `source:code`, for
   * "Last checked" labels. A yard never checked since tracking began is left
   * out, so it takes its source's date.
   */
  checkDates(
    rows: Iterable<{
      source: string;
      code: string;
      lastCheckedAt: Date | null;
    }>,
  ): Record<string, string> {
    const dates: Record<string, string> = {};
    for (const { source, code, lastCheckedAt } of rows)
      if (lastCheckedAt !== null)
        dates[`${source}:${code}`] = lastCheckedAt.toISOString();
    return dates;
  },

  /** One report per distinct code, all with the same outcome. */
  all(
    codes: Iterable<string>,
    outcome: ReportedYardCheckOutcome,
  ): YardCheckReport[] {
    return [...new Set(codes)].map((locationCode) => ({
      locationCode,
      outcome,
    }));
  },
} as const;
