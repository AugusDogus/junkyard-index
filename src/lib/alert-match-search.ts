import type { SearchResponse } from "algoliasearch/lite";
import {
  compileAlertFilters,
  scanAlertMatchPages,
  toAlertSearchPage,
  type AlertFilters,
  type AlertMatchStats,
  type FetchAlertSearchPage,
} from "~/lib/algolia-alert-search";
import { ALGOLIA_INDEX_NAME, ALGOLIA_PAGINATION_LIMIT } from "~/lib/constants";
import {
  ALGOLIA_VEHICLE_HIT_ATTRIBUTES,
  type AlgoliaVehicleHit,
} from "~/lib/search-vehicles";

export interface AlertSearchClient {
  searchForHits<T>(input: {
    requests: Array<{
      indexName: string;
      query: string;
      filters: string | undefined;
      hitsPerPage: number;
      page: number;
      attributesToRetrieve: string[];
      attributesToHighlight: string[];
      attributesToSnippet: string[];
    }>;
  }): Promise<{ results: Array<SearchResponse<T>> }>;
}

export async function getAlertMatchStatsWithClient(
  searchClient: AlertSearchClient,
  query: string,
  filters: AlertFilters,
  lastCheckedAt: Date | null,
): Promise<AlertMatchStats> {
  const compilation = compileAlertFilters(filters, lastCheckedAt);
  if (compilation.kind === "no_match") {
    return {
      matchedCount: 0,
      completion: { status: "complete" },
      vehicles: [],
    };
  }
  const fetchPage: FetchAlertSearchPage = async (page, hitsPerPage) => {
    const response = await searchClient.searchForHits<AlgoliaVehicleHit>({
      requests: [
        {
          indexName: ALGOLIA_INDEX_NAME,
          query: query.trim(),
          filters: compilation.value,
          hitsPerPage,
          page,
          attributesToRetrieve: [...ALGOLIA_VEHICLE_HIT_ATTRIBUTES],
          attributesToHighlight: [],
          attributesToSnippet: [],
        },
      ],
    });
    const result = response.results[0];
    return result ? toAlertSearchPage(result) : null;
  };

  return scanAlertMatchPages(fetchPage, {
    hitsPerPage: 100,
    paginationLimit: ALGOLIA_PAGINATION_LIMIT,
  });
}
