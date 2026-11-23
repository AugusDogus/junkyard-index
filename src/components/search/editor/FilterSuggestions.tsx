"use client";

import { YARD_TYPE_OPTIONS } from "~/lib/yard-service";
import { createContext, useContext } from "react";
import { useHiddenSources } from "~/components/HiddenSourcesContext";
import { HiddenSources } from "~/lib/hidden-source";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import type { InventoryFilterOptions } from "~/lib/inventory-filter-options";
export const FilterSuggestions = createContext<
  InventoryFilterOptions | undefined
>(undefined);
export function useFilterSuggestions() {
  const options = useContext(FilterSuggestions);
  const hidden = useHiddenSources();
  return {
    make: options?.makes ?? [],
    color: options?.colors ?? [],
    state: options?.states ?? [],
    yard: options?.salvageYards ?? [],
    source: HiddenSources.shown(hidden, INGESTION_SOURCES),
    yardType: YARD_TYPE_OPTIONS.map((option) => option.value),
  };
}
