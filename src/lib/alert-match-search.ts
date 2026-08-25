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

const VEHICLE_RESULT_ATTRIBUTES = [
  "objectID",
  "year",
  "make",
  "model",
  "color",
  "vin",
  "stockNumber",
  "availableDate",
  "source",
  "locationCode",
  "locationName",
  "locationCity",
  "state",
  "stateAbbr",
  "_geoloc",
  "section",
  "row",
  "space",
  "imageUrl",
  "detailsUrl",
  "partsUrl",
  "pricesUrl",
  "engine",
  "trim",
  "transmission",
  "isMissing",
  "missingSinceAt",
  "missingRunCount",
] as const;

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
    const response = await searchClient.searchForHits<Record<string, unknown>>({
      requests: [
        {
          indexName: ALGOLIA_INDEX_NAME,
          query: query.trim(),
          filters: compilation.value,
          hitsPerPage,
          page,
          attributesToRetrieve: [...VEHICLE_RESULT_ATTRIBUTES],
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
