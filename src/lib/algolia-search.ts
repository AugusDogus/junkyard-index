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
): SearchParamsObject | undefined {
  if (!params || typeof params.query !== "string") return params;

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
): LegacySearchMethodProps {
  return requests.map((request) => ({
    ...request,
    params: addAdvancedSyntax(request.params, booleanOrSearchReady),
  }));
}

function transformSearchMethodParams(
  searchMethodParams: SearchMethodParams,
  booleanOrSearchReady: boolean,
): SearchMethodParams {
  return {
    ...searchMethodParams,
    requests: searchMethodParams.requests.map((request) => {
      if (!("query" in request) || typeof request.query !== "string") {
        return request;
      }

      const parsed = parseAdvancedSearchQuery(request.query);
      if (!parsed.success) return request;
      if (parsed.data.anyWordGroups.length > 0 && !booleanOrSearchReady) {
        return request;
      }

      return {
        ...request,
        query: parsed.data.algoliaQuery,
        filters: buildAdvancedSearchFilters(
          parsed.data.anyWordGroups,
          request.filters,
        ),
        advancedSyntax: true,
        advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
      };
    }),
  };
}

function createSearchClient(booleanOrSearchReady: boolean) {
  return {
    ...baseSearchClient,
    search<T>(
      searchMethodParams: SearchMethodParams | LegacySearchMethodProps,
      requestOptions?: Parameters<typeof baseSearchClient.search>[1],
    ) {
      return Array.isArray(searchMethodParams)
        ? baseSearchClient.search<T>(
            transformLegacyRequests(searchMethodParams, booleanOrSearchReady),
            requestOptions,
          )
        : baseSearchClient.search<T>(
            transformSearchMethodParams(
              searchMethodParams,
              booleanOrSearchReady,
            ),
            requestOptions,
          );
    },
  } satisfies Pick<SearchClient, "search">;
}

const pendingMigrationSearchClient = createSearchClient(false);
const readySearchClient = createSearchClient(true);

export function getSearchClient(booleanOrSearchReady: boolean) {
  return booleanOrSearchReady
    ? readySearchClient
    : pendingMigrationSearchClient;
}
