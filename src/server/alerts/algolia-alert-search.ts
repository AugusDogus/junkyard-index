import "server-only";

import type { AlertMatchSearch } from "~/lib/alert-match-search";
import { getAlertMatchStatsBatchWithClient } from "~/lib/alert-match-search";
import { algoliaSearchClient } from "~/server/algolia-search-client";

export function getAlertMatchStatsBatch(
  searches: readonly AlertMatchSearch[],
  latestFirstSeenAt: Date | null,
) {
  return getAlertMatchStatsBatchWithClient(
    algoliaSearchClient,
    searches,
    latestFirstSeenAt,
  );
}
