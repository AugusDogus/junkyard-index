import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { filtersSchema } from "~/lib/saved-search-filters";
import { polarClient } from "~/lib/auth";
import posthog from "~/lib/posthog-server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { savedSearch, user } from "~/schema";

export const savedSearchesRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const searches = await ctx.db
      .select()
      .from(savedSearch)
      .where(eq(savedSearch.userId, ctx.user.id))
      .orderBy(savedSearch.createdAt);

    return searches.map((s) => {
      let filters: z.infer<typeof filtersSchema>;
      try {
        filters = filtersSchema.parse(JSON.parse(s.filters));
      } catch (err) {
        console.error(
          `Invalid filters for saved search ${s.id}, using empty`,
          err,
        );
        filters = {};
      }
      return { ...s, filters };
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        query: z.string(),
        filters: filtersSchema,
        emailAlertsEnabled: z.boolean().optional(),
        discordAlertsEnabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const now = new Date();
      const alertsEnabled =
        (input.emailAlertsEnabled ?? false) ||
        (input.discordAlertsEnabled ?? false);

      await ctx.db.insert(savedSearch).values({
        id,
        userId: ctx.user.id,
        name: input.name,
        query: input.query,
        filters: JSON.stringify(input.filters),
        emailAlertsEnabled: input.emailAlertsEnabled ?? false,
        discordAlertsEnabled: input.discordAlertsEnabled ?? false,
        lastCheckedAt: alertsEnabled ? now : null,
        createdAt: now,
        updatedAt: now,
      });

      posthog.capture({
        distinctId: ctx.user.id,
        event: "saved_search_created",
        properties: {
          search_id: id,
          search_name: input.name,
          query: input.query,
          has_query: input.query.trim().length > 0,
          query_length: input.query.trim().length,
          email_alerts_enabled: input.emailAlertsEnabled ?? false,
          discord_alerts_enabled: input.discordAlertsEnabled ?? false,
          has_makes_filter: (input.filters.makes?.length ?? 0) > 0,
          has_colors_filter: (input.filters.colors?.length ?? 0) > 0,
          has_states_filter: (input.filters.states?.length ?? 0) > 0,
          has_yards_filter: (input.filters.salvageYards?.length ?? 0) > 0,
          has_sources_filter: (input.filters.sources?.length ?? 0) > 0,
        },
      });

      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(savedSearch)
        .where(
          and(
            eq(savedSearch.id, input.id),
            eq(savedSearch.userId, ctx.user.id),
          ),
        );

      posthog.capture({
        distinctId: ctx.user.id,
        event: "saved_search_deleted",
        properties: {
          search_id: input.id,
        },
      });

      return { success: true };
    }),

  toggleEmailAlerts: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [existingSavedSearch] = await ctx.db
        .select({
          emailAlertsEnabled: savedSearch.emailAlertsEnabled,
          discordAlertsEnabled: savedSearch.discordAlertsEnabled,
        })
        .from(savedSearch)
        .where(
          and(
            eq(savedSearch.id, input.id),
            eq(savedSearch.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!existingSavedSearch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Saved search not found",
        });
      }

      // If enabling alerts, verify user has an active subscription
      if (input.enabled) {
        try {
          const customerState = await polarClient.customers.getStateExternal({
            externalId: ctx.user.id,
          });
          if (customerState.activeSubscriptions.length === 0) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "An active subscription is required to enable email alerts",
            });
          }
        } catch (error) {
          // If it's already a TRPCError, rethrow it
          if (error instanceof TRPCError) {
            throw error;
          }
          // Otherwise, treat as no subscription (customer not found, etc.)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "An active subscription is required to enable email alerts",
          });
        }
      }

      const hadAnyAlerts =
        existingSavedSearch.emailAlertsEnabled ||
        existingSavedSearch.discordAlertsEnabled;
      const shouldSetLastCheckedAt = input.enabled && !hadAnyAlerts;

      await ctx.db
        .update(savedSearch)
        .set({
          emailAlertsEnabled: input.enabled,
          ...(shouldSetLastCheckedAt && { lastCheckedAt: new Date() }),
        })
        .where(
          and(
            eq(savedSearch.id, input.id),
            eq(savedSearch.userId, ctx.user.id),
          ),
        );

      posthog.capture({
        distinctId: ctx.user.id,
        event: "saved_search_email_alerts_toggled",
        properties: {
          search_id: input.id,
          enabled: input.enabled,
        },
      });

      return { success: true };
    }),

  toggleDiscordAlerts: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [existingSavedSearch] = await ctx.db
        .select({
          emailAlertsEnabled: savedSearch.emailAlertsEnabled,
          discordAlertsEnabled: savedSearch.discordAlertsEnabled,
        })
        .from(savedSearch)
        .where(
          and(
            eq(savedSearch.id, input.id),
            eq(savedSearch.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!existingSavedSearch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Saved search not found",
        });
      }

      // If enabling alerts, verify user has an active subscription and Discord setup
      if (input.enabled) {
        // Check subscription
        try {
          const customerState = await polarClient.customers.getStateExternal({
            externalId: ctx.user.id,
          });
          if (customerState.activeSubscriptions.length === 0) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "An active subscription is required to enable Discord alerts",
            });
          }
        } catch (error) {
          if (error instanceof TRPCError) {
            throw error;
          }
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "An active subscription is required to enable Discord alerts",
          });
        }

        // Check Discord setup
        const [userData] = await ctx.db
          .select({
            discordId: user.discordId,
            discordAppInstalled: user.discordAppInstalled,
          })
          .from(user)
          .where(eq(user.id, ctx.user.id))
          .limit(1);

        if (!userData?.discordId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Please sign in with Discord first to link your account",
          });
        }
        if (!userData.discordAppInstalled) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Please install the Discord app from Settings to receive DMs",
          });
        }
      }

      const hadAnyAlerts =
        existingSavedSearch.emailAlertsEnabled ||
        existingSavedSearch.discordAlertsEnabled;
      const shouldSetLastCheckedAt = input.enabled && !hadAnyAlerts;

      await ctx.db
        .update(savedSearch)
        .set({
          discordAlertsEnabled: input.enabled,
          ...(shouldSetLastCheckedAt && { lastCheckedAt: new Date() }),
        })
        .where(
          and(
            eq(savedSearch.id, input.id),
            eq(savedSearch.userId, ctx.user.id),
          ),
        );

      posthog.capture({
        distinctId: ctx.user.id,
        event: "saved_search_discord_alerts_toggled",
        properties: {
          search_id: input.id,
          enabled: input.enabled,
        },
      });

      return { success: true };
    }),
});
