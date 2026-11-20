import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getSearchIndexCapabilities } from "~/server/ingestion/search-index-readiness";

export const statusRouter = createTRPCRouter({
  searchCapabilities: publicProcedure.query(getSearchIndexCapabilities),
});
