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
import { db } from "~/lib/db";
import { HiddenSources } from "~/lib/hidden-source";
import { algoliaSearchClient } from "~/server/algolia-search-client";
import { loadHiddenSources } from "~/server/source-control/hidden-sources";

/**
 * Saved-search alerts never match vehicles of hidden sources. Each batch
 * reads the list from the database, so a hide applies to the next batch.
 */
function alertSearchClient(hidden: HiddenSources): AlertSearchClient {
  return {
    searchForHits: ({ requests }) =>
      algoliaSearchClient.searchForHits({
        requests: requests.map((request) =>
          HiddenSources.exclude(hidden, request),
        ),
      }),
  };
}

export async function getAlertMatchStatsBatch(
  searches: readonly AlertMatchSearch[],
  bound: AlertMatchBound,
) {
  const [{ makeAliasesReady }, hidden] = await Promise.all([
    getSearchIndexCapabilities(),
    loadHiddenSources(db, new Date()),
  ]);
  return getAlertMatchStatsBatchWithClient(
    alertSearchClient(hidden),
    searches,
    bound,
    makeAliasesReady,
  );
}
