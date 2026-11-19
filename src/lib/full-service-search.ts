import type {
  FacetFilters,
  LegacySearchMethodProps,
  LiteClient,
  SearchMethodParams,
  SearchParamsObject,
} from "algoliasearch/lite";
import { combineSearchFilters } from "./compile-search-expression";

function facetValues(filters: FacetFilters): string[] {
  return typeof filters === "string" ? [filters] : filters.flatMap(facetValues);
}

function removeYardFilters(filters: FacetFilters): FacetFilters[] {
  if (typeof filters === "string")
    return filters.startsWith("yardTypes:") ? [] : [filters];
  const remaining = filters.flatMap(removeYardFilters);
  return remaining.length ? [remaining] : [];
}

/** Count only additional vehicles, excluding both-type yards already shown. */
export function fullServiceCountParams(
  params: SearchParamsObject,
): SearchParamsObject | null {
  const facets = params.facetFilters;
  if (!Array.isArray(facets)) return null;
  const yardFilters = facets
    .flatMap(facetValues)
    .filter((filter) => filter.startsWith("yardTypes:"));
  if (yardFilters.length !== 1 || yardFilters[0] !== "yardTypes:self_service")
    return null;
  return {
    ...params,
    facetFilters: facets.flatMap(removeYardFilters),
    filters: combineSearchFilters(
      params.filters,
      "yardTypes:full_service AND NOT yardTypes:self_service",
    ),
    page: 0,
    hitsPerPage: 0,
    facets: ["yardTypes"],
    analytics: false,
    clickAnalytics: false,
  };
}

export function readFullServiceCount(userData: unknown): number {
  if (!Array.isArray(userData)) return 0;
  for (const entry of userData) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "fullServiceExtraMatches" in entry &&
      typeof entry.fullServiceExtraMatches === "number"
    )
      return entry.fullServiceExtraMatches;
  }
  return 0;
}

/** Append one count request to the same HTTP batch and hide it from InstantSearch. */
export function withFullServiceCount<Client extends Pick<LiteClient, "search">>(
  client: Client,
) {
  return {
    ...client,
    async search<T>(
      input: SearchMethodParams | LegacySearchMethodProps,
      requestOptions?: Parameters<LiteClient["search"]>[1],
    ) {
      const requests = Array.isArray(input) ? input : input.requests;
      const first = requests[0];
      const params =
        first &&
        ("params" in first
          ? typeof first.params === "object"
            ? first.params
            : undefined
          : "query" in first || "facetFilters" in first
            ? first
            : undefined);
      const countParams =
        first?.type !== "facet" && params
          ? fullServiceCountParams(params)
          : null;
      if (!first || !countParams)
        return client.search<T>(input, requestOptions);
      const augmented = Array.isArray(input)
        ? [...input, { indexName: first.indexName, params: countParams }]
        : {
            ...input,
            requests: [
              ...input.requests,
              { indexName: first.indexName, ...countParams },
            ],
          };
      const response = await client.search<T>(augmented, requestOptions);
      const countResult = response.results[requests.length];
      const extraCount =
        countResult && "facets" in countResult
          ? (countResult.facets?.yardTypes?.full_service ?? 0)
          : 0;
      return {
        ...response,
        results: response.results
          .slice(0, requests.length)
          .map((result, index) =>
            index === 0 && "hits" in result
              ? {
                  ...result,
                  userData: [
                    ...(result.userData ?? []),
                    { fullServiceExtraMatches: extraCount },
                  ],
                }
              : result,
          ),
      };
    },
  };
}
