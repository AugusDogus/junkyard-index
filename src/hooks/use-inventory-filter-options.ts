"use client";

import { api } from "~/trpc/react";

/** Every filter value in live inventory, from Turso; spends no search quota. */
export function useInventoryFilterOptions(enabled: boolean) {
  return api.search.filterOptions.useQuery(undefined, {
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
