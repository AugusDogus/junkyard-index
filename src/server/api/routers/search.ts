import { db } from "~/lib/db";
import { HiddenSources } from "~/lib/hidden-source";
import { RETIRED_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { cacheInventory } from "~/lib/inventory-cache";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { SearchFilterOptions } from "~/server/search-filter-options";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";

/**
 * Refreshed with the daily inventory, so a request rarely reads Turso. The
 * hidden list is part of the key, so a hide or show reads a fresh entry.
 */
const getSearchFilterOptions = cacheInventory(
  (hiddenList: readonly string[]) =>
    SearchFilterOptions.load(db, HiddenSources.of(hiddenList)),
  ["search-filter-options-v2", ...RETIRED_INGESTION_SOURCES],
);

export const searchRouter = createTRPCRouter({
  filterOptions: publicProcedure.query(async () =>
    getSearchFilterOptions((await getHiddenSources()).list),
  ),
});
