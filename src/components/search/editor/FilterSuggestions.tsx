"use client";
import { createContext, useContext } from "react";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import type { InventoryFilterOptions } from "~/lib/inventory-filter-options";
export const FilterSuggestions = createContext<
  InventoryFilterOptions | undefined
>(undefined);
export function useFilterSuggestions() {
  const options = useContext(FilterSuggestions);
  return {
    make: options?.makes ?? [],
    color: options?.colors ?? [],
    state: options?.states ?? [],
    yard: options?.salvageYards ?? [],
    source: INGESTION_SOURCES,
  };
}
