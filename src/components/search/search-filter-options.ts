import type { InventoryFilterOptions } from "~/lib/inventory-filter-options";

// Refinement attributes. Their option lists come from Turso
// (`api.search.filterOptions`), so no facet value limit truncates them.
export const SEARCH_FILTER_FACETS = {
  makes: { attribute: "make" },
  colors: { attribute: "color" },
  states: { attribute: "state" },
  salvageYards: { attribute: "locationName" },
  sources: { attribute: "source" },
} as const;

export type SearchFilterOptions = InventoryFilterOptions;
