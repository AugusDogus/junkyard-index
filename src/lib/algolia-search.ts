import { withFullServiceCount } from "~/lib/full-service-search";
import { SearchYearQuery } from "~/lib/search-year-query";
import { withSearchCountsCache } from "~/lib/search-counts-cache";
import {
  compileSearchExpression,
  type CompiledExpression,
  combineSearchFilters,
} from "~/lib/compile-search-expression";
import { createXhrRequester } from "@algolia/requester-browser-xhr";
import {
  liteClient as algoliasearch,
  type LiteClient,
} from "algoliasearch/lite";
import type {
  LegacySearchMethodProps,
  SearchClient,
  SearchMethodParams,
  SearchParamsObject,
} from "algoliasearch";
import { env } from "~/env";
import { withDistanceSort } from "~/lib/algolia-distance-sort";
import { SearchQueryMeter, searchQueryMeter } from "~/lib/search-query-meter";
import { browserSearchKey } from "~/lib/browser-search-key";
import {
  buildAdvancedSearchFilters,
  parseAdvancedSearchQuery,
} from "~/lib/advanced-search-query";
export { ALGOLIA_INDEX_NAME } from "~/lib/constants";

// Deliberate latency tradeoff: browsers search Algolia directly instead of
// through our server. They never hold a long-lived key: each search reads the
// tab's secured key from `browserSearchKey`, which the server mints per plan
// tier (see src/server/search-api-key.ts). Server renders search with the
// server-only ALGOLIA_SEARCH_API_KEY. Never use an admin or write-capable key.
// The lite client refuses an empty key, so the browser builds its client
// from the first granted key and swaps later keys in place.
const serverSearchClient =
  typeof window === "undefined"
    ? algoliasearch(env.NEXT_PUBLIC_ALGOLIA_APP_ID, env.ALGOLIA_SEARCH_API_KEY)
    : null;
let browserSearchClient: LiteClient | null = null;
async function liteSearchClient(): Promise<LiteClient> {
  if (serverSearchClient) return serverSearchClient;
  const apiKey = await browserSearchKey.current(Date.now());
  if (!browserSearchClient) {
    // Meter browser calls for analytics. Server renders keep the default
    // requester; their searches are not a page view's.
    browserSearchClient = algoliasearch(
      env.NEXT_PUBLIC_ALGOLIA_APP_ID,
      apiKey,
      SearchQueryMeter.clientOptions(searchQueryMeter, createXhrRequester()),
    );
  } else {
    browserSearchClient.setClientApiKey({ apiKey });
  }
  return browserSearchClient;
}
const keyedSearchClient: Pick<LiteClient, "search"> = {
  async search(searchMethodParams, requestOptions) {
    return (await liteSearchClient()).search(
      searchMethodParams,
      requestOptions,
    );
  },
};
const baseSearchClient = withFullServiceCount(
  withDistanceSort(withSearchCountsCache(keyedSearchClient)),
);

export const primeSearchCounts = baseSearchClient.primeCounts;

export type SearchExpressionError = {
  kind: "invalid" | "upgrade_required" | "unavailable";
  message: string;
};

/** Shared validation for routed SSR initialization and subsequent search requests. */
export function prepareSearchExpression(
  query: string,
  booleanOrSearchReady: boolean,
  allowAdvancedFilters: boolean,
):
  | { success: true; data: CompiledExpression }
  | { success: false; error: SearchExpressionError } {
  const compiled = compileSearchExpression(query);
  if (!compiled.success) {
    return {
      success: false,
      error: { kind: "invalid", message: compiled.error },
    };
  }
  if (compiled.data.hasFields && !allowAdvancedFilters) {
    return {
      success: false,
      error: {
        kind: "upgrade_required",
        message: "Upgrade to use field conditions in advanced search.",
      },
    };
  }
  if (compiled.data.requiresTokens && !booleanOrSearchReady) {
    return {
      success: false,
      error: {
        kind: "unavailable",
        message:
          "Boolean OR search is temporarily unavailable while the index updates.",
      },
    };
  }
  return compiled;
}

function addAdvancedSyntax(
  params: SearchParamsObject | undefined,
  booleanOrSearchReady: boolean,
  expressionMode = false,
  allowAdvancedFilters = false,
): SearchParamsObject | undefined {
  if (!params || typeof params.query !== "string") return params;

  if (expressionMode) {
    const compiled = prepareSearchExpression(
      params.query,
      booleanOrSearchReady,
      allowAdvancedFilters,
    );
    if (!compiled.success) throw new Error(compiled.error.message);
    return {
      ...params,
      query: compiled.data.query,
      filters: combineSearchFilters(params.filters, compiled.data.filters),
      advancedSyntax: true,
      advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
    };
  }
  const yearQuery = SearchYearQuery.parse(params.query);
  const parsed = parseAdvancedSearchQuery(yearQuery.query);
  if (!parsed.success) return params;
  if (parsed.data.anyWordGroups.length > 0 && !booleanOrSearchReady) {
    return params;
  }

  return {
    ...params,
    query: parsed.data.algoliaQuery,
    filters: buildAdvancedSearchFilters(
      parsed.data.anyWordGroups,
      combineSearchFilters(params.filters, SearchYearQuery.filters(yearQuery)),
    ),
    advancedSyntax: true,
    advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
  };
}

function transformLegacyRequests(
  requests: LegacySearchMethodProps,
  booleanOrSearchReady: boolean,
  expressionMode = false,
  allowAdvancedFilters = false,
): LegacySearchMethodProps {
  return requests.map((request) => ({
    ...request,
    params: addAdvancedSyntax(
      request.params,
      booleanOrSearchReady,
      expressionMode,
      allowAdvancedFilters,
    ),
  }));
}

function transformSearchMethodParams(
  searchMethodParams: SearchMethodParams,
  booleanOrSearchReady: boolean,
  expressionMode = false,
  allowAdvancedFilters = false,
): SearchMethodParams {
  return {
    ...searchMethodParams,
    requests: searchMethodParams.requests.map((request) => {
      if (!("query" in request) || typeof request.query !== "string") {
        return request;
      }

      return {
        ...request,
        ...addAdvancedSyntax(
          request,
          booleanOrSearchReady,
          expressionMode,
          allowAdvancedFilters,
        ),
      };
    }),
  };
}

function createSearchClient(
  booleanOrSearchReady: boolean,
  expressionMode = false,
  allowAdvancedFilters = false,
) {
  return {
    ...baseSearchClient,
    search<T>(
      searchMethodParams: SearchMethodParams | LegacySearchMethodProps,
      requestOptions?: Parameters<typeof baseSearchClient.search>[1],
    ) {
      return Array.isArray(searchMethodParams)
        ? baseSearchClient.search<T>(
            transformLegacyRequests(
              searchMethodParams,
              booleanOrSearchReady,
              expressionMode,
              allowAdvancedFilters,
            ),
            requestOptions,
          )
        : baseSearchClient.search<T>(
            transformSearchMethodParams(
              searchMethodParams,
              booleanOrSearchReady,
              expressionMode,
              allowAdvancedFilters,
            ),
            requestOptions,
          );
    },
  } satisfies Pick<SearchClient, "search">;
}

const clients = new Map<string, ReturnType<typeof createSearchClient>>();
export function getSearchClient(
  booleanOrSearchReady: boolean,
  expressionMode = false,
  allowAdvancedFilters = false,
) {
  const key = `${booleanOrSearchReady}:${expressionMode}:${allowAdvancedFilters}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = createSearchClient(
    booleanOrSearchReady,
    expressionMode,
    allowAdvancedFilters,
  );
  clients.set(key, client);
  return client;
}
