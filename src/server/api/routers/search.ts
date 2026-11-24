import { db } from "~/lib/db";
import { RETIRED_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { SearchFilterOptions } from "~/server/search-filter-options";
import { cacheShownInventory } from "~/server/source-control/hidden-sources-loader";

/**
 * Refreshed with the daily inventory, so a request rarely reads Turso. A
 * hide or show from /admin expires it (see cacheShownInventory).
 */
const getSearchFilterOptions = cacheShownInventory(
  (hidden) => SearchFilterOptions.load(db, hidden),
  ["search-filter-options-v3", ...RETIRED_INGESTION_SOURCES],
);

export const searchRouter = createTRPCRouter({
  filterOptions: publicProcedure.query(() => getSearchFilterOptions()),
});
