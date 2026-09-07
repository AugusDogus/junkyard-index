import {
  compileSearchExpression,
  combineSearchFilters,
} from "~/lib/compile-search-expression";
import { liteClient as algoliasearch } from "algoliasearch/lite";
import type {
  LegacySearchMethodProps,
  SearchClient,
  SearchMethodParams,
  SearchParamsObject,
} from "algoliasearch";
import { env } from "~/env";
import {
  buildAdvancedSearchFilters,
  parseAdvancedSearchQuery,
} from "~/lib/advanced-search-query";
export { ALGOLIA_INDEX_NAME } from "~/lib/constants";

// Deliberate latency tradeoff: searches go directly from the browser to
// Algolia instead of through our server. This public key must remain restricted
// to search-only operations on the public vehicle index. It is not a secret and
// must never be replaced here with an admin or write-capable key.
const baseSearchClient = algoliasearch(
  env.NEXT_PUBLIC_ALGOLIA_APP_ID,
  env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
);

function addAdvancedSyntax(
  params: SearchParamsObject | undefined,
  booleanOrSearchReady: boolean,
  expressionMode = false,
  allowAdvancedFilters = false,
): SearchParamsObject | undefined {
  if (!params || typeof params.query !== "string") return params;

  if (expressionMode) {
    const compiled = compileSearchExpression(params.query);
    if (!compiled.success) throw new Error(compiled.error);
    if (compiled.data.hasFields && !allowAdvancedFilters)
      throw new Error("Upgrade to use field conditions in advanced search.");
    if (compiled.data.requiresTokens && !booleanOrSearchReady)
      throw new Error(
        "Boolean OR search is temporarily unavailable while the index updates.",
      );
    return {
      ...params,
      query: compiled.data.query,
      filters: combineSearchFilters(params.filters, compiled.data.filters),
      advancedSyntax: true,
      advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
    };
  }
  const parsed = parseAdvancedSearchQuery(params.query);
  if (!parsed.success) return params;
  if (parsed.data.anyWordGroups.length > 0 && !booleanOrSearchReady) {
    return params;
  }

  return {
    ...params,
    query: parsed.data.algoliaQuery,
    filters: buildAdvancedSearchFilters(
      parsed.data.anyWordGroups,
      params.filters,
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
