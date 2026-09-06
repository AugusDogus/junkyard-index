"use client";

import { useQuery } from "@tanstack/react-query";
import { getSearchClient } from "~/lib/algolia-search";
import { InventoryFilterOptions } from "~/lib/inventory-filter-options";

export function useInventoryFilterOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["inventory-filter-options"],
    queryFn: () => InventoryFilterOptions.load(getSearchClient(false)),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
