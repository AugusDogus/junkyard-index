import { SearchArea } from "./search-area";
import {
  compileSearchExpression,
  combineSearchFilters,
} from "~/lib/compile-search-expression";
import { SearchYearQuery } from "~/lib/search-year-query";
import type { SearchResponse } from "algoliasearch/lite";
import {
  compileAlertFilters,
  scanAlertMatchPages,
  toAlertSearchPage,
  type AlertFilters,
  type AlertMatchStats,
  type AlertSearchPage,
} from "~/lib/algolia-alert-search";
import {
  buildAdvancedSearchFilters,
  parseAdvancedSearchQuery,
} from "~/lib/advanced-search-query";
import { ALGOLIA_INDEX_NAME, ALGOLIA_PAGINATION_LIMIT } from "~/lib/constants";
import {
  ALGOLIA_VEHICLE_HIT_ATTRIBUTES,
  type AlgoliaVehicleHit,
} from "~/lib/search-vehicles";

export interface AlertSearchClient {
  searchForHits(input: {
    requests: Array<{
      indexName: string;
      query: string;
      aroundLatLng?: string;
      aroundRadius?: number | "all";
      advancedSyntax: true;
      advancedSyntaxFeatures: ["exactPhrase", "excludeWords"];
      filters: string | undefined;
      hitsPerPage: number;
      page: number;
      attributesToRetrieve: string[];
      attributesToHighlight: string[];
      attributesToSnippet: string[];
    }>;
  }): Promise<{ results: Array<SearchResponse<AlgoliaVehicleHit>> }>;
}

type AlertSearchRequest = Parameters<
  AlertSearchClient["searchForHits"]
>[0]["requests"][number];
type SearchPage = (
  request: AlertSearchRequest,
) => Promise<AlertSearchPage | null>;

export interface AlertMatchSearch {
  query: string;
  filters: AlertFilters;
  lastCheckedAt: Date | null;
}

/**
 * The newest vehicles a batched match may see: those first seen through
 * `checkedThrough`, the newest of which was first seen at `latestFirstSeenAt`
 * (null when there are none). Searches already checked through the latest
 * vehicle skip Algolia.
 */
export interface AlertMatchBound {
  checkedThrough: Date;
  latestFirstSeenAt: Date | null;
}

async function scanSearch(
  searchPage: SearchPage,
  { query, filters, lastCheckedAt }: AlertMatchSearch,
  bound?: AlertMatchBound,
): Promise<AlertMatchStats> {
  const expression =
    filters.expression === undefined
      ? null
      : compileSearchExpression(filters.expression);
  if (expression && !expression.success)
    throw new Error(
      `Cannot match saved search expression: ${expression.error}`,
    );
  const compilation = compileAlertFilters(
    filters,
    lastCheckedAt,
    bound?.checkedThrough ?? null,
  );
  const yearQuery = SearchYearQuery.parse(query.trim());
  const parsedQuery = parseAdvancedSearchQuery(yearQuery.query);
  // Algolia compares whole seconds.
  const hasNewVehicles =
    bound === undefined ||
    lastCheckedAt === null ||
    (bound.latestFirstSeenAt !== null &&
      Math.floor(bound.latestFirstSeenAt.getTime() / 1000) >
        Math.floor(lastCheckedAt.getTime() / 1000));
  if (
    compilation.kind === "no_match" ||
    !parsedQuery.success ||
    !hasNewVehicles
  ) {
    return {
      matchedCount: 0,
      completion: { status: "complete" },
      vehicles: [],
    };
  }
  return scanAlertMatchPages(
    (page, hitsPerPage) =>
      searchPage({
        indexName: ALGOLIA_INDEX_NAME,
        ...SearchArea.params(filters.near),
        query: expression?.success
          ? expression.data.query
          : parsedQuery.data.algoliaQuery,
        advancedSyntax: true,
        advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
        filters: expression?.success
          ? combineSearchFilters(expression.data.filters, compilation.value)
          : buildAdvancedSearchFilters(
              parsedQuery.data.anyWordGroups,
              combineSearchFilters(
                compilation.value,
                SearchYearQuery.filters(yearQuery),
              ),
            ),
        hitsPerPage,
        page,
        attributesToRetrieve: [...ALGOLIA_VEHICLE_HIT_ATTRIBUTES],
        attributesToHighlight: [],
        attributesToSnippet: [],
      }),
    { hitsPerPage: 100, paginationLimit: ALGOLIA_PAGINATION_LIMIT },
  );
}

export async function getAlertMatchStatsWithClient(
  searchClient: AlertSearchClient,
  query: string,
  filters: AlertFilters,
  lastCheckedAt: Date | null,
): Promise<AlertMatchStats> {
  return scanSearch(
    async (request) => {
      const response = await searchClient.searchForHits({
        requests: [request],
      });
      const result = response.results[0];
      return result ? toAlertSearchPage(result) : null;
    },
    { query, filters, lastCheckedAt },
  );
}

/**
 * Coalesces each pagination round into one multi-query request (up to 50
 * queries) while retaining each search's scan semantics.
 */
export async function getAlertMatchStatsBatchWithClient(
  searchClient: AlertSearchClient,
  searches: readonly AlertMatchSearch[],
  bound: AlertMatchBound,
): Promise<PromiseSettledResult<AlertMatchStats>[]> {
  type Pending = {
    request: AlertSearchRequest;
    resolve: (page: AlertSearchPage | null) => void;
    reject: (error: unknown) => void;
  };
  let pending: Pending[] = [];
  async function flush() {
    const batch = pending;
    pending = [];
    for (let offset = 0; offset < batch.length; offset += 50) {
      const chunk = batch.slice(offset, offset + 50);
      try {
        const response = await searchClient.searchForHits({
          requests: chunk.map((item) => item.request),
        });
        for (const [index, item] of chunk.entries()) {
          const result = response.results[index];
          item.resolve(result ? toAlertSearchPage(result) : null);
        }
      } catch (error) {
        for (const item of chunk) item.reject(error);
      }
    }
  }
  const searchPage: SearchPage = (request) =>
    new Promise((resolve, reject) => {
      pending.push({ request, resolve, reject });
      if (pending.length === 1)
        queueMicrotask(() => {
          void flush();
        });
    });
  return Promise.allSettled(
    searches.map((search) => scanSearch(searchPage, search, bound)),
  );
}
