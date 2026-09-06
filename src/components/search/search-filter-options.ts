import type { InventoryFilterOptions } from "~/lib/inventory-filter-options";

export const SEARCH_FILTER_FACETS = {
  makes: { attribute: "make", limit: 100 },
  colors: { attribute: "color", limit: 50 },
  states: { attribute: "state", limit: 60 },
  salvageYards: { attribute: "locationName", limit: 500 },
  sources: { attribute: "source", limit: 10 },
} as const;

export type SearchFilterOptions = InventoryFilterOptions;
