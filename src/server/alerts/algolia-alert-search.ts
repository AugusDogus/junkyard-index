import "server-only";

import type { AlertFilters, AlertMatchStats } from "~/lib/algolia-alert-search";
import { getAlertMatchStatsWithClient } from "~/lib/alert-match-search";
import { algoliaSearchClient } from "~/server/algolia-search-client";

export async function getAlertMatchStats(
  query: string,
  filters: AlertFilters,
  lastCheckedAt: Date | null,
): Promise<AlertMatchStats> {
  return getAlertMatchStatsWithClient(
    algoliaSearchClient,
    query,
    filters,
    lastCheckedAt,
  );
}
