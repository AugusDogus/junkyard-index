"use client";

import { useQuery } from "@tanstack/react-query";
import { InventoryFilterOptions } from "~/lib/inventory-filter-options";

export function useInventoryFilterOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["inventory-filter-options"],
    queryFn: async () => {
      const { getSearchClient } = await import("~/lib/algolia-search");
      return InventoryFilterOptions.load(getSearchClient(false));
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
