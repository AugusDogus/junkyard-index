import { and, eq, inArray } from "drizzle-orm";
import { db } from "~/lib/db";
import { sendDiscordAlert } from "~/lib/discord";
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
  claimDiscordNotificationIntents,
  claimEmailNotificationIntentGroup,
} from "./notification-intent-claim";
import { parseNotificationIntentPayload } from "./notification-intent-payload";

const DELIVERY_BATCH_SIZE = 20;
const DELIVERY_LEASE_MS = 15 * 60 * 1000;

function claimedGroup(intents: readonly ClaimedNotificationIntent[]) {
  const claimToken = intents[0]?.claimToken;
  if (typeof claimToken !== "string" || intents.length === 0) {
    throw new Error("Cannot update an empty or unclaimed notification group.");
  }
  for (const intent of intents) {
    if (intent.claimToken !== claimToken || intent.status !== "sending") {
      throw new Error(
        `Notification intent ${intent.id} does not share the active group claim.`,
      );
    }
  }
  return {
    claimToken,
    ids: intents.map(({ id }) => id),
    attempts: Math.max(...intents.map(({ attempts }) => attempts)),
  };
}

const operations: DurableAlertDeliveryOperations = {
  deliveryBatchSize: DELIVERY_BATCH_SIZE,
  claimEmailGroup: () => {
    const now = new Date();
    return claimEmailNotificationIntentGroup({
      database: db,
      now,
      leaseMs: DELIVERY_LEASE_MS,
      claimToken: crypto.randomUUID(),
    });
  },
  claimDiscordBatch: () => {
    const now = new Date();
    return claimDiscordNotificationIntents({
      database: db,
      now,
      leaseMs: DELIVERY_LEASE_MS,
      batchSize: DELIVERY_BATCH_SIZE,
      claimToken: crypto.randomUUID(),
    });
  },
  loadTarget: async (savedSearchId) => {
    const [target] = await db
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
      .where(eq(savedSearch.id, savedSearchId))
      .limit(1);
    return target ?? null;
  },
  parsePayload: parseNotificationIntentPayload,
  hasAlertEntitlement: async (userId) => {
    const tier = await getAuthoritativePlanTier(userId);
    return hasPlanFeature(tier, "alerts");
  },
  sendEmailDigest,
  sendDiscordAlert,
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
    await db
      .update(searchNotificationIntent)
      .set({
        status: "delivered",
        deliveredAt: new Date(),
        claimToken: null,
        lastError: null,
      })
      .where(
        and(
          inArray(searchNotificationIntent.id, claim.ids),
          eq(searchNotificationIntent.status, "sending"),
          eq(searchNotificationIntent.claimToken, claim.claimToken),
        ),
      );
  },
};

export function deliverDurableAlertIntentsBatch() {
  return deliverDurableAlertIntentBatch(operations);
}
