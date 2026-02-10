import { getLiveHomepageStats } from "~/lib/homepage-stats";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const statsRouter = createTRPCRouter({
  live: publicProcedure.query(async () => {
    return getLiveHomepageStats();
  }),
});
