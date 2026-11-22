import { db } from "~/lib/db";
import { HiddenSources } from "~/lib/hidden-source";
import { cacheInventory } from "~/lib/inventory-cache";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { SearchFilterOptions } from "~/server/search-filter-options";

/** Refreshed with the daily inventory, so a request rarely reads Turso. */
const getSearchFilterOptions = cacheInventory(
  () => SearchFilterOptions.load(db),
  ["search-filter-options-v1", ...HiddenSources.unlisted],
);

export const searchRouter = createTRPCRouter({
  filterOptions: publicProcedure.query(() => getSearchFilterOptions()),
});
