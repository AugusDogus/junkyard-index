import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  filtersSchema,
  parseSavedSearchFilters,
} from "~/lib/saved-search-filters";
import {
  evaluateSavedSearchGate,
  hasPlanFeature,
  type SavedSearchGateFeature,
} from "~/lib/plans";
import posthog from "~/lib/posthog-server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PlanGateError } from "~/server/plan-gate-error";
import {
  currentSearchPublicationSequence,
  setSearchAlertChannel,
  updateSavedSearchCriteria,
} from "~/server/alerts/alert-config-repository";
import { savedSearch, user } from "~/schema";
import { getAuthoritativePlanTier as resolveAuthoritativePlanTier } from "~/server/billing/user-plan";

function planGateError(feature: SavedSearchGateFeature): PlanGateError {
  const message =
    feature === "saved_searches"
      ? "Saved searches are included in the Lite plan. Upgrade at /pricing to save searches."
      : "Email and Discord alerts are included in the Full plan. Upgrade at /pricing to enable alerts.";
  return new PlanGateError(feature, message);
}

async function getAuthoritativePlanTier(userId: string) {
  try {
    return await resolveAuthoritativePlanTier(userId);
  } catch (cause) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Subscription status could not be verified. No changes were made. Please try again.",
      cause,
    });
  }
}

export const savedSearchesRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const searches = await ctx.db
      .select()
      .from(savedSearch)
      .where(eq(savedSearch.userId, ctx.user.id))
      .orderBy(savedSearch.createdAt);

    return searches.map((s) => {
      let filters: z.infer<typeof filtersSchema>;
      const parsedFilters = parseSavedSearchFilters(s.filters);
      if (parsedFilters.success) {
        filters = parsedFilters.data;
      } else {
        console.error(
          `Invalid filters for saved search ${s.id}, using empty`,
          parsedFilters.error,
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
      const planTier = await getAuthoritativePlanTier(ctx.user.id);
      const wantsAlerts =
        (input.emailAlertsEnabled ?? false) ||
        (input.discordAlertsEnabled ?? false);
      const blockedGate = evaluateSavedSearchGate(planTier, wantsAlerts);
      if (blockedGate) {
        throw planGateError(blockedGate);
      }

      const id = crypto.randomUUID();
      const now = new Date();
      const alertsEnabled =
        (input.emailAlertsEnabled ?? false) ||
        (input.discordAlertsEnabled ?? false);
      const publicationSequence = await currentSearchPublicationSequence(
        ctx.db,
      );

      await ctx.db.insert(savedSearch).values({
        id,
        userId: ctx.user.id,
        name: input.name,
        query: input.query,
        filters: JSON.stringify(input.filters),
        emailAlertsEnabled: input.emailAlertsEnabled ?? false,
        discordAlertsEnabled: input.discordAlertsEnabled ?? false,
        emailStartSequence: publicationSequence,
        discordStartSequence: publicationSequence,
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

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100),
        query: z.string(),
        filters: filtersSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const planTier = await getAuthoritativePlanTier(ctx.user.id);
      if (!hasPlanFeature(planTier, "saved_searches")) {
        throw planGateError("saved_searches");
      }

      const updated = await updateSavedSearchCriteria({
        database: ctx.db,
        searchId: input.id,
        userId: ctx.user.id,
        name: input.name,
        query: input.query,
        filters: JSON.stringify(input.filters),
      });
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Saved search could not be updated because it no longer exists. No changes were made.",
        });
      }

      posthog.capture({
        distinctId: ctx.user.id,
        event: "saved_search_updated",
        properties: {
          search_id: input.id,
          has_query: input.query.trim().length > 0,
          has_makes_filter: (input.filters.makes?.length ?? 0) > 0,
          has_colors_filter: (input.filters.colors?.length ?? 0) > 0,
          has_states_filter: (input.filters.states?.length ?? 0) > 0,
          has_yards_filter: (input.filters.salvageYards?.length ?? 0) > 0,
          has_sources_filter: (input.filters.sources?.length ?? 0) > 0,
        },
      });

      return { success: true };
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

      if (input.enabled) {
        const planTier = await getAuthoritativePlanTier(ctx.user.id);
        if (!hasPlanFeature(planTier, "alerts")) {
          throw planGateError("alerts");
        }
      }

      await setSearchAlertChannel({
        database: ctx.db,
        searchId: input.id,
        userId: ctx.user.id,
        channel: "email",
        enabled: input.enabled,
      });

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

      if (input.enabled) {
        const planTier = await getAuthoritativePlanTier(ctx.user.id);
        if (!hasPlanFeature(planTier, "alerts")) {
          throw planGateError("alerts");
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

      await setSearchAlertChannel({
        database: ctx.db,
        searchId: input.id,
        userId: ctx.user.id,
        channel: "discord",
        enabled: input.enabled,
      });

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
