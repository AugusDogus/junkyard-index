import { and, eq, inArray } from "drizzle-orm";
import { db } from "~/lib/db";
import { sendDiscordAlerts } from "~/lib/discord";
import { sendEmailDigest } from "~/lib/email";
import { hasPlanFeature } from "~/lib/plans";
import { savedSearch, searchNotificationIntent, user } from "~/schema";
import { getAuthoritativePlanTier } from "~/server/billing/user-plan";
import {
  deliverDurableAlertIntentBatch,
  type ClaimedNotificationIntent,
  type DurableAlertDeliveryOperations,
} from "./durable-alert-delivery";
import {
  cancelClaimedNotificationIntents,
  claimNotificationIntentGroup,
  markNotificationGroupDelivered,
} from "./notification-intent-claim";
import { parseNotificationIntentPayload } from "./notification-intent-payload";

const DELIVERY_LEASE_MS = 15 * 60 * 1000;

function claimedGroup(intents: readonly ClaimedNotificationIntent[]) {
  const first = intents[0];
  const claimToken = first?.claimToken;
  if (
    !first ||
    typeof claimToken !== "string" ||
    (first.channel !== "email" && first.channel !== "discord")
  ) {
    throw new Error("Cannot update an empty or unclaimed notification group.");
  }
  for (const intent of intents) {
    if (
      intent.claimToken !== claimToken ||
      intent.status !== "sending" ||
      intent.userId !== first.userId ||
      intent.channel !== first.channel
    ) {
      throw new Error(
        `Notification intent ${intent.id} does not share the active group claim.`,
      );
    }
  }
  return {
    claimToken,
    userId: first.userId,
    channel: first.channel,
    ids: intents.map(({ id }) => id),
    attempts: Math.max(...intents.map(({ attempts }) => attempts)),
  } as const;
}

const operations: DurableAlertDeliveryOperations = {
  claimEmailGroup: () => {
    const now = new Date();
    return claimNotificationIntentGroup({
      channel: "email",
      database: db,
      now,
      leaseMs: DELIVERY_LEASE_MS,
      claimToken: crypto.randomUUID(),
    });
  },
  claimDiscordGroup: () => {
    const now = new Date();
    return claimNotificationIntentGroup({
      channel: "discord",
      database: db,
      now,
      leaseMs: DELIVERY_LEASE_MS,
      claimToken: crypto.randomUUID(),
    });
  },
  loadTargets: async (savedSearchIds) => {
    if (savedSearchIds.length === 0) return [];
    return db
      .select({
        searchId: savedSearch.id,
        userId: savedSearch.userId,
        searchMatchVersion: savedSearch.searchMatchVersion,
        emailConfigVersion: savedSearch.emailConfigVersion,
        discordConfigVersion: savedSearch.discordConfigVersion,
        emailAlertsEnabled: savedSearch.emailAlertsEnabled,
        discordAlertsEnabled: savedSearch.discordAlertsEnabled,
        emailStartSequence: savedSearch.emailStartSequence,
        discordStartSequence: savedSearch.discordStartSequence,
        email: user.email,
        discordId: user.discordId,
        discordAppInstalled: user.discordAppInstalled,
      })
      .from(savedSearch)
      .innerJoin(user, eq(user.id, savedSearch.userId))
      .where(inArray(savedSearch.id, savedSearchIds));
  },
  parsePayload: parseNotificationIntentPayload,
  hasAlertEntitlement: async (userId) => {
    const tier = await getAuthoritativePlanTier(userId);
    return hasPlanFeature(tier, "alerts");
  },
  sendEmailDigest,
  sendDiscordAlerts,
  cancelIntents: async (intents, reason) => {
    const claim = claimedGroup(intents);
    await cancelClaimedNotificationIntents({
      database: db,
      intentIds: claim.ids,
      claimToken: claim.claimToken,
      reason,
    });
  },
  retryIntents: async (intents, error) => {
    const claim = claimedGroup(intents);
    const delayMs = Math.min(
      24 * 60 * 60 * 1000,
      60 * 60 * 1000 * 2 ** Math.min(5, claim.attempts),
    );
    await db
      .update(searchNotificationIntent)
      .set({
        status: "retry",
        claimToken: null,
        lastError: error,
        nextAttemptAt: new Date(Date.now() + delayMs),
      })
      .where(
        and(
          inArray(searchNotificationIntent.id, claim.ids),
          eq(searchNotificationIntent.status, "sending"),
          eq(searchNotificationIntent.claimToken, claim.claimToken),
        ),
      );
  },
  markDelivered: async (intents) => {
    const claim = claimedGroup(intents);
    await markNotificationGroupDelivered({
      database: db,
      userId: claim.userId,
      channel: claim.channel,
      intentIds: claim.ids,
      claimToken: claim.claimToken,
      now: new Date(),
    });
  },
};

export function deliverDurableAlertIntentsBatch() {
  return deliverDurableAlertIntentBatch(operations);
}
