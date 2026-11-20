import { db } from "~/lib/db";
import { RETIRED_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { cacheInventory } from "~/lib/inventory-cache";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { SearchFilterOptions } from "~/server/search-filter-options";

/** Refreshed with the daily inventory, so a request rarely reads Turso. */
const getSearchFilterOptions = cacheInventory(
  () => SearchFilterOptions.load(db),
  ["search-filter-options-v1", ...RETIRED_INGESTION_SOURCES],
);

export const searchRouter = createTRPCRouter({
  filterOptions: publicProcedure.query(() => getSearchFilterOptions()),
});
