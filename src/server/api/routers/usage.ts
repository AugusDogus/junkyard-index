import { sql } from "drizzle-orm";
import { hasPlanFeature } from "~/lib/plans";
import { getPlanTier } from "~/server/billing/user-plan";
import {
  currentUtcDay,
  evaluateSearchQuota,
} from "~/server/billing/search-quota";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { searchUsage } from "~/schema";

export const usageRouter = createTRPCRouter({
  /**
   * Records one search for the current user and reports whether they may
   * still search today. Paid tiers are never counted or limited.
   */
  recordSearch: protectedProcedure.mutation(async ({ ctx }) => {
    const planTier = ctx.user.isAnonymous
      ? "free"
      : await getPlanTier(ctx.user.id);

    if (hasPlanFeature(planTier, "unlimited_searches")) {
      return { allowed: true };
    }

    const day = currentUtcDay();

    const [row] = await ctx.db
      .insert(searchUsage)
      .values({ userId: ctx.user.id, day, count: 1 })
      .onConflictDoUpdate({
        target: [searchUsage.userId, searchUsage.day],
        set: { count: sql`${searchUsage.count} + 1` },
      })
      .returning({ count: searchUsage.count });

    const searchesUsed = row?.count ?? 1;
    const outcome = evaluateSearchQuota(searchesUsed);

    return { allowed: outcome.allowed };
  }),
});
