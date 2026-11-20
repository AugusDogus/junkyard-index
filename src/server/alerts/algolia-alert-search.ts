import "server-only";

import type {
  AlertMatchBound,
  AlertMatchSearch,
} from "~/lib/alert-match-search";
import { getAlertMatchStatsBatchWithClient } from "~/lib/alert-match-search";
import { algoliaSearchClient } from "~/server/algolia-search-client";

export function getAlertMatchStatsBatch(
  searches: readonly AlertMatchSearch[],
  bound: AlertMatchBound,
) {
  return getAlertMatchStatsBatchWithClient(
    algoliaSearchClient,
    searches,
    bound,
  );
}
