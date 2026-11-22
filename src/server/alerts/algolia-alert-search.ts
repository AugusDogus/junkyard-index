import { getSearchIndexCapabilities } from "~/server/ingestion/search-index-readiness";
import "server-only";

import type {
  AlertMatchBound,
  AlertMatchSearch,
} from "~/lib/alert-match-search";
import {
  getAlertMatchStatsBatchWithClient,
  type AlertSearchClient,
} from "~/lib/alert-match-search";
import { HiddenSources } from "~/lib/hidden-source";
import { algoliaSearchClient } from "~/server/algolia-search-client";

// Saved-search alerts never match vehicles of hidden sources.
const alertSearchClient: AlertSearchClient = {
  searchForHits: ({ requests }) =>
    algoliaSearchClient.searchForHits({
      requests: requests.map(HiddenSources.exclude),
    }),
};

export async function getAlertMatchStatsBatch(
  searches: readonly AlertMatchSearch[],
  bound: AlertMatchBound,
) {
  const { makeAliasesReady } = await getSearchIndexCapabilities();
  return getAlertMatchStatsBatchWithClient(
    alertSearchClient,
    searches,
    bound,
    makeAliasesReady,
  );
}
