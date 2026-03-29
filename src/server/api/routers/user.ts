import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as schema from "~/schema";
import {
  normalizeZipCode,
  isLocationPreferenceMode,
} from "~/lib/location-preferences";
import posthog from "~/lib/posthog-server";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { sendTestDM } from "~/lib/discord";
import { polarClient } from "~/lib/auth";

async function resolveZipCode(zipCode: string) {
  const normalizedZipCode = normalizeZipCode(zipCode);
  if (!normalizedZipCode) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter a valid 5-digit US ZIP code.",
    });
  }

  try {
    const response = await fetch(
      `https://api.zippopotam.us/us/${normalizedZipCode}`,
      {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json" },
      },
    );

    if (response.status === 404) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Enter a valid 5-digit US ZIP code.",
      });
    }

    if (!response.ok) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not verify that ZIP code right now.",
      });
    }

    const data = (await response.json()) as {
      places?: Array<{
        latitude?: string;
        longitude?: string;
        "place name"?: string;
        state?: string;
        "state abbreviation"?: string;
      }>;
    };

    const place = data.places?.[0];
    const lat = place?.latitude
      ? Number.parseFloat(place.latitude)
      : Number.NaN;
    const lng = place?.longitude
      ? Number.parseFloat(place.longitude)
      : Number.NaN;

    if (!place || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not verify that ZIP code right now.",
      });
    }

    return {
      zipCode: normalizedZipCode,
      lat,
      lng,
      city: place["place name"] ?? "",
      state: place.state ?? "",
      stateAbbr: place["state abbreviation"] ?? "",
      label: [place["place name"], place["state abbreviation"]]
        .filter(Boolean)
        .join(", "),
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not verify that ZIP code right now.",
    });
  }
}

function toLocationPreference(
  userRecord:
    | {
        locationPreferenceMode: string | null;
        locationZipCode: string | null;
        locationLat: number | null;
        locationLng: number | null;
      }
    | undefined,
) {
  const mode = isLocationPreferenceMode(userRecord?.locationPreferenceMode)
    ? userRecord.locationPreferenceMode
    : null;

  return {
    hasPreference: mode !== null,
    mode,
    zipCode: mode === "zip" ? (userRecord?.locationZipCode ?? null) : null,
    lat: mode === "zip" ? (userRecord?.locationLat ?? null) : null,
    lng: mode === "zip" ? (userRecord?.locationLng ?? null) : null,
  };
}

export const userRouter = createTRPCRouter({
  getLocationPreference: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      return {
        hasPreference: false,
        mode: null,
        zipCode: null,
        lat: null,
        lng: null,
      };
    }

    const [userRecord] = await ctx.db
      .select({
        locationPreferenceMode: schema.user.locationPreferenceMode,
        locationZipCode: schema.user.locationZipCode,
        locationLat: schema.user.locationLat,
        locationLng: schema.user.locationLng,
      })
      .from(schema.user)
      .where(eq(schema.user.id, ctx.user.id))
      .limit(1);

    return toLocationPreference(userRecord);
  }),

  resolveZipCode: publicProcedure
    .input(z.object({ zipCode: z.string() }))
    .mutation(async ({ input }) => resolveZipCode(input.zipCode)),

  updateLocationPreference: protectedProcedure
    .input(
      z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("auto") }),
        z.object({ mode: z.literal("zip"), zipCode: z.string() }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.mode === "auto") {
        await ctx.db
          .update(schema.user)
          .set({
            locationPreferenceMode: "auto",
            locationZipCode: null,
            locationLat: null,
            locationLng: null,
          })
          .where(eq(schema.user.id, ctx.user.id));

        return {
          hasPreference: true,
          mode: "auto" as const,
          zipCode: null,
          lat: null,
          lng: null,
        };
      }

      const resolved = await resolveZipCode(input.zipCode);

      await ctx.db
        .update(schema.user)
        .set({
          locationPreferenceMode: "zip",
          locationZipCode: resolved.zipCode,
          locationLat: resolved.lat,
          locationLng: resolved.lng,
        })
        .where(eq(schema.user.id, ctx.user.id));

      return {
        hasPreference: true,
        mode: "zip" as const,
        zipCode: resolved.zipCode,
        lat: resolved.lat,
        lng: resolved.lng,
        city: resolved.city,
        state: resolved.state,
        stateAbbr: resolved.stateAbbr,
        label: resolved.label,
      };
    }),

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
        .where(
          and(
            eq(schema.account.userId, ctx.user.id),
            eq(schema.account.providerId, "discord"),
          ),
        )
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
      discordAppInstalled: isValidDiscordId
        ? userRecord.discordAppInstalled
        : false,
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

    posthog.capture({
      distinctId: ctx.user.id,
      event: "discord_app_disconnected",
    });

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
        .where(
          and(
            eq(schema.account.userId, ctx.user.id),
            eq(schema.account.providerId, "discord"),
          ),
        )
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
        message:
          "Please link your Discord account first by signing in with Discord.",
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
      posthog.capture({
        distinctId: ctx.user.id,
        event: "discord_app_verify_failed",
        properties: { reason: "dm_failed" },
      });
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Could not send you a DM. Please make sure you've installed the Junkyard Index app on Discord.",
      });
    }

    // Mark as installed
    await ctx.db
      .update(schema.user)
      .set({ discordAppInstalled: true })
      .where(eq(schema.user.id, ctx.user.id));

    posthog.capture({
      distinctId: ctx.user.id,
      event: "discord_app_verified",
    });

    return { success: true };
  }),

  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    posthog.capture({
      distinctId: ctx.user.id,
      event: "account_deleted",
    });

    // Delete the user - cascade delete will handle sessions, accounts, and saved searches
    await ctx.db.delete(schema.user).where(eq(schema.user.id, ctx.user.id));

    return { success: true };
  }),
});
