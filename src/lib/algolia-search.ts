import { MakeFilter } from "~/lib/make-filter";
import { withFullServiceCount } from "~/lib/full-service-search";
import { SearchYearQuery } from "~/lib/search-year-query";
import { withSearchCountsCache } from "~/lib/search-counts-cache";
import {
  compileSearchExpression,
  type CompiledExpression,
  combineSearchFilters,
} from "~/lib/compile-search-expression";
import { createMemoryCache, type Transporter } from "@algolia/client-common";
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
import { HiddenSources } from "~/lib/hidden-source";
import { SearchQueryMeter, searchQueryMeter } from "~/lib/search-query-meter";
import { browserSearchKey } from "~/lib/browser-search-key";
import { SearchKeyGrant } from "~/lib/search-key-grant";
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
// Agent segments InstantSearch adds before the browser client exists.
const algoliaAgents: [segment: string, version?: string][] = [];
async function liteSearchClient(): Promise<{
  client: LiteClient;
  apiKey: string | null;
}> {
  if (serverSearchClient) return { client: serverSearchClient, apiKey: null };
  const apiKey = await browserSearchKey.current();
  if (!browserSearchClient) {
    // Meter browser calls for analytics. Server renders keep the default
    // requester; their searches are not a page view's.
    browserSearchClient = algoliasearch(
      env.NEXT_PUBLIC_ALGOLIA_APP_ID,
      apiKey,
      SearchQueryMeter.clientOptions(searchQueryMeter, createXhrRequester()),
    );
    for (const [segment, version] of algoliaAgents)
      browserSearchClient.addAlgoliaAgent(segment, version);
  } else {
    browserSearchClient.setClientApiKey({ apiKey });
  }
  return { client: browserSearchClient, apiKey };
}
const keyedSearchClient: Pick<LiteClient, "search" | "addAlgoliaAgent"> & {
  transporter: Pick<Transporter, "responsesCache">;
} = {
  // InstantSearch's hydration (hydrateSearchClient) seeds the server
  // render's results into this cache and answers matching browser searches
  // from it. It skips clients without a transporter, so without this the
  // first browser search would repeat the server's query.
  transporter: serverSearchClient?.transporter ?? {
    responsesCache: createMemoryCache(),
  },
  addAlgoliaAgent(segment, version) {
    const client = serverSearchClient ?? browserSearchClient;
    if (client) {
      client.addAlgoliaAgent(segment, version);
      return;
    }
    // Only the browser records segments, and only until its client exists;
    // every remount re-adds the same ones, so keep each segment once.
    if (!algoliaAgents.some(([recorded]) => recorded === segment))
      algoliaAgents.push([segment, version]);
  },
  async search(searchMethodParams, requestOptions) {
    const { client, apiKey } = await liteSearchClient();
    try {
      return await client.search(searchMethodParams, requestOptions);
    } catch (error) {
      // Algolia refused the key (for example, it expired early against
      // Algolia's clock): get another key and retry once.
      if (
        apiKey === null ||
        !SearchKeyGrant.isKeyRejection(error) ||
        !browserSearchKey.reject(apiKey)
      )
        throw error;
      const retry = await liteSearchClient();
      return retry.client.search(searchMethodParams, requestOptions);
    }
  },
};
// Innermost, so every request reaching Algolia, including count and facet
// requests the wrappers add, leaves out hidden sources.
const baseSearchClient = withFullServiceCount(
  withDistanceSort(
    withSearchCountsCache(HiddenSources.withSearchClient(keyedSearchClient)),
  ),
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
  makeAliasesReady = true,
):
  | { success: true; data: CompiledExpression }
  | { success: false; error: SearchExpressionError } {
  const compiled = compileSearchExpression(query, makeAliasesReady);
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
  makeAliasesReady = false,
): SearchParamsObject | undefined {
  if (!params) return params;
  params = {
    ...params,
    facetFilters: params.facetFilters
      ? MakeFilter.facets(params.facetFilters, makeAliasesReady)
      : params.facetFilters,
  };
  if (typeof params.query !== "string") return params;

  if (expressionMode) {
    const compiled = prepareSearchExpression(
      params.query,
      booleanOrSearchReady,
      allowAdvancedFilters,
      makeAliasesReady,
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
  makeAliasesReady = false,
): LegacySearchMethodProps {
  return requests.map((request) => ({
    ...request,
    params: addAdvancedSyntax(
      request.params,
      booleanOrSearchReady,
      expressionMode,
      allowAdvancedFilters,
      makeAliasesReady,
    ),
  }));
}

function transformSearchMethodParams(
  searchMethodParams: SearchMethodParams,
  booleanOrSearchReady: boolean,
  expressionMode = false,
  allowAdvancedFilters = false,
  makeAliasesReady = false,
): SearchMethodParams {
  return {
    ...searchMethodParams,
    requests: searchMethodParams.requests.map((request) => {
      if (!("query" in request) && !("facetFilters" in request)) {
        return request;
      }

      return {
        ...request,
        ...addAdvancedSyntax(
          request,
          booleanOrSearchReady,
          expressionMode,
          allowAdvancedFilters,
          makeAliasesReady,
        ),
      };
    }),
  };
}

function createSearchClient(
  booleanOrSearchReady: boolean,
  expressionMode = false,
  allowAdvancedFilters = false,
  makeAliasesReady = false,
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
              makeAliasesReady,
            ),
            requestOptions,
          )
        : baseSearchClient.search<T>(
            transformSearchMethodParams(
              searchMethodParams,
              booleanOrSearchReady,
              expressionMode,
              allowAdvancedFilters,
              makeAliasesReady,
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
  makeAliasesReady = false,
) {
  const key = `${booleanOrSearchReady}:${expressionMode}:${allowAdvancedFilters}:${makeAliasesReady}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = createSearchClient(
    booleanOrSearchReady,
    expressionMode,
    allowAdvancedFilters,
    makeAliasesReady,
  );
  clients.set(key, client);
  return client;
}
