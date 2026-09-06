import type { LiteClient } from "algoliasearch/lite";
import { ALGOLIA_INDEX_NAME } from "~/lib/constants";

export type InventoryFilterOptions = {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
};

async function load(
  client: Pick<LiteClient, "search">,
): Promise<InventoryFilterOptions> {
  // Saved searches must be able to match future arrivals, even when the
  // current query or filter combination has no inventory.
  const { results } = await client.search({
    requests: [
      {
        indexName: ALGOLIA_INDEX_NAME,
        query: "",
        facets: ["make", "color", "state", "locationName"],
        maxValuesPerFacet: 1000,
        hitsPerPage: 0,
        analytics: false,
        clickAnalytics: false,
        enableRules: false,
      },
    ],
  });
  const result = results[0];
  if (!result || !("hits" in result)) {
    throw new Error("Inventory filter search returned no inventory response.");
  }
  return {
    makes: Object.keys(result.facets?.make ?? {}).sort(),
    colors: Object.keys(result.facets?.color ?? {}).sort(),
    states: Object.keys(result.facets?.state ?? {}).sort(),
    salvageYards: Object.keys(result.facets?.locationName ?? {}).sort(),
  };
}

function withSelected(
  options: InventoryFilterOptions | undefined,
  selected: InventoryFilterOptions,
): InventoryFilterOptions {
  return {
    makes: [...new Set([...(options?.makes ?? []), ...selected.makes])].sort(),
    colors: [
      ...new Set([...(options?.colors ?? []), ...selected.colors]),
    ].sort(),
    states: [
      ...new Set([...(options?.states ?? []), ...selected.states]),
    ].sort(),
    salvageYards: [
      ...new Set([...(options?.salvageYards ?? []), ...selected.salvageYards]),
    ].sort(),
  };
}

export const InventoryFilterOptions = { load, withSelected } as const;
