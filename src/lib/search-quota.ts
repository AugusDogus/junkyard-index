import { FREE_DAILY_SEARCH_LIMIT } from "~/lib/plans";

export interface QuotaOutcome {
  allowed: boolean;
  dailyLimit: number;
}

/** UTC-day bucket key (YYYY-MM-DD). Quotas reset at midnight UTC. */
export function currentUtcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The Nth search is allowed when N <= limit: the 10th free search of the day
 * runs, the 11th is blocked. This gates result rendering because Algolia
 * queries use a public client key.
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
