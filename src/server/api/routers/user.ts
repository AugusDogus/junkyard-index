import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "~/schema";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { sendTestDM } from "~/lib/discord";
import { polarClient } from "~/lib/auth";

export const userRouter = createTRPCRouter({
  /**
   * Get the current user's notification settings and Discord status.
   */
  getNotificationSettings: protectedProcedure.query(async ({ ctx }) => {
    const [userRecord] = await ctx.db
      .select({
        discordId: schema.user.discordId,
        discordAppInstalled: schema.user.discordAppInstalled,
      })
      .from(schema.user)
      .where(eq(schema.user.id, ctx.user.id))
      .limit(1);

    if (!userRecord) {
      return {
        hasDiscordLinked: false,
        discordAppInstalled: false,
      };
    }

    let discordId = userRecord.discordId;

    // If discordId is not set on user, check if they have a Discord account linked
    // This handles users who linked Discord before we added the discordId field
    if (!discordId) {
      const [discordAccount] = await ctx.db
        .select({ accountId: schema.account.accountId })
        .from(schema.account)
        .where(and(
          eq(schema.account.userId, ctx.user.id),
          eq(schema.account.providerId, "discord")
        ))
        .limit(1);

      if (discordAccount?.accountId) {
        discordId = discordAccount.accountId;
        // Backfill the discordId on the user record for future use
        await ctx.db
          .update(schema.user)
          .set({ discordId: discordAccount.accountId })
          .where(eq(schema.user.id, ctx.user.id));
      }
    }

    // Validate that the discordId looks like a valid Discord snowflake (numeric string)
    const isValidDiscordId = discordId && /^\d+$/.test(discordId);

    return {
      hasDiscordLinked: isValidDiscordId,
      discordAppInstalled: isValidDiscordId ? userRecord.discordAppInstalled : false,
    };
  }),

  /**
   * Mark Discord app as uninstalled (user can reinstall from settings).
   */
  disconnectDiscordApp: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(schema.user)
      .set({ discordAppInstalled: false })
      .where(eq(schema.user.id, ctx.user.id));

    // Also disable Discord alerts for all saved searches
    await ctx.db
      .update(schema.savedSearch)
      .set({ discordAlertsEnabled: false })
      .where(eq(schema.savedSearch.userId, ctx.user.id));

    return { success: true };
  }),

  /**
   * Verify Discord app installation by sending a test DM.
   * If successful, marks the app as installed.
   */
  verifyDiscordAppInstalled: protectedProcedure.mutation(async ({ ctx }) => {
    // Get user's Discord ID
    const [userRecord] = await ctx.db
      .select({ discordId: schema.user.discordId })
      .from(schema.user)
      .where(eq(schema.user.id, ctx.user.id))
      .limit(1);

    let discordId = userRecord?.discordId;

    // If discordId is not set on user, check if they have a Discord account linked
    if (!discordId) {
      const [discordAccount] = await ctx.db
        .select({ accountId: schema.account.accountId })
        .from(schema.account)
        .where(and(
          eq(schema.account.userId, ctx.user.id),
          eq(schema.account.providerId, "discord")
        ))
        .limit(1);

      if (discordAccount?.accountId) {
        discordId = discordAccount.accountId;
        // Backfill the discordId on the user record for future use
        await ctx.db
          .update(schema.user)
          .set({ discordId: discordAccount.accountId })
          .where(eq(schema.user.id, ctx.user.id));
      }
    }

    if (!discordId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Please link your Discord account first by signing in with Discord.",
      });
    }

    // Check subscription status for the DM message
    let hasActiveSubscription = false;
    try {
      const customerState = await polarClient.customers.getStateExternal({
        externalId: ctx.user.id,
      });
      hasActiveSubscription = customerState.activeSubscriptions.length > 0;
    } catch {
      // Customer might not exist yet, that's fine
    }

    // Try to send a test DM
    const result = await sendTestDM(discordId, hasActiveSubscription);

    if (!result.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Could not send you a DM. Please make sure you've installed the Junkyard Index app on Discord.",
      });
    }

    // Mark as installed
    await ctx.db
      .update(schema.user)
      .set({ discordAppInstalled: true })
      .where(eq(schema.user.id, ctx.user.id));

    return { success: true };
  }),

  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    // Delete the user - cascade delete will handle sessions, accounts, and saved searches
    await ctx.db.delete(schema.user).where(eq(schema.user.id, ctx.user.id));

    return { success: true };
  }),
});
