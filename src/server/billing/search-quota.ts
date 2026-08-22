import {
  FREE_DAILY_SEARCH_LIMIT,
  currentUtcDay as currentUtcDayImpl,
} from "~/lib/plans";

/**
 * Free-tier search quota semantics. Shared so the enforcement endpoint and
 * tests cannot drift apart.
 */

/** UTC-day bucket key (YYYY-MM-DD). Quotas reset at midnight UTC. */
export function currentUtcDay(now: Date = new Date()): string {
  return currentUtcDayImpl(now);
}

export interface QuotaOutcome {
  allowed: boolean;
  dailyLimit: number;
}

/**
 * The Nth search is allowed when N <= limit: the 10th free search of the day
 * runs, the 11th is blocked. Note this is display-level enforcement only:
 * Algolia queries run client-side from a public key, so the quota gates
 * rendering, not the underlying API calls. Accepted trade-off.
 */
export function evaluateSearchQuota(
  searchesUsedAfterIncrement: number,
  limit: number = FREE_DAILY_SEARCH_LIMIT,
): QuotaOutcome {
  return {
    allowed: searchesUsedAfterIncrement <= limit,
    dailyLimit: limit,
  };
}
