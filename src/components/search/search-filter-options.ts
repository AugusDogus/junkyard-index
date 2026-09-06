import { ALGOLIA_INDEX_NAME, searchClient } from "~/lib/algolia-search";

export const SEARCH_FILTER_FACETS = {
  makes: { attribute: "make", limit: 100 },
  colors: { attribute: "color", limit: 50 },
  states: { attribute: "state", limit: 60 },
  salvageYards: { attribute: "locationName", limit: 500 },
  sources: { attribute: "source", limit: 10 },
} as const;

export interface SearchFilterOptions {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
}

const selectableFacetKeys = [
  "makes",
  "colors",
  "states",
  "salvageYards",
] as const;

function valuesFromFacet(
  facets: Record<string, Record<string, number>> | undefined,
  key: (typeof selectableFacetKeys)[number],
): string[] {
  const facet = SEARCH_FILTER_FACETS[key];
  return Object.keys(facets?.[facet.attribute] ?? {}).sort((left, right) =>
    left.localeCompare(right),
  );
}

export async function loadSearchFilterOptions(): Promise<SearchFilterOptions> {
  const maxValuesPerFacet = Math.max(
    ...selectableFacetKeys.map((key) => SEARCH_FILTER_FACETS[key].limit),
  );
  const response = await searchClient.searchForHits({
    requests: [
      {
        indexName: ALGOLIA_INDEX_NAME,
        query: "",
        facets: selectableFacetKeys.map(
          (key) => SEARCH_FILTER_FACETS[key].attribute,
        ),
        maxValuesPerFacet,
        hitsPerPage: 0,
      },
    ],
  });
  const facets = response.results[0]?.facets;
  return {
    makes: valuesFromFacet(facets, "makes"),
    colors: valuesFromFacet(facets, "colors"),
    states: valuesFromFacet(facets, "states"),
    salvageYards: valuesFromFacet(facets, "salvageYards"),
  };
}
