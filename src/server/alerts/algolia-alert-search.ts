import { getSearchIndexCapabilities } from "~/server/ingestion/search-index-readiness";
import "server-only";

import type {
  AlertMatchBound,
  AlertMatchSearch,
} from "~/lib/alert-match-search";
import { getAlertMatchStatsBatchWithClient } from "~/lib/alert-match-search";
import { algoliaSearchClient } from "~/server/algolia-search-client";

export async function getAlertMatchStatsBatch(
  searches: readonly AlertMatchSearch[],
  bound: AlertMatchBound,
) {
  const { makeAliasesReady } = await getSearchIndexCapabilities();
  return getAlertMatchStatsBatchWithClient(
    algoliaSearchClient,
    searches,
    bound,
    makeAliasesReady,
  );
}
