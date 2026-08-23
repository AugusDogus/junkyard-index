import type { NotificationDeliveryResult } from "~/lib/notification-delivery-result";
import {
  MAX_SEARCH_ALERT_DIGEST_PREVIEWS,
  SearchAlertDigest,
  type SearchAlertData,
} from "~/lib/search-alert-data";
import type { searchNotificationIntent } from "~/schema";
import { evaluateNotificationIntent } from "./notification-intent-policy";

export type ClaimedNotificationIntent =
  typeof searchNotificationIntent.$inferSelect;

export interface NotificationIntentTarget {
  searchId: string;
  userId: string;
  searchMatchVersion: number;
  emailConfigVersion: number;
  discordConfigVersion: number;
  emailAlertsEnabled: boolean;
  discordAlertsEnabled: boolean;
  emailStartSequence: number;
  discordStartSequence: number;
  email: string;
  discordId: string | null;
  discordAppInstalled: boolean;
}

type IntentCancellationReason =
  | "saved_search_deleted"
  | "saved_search_owner_changed"
  | "unknown_channel"
  | "search_match_version_changed"
  | "channel_no_longer_eligible"
  | "invalid_intent_payload"
  | "subscription_inactive";

export interface DurableAlertDeliveryOperations {
  deliveryBatchSize: number;
  claimEmailGroup(): Promise<ClaimedNotificationIntent[]>;
  claimDiscordBatch(): Promise<ClaimedNotificationIntent[]>;
  loadTarget(savedSearchId: string): Promise<NotificationIntentTarget | null>;
  parsePayload(payload: string): SearchAlertData;
  hasActiveSubscription(userId: string): Promise<boolean>;
  sendEmailDigest(
    recipient: { userId: string; email: string },
    digest: SearchAlertDigest,
    options: { idempotencyKey: string },
  ): Promise<NotificationDeliveryResult>;
  sendDiscordAlert(
    discordUserId: string,
    alert: SearchAlertData,
    options: { idempotencyKey: string },
  ): Promise<NotificationDeliveryResult>;
  cancelIntents(
    intents: readonly ClaimedNotificationIntent[],
    reason: IntentCancellationReason,
  ): Promise<void>;
  retryIntents(
    intents: readonly ClaimedNotificationIntent[],
    error: string,
  ): Promise<void>;
  markDelivered(intents: readonly ClaimedNotificationIntent[]): Promise<void>;
}

interface EligibleIntent {
  intent: ClaimedNotificationIntent;
  target: NotificationIntentTarget;
  payload: SearchAlertData;
}

function deliveryError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "notification_delivery_failed";
}

function requireClaimed(intents: readonly ClaimedNotificationIntent[]): string {
  const claimToken = intents[0]?.claimToken;
  if (typeof claimToken !== "string") {
    throw new Error("Cannot deliver an empty or unclaimed notification group.");
  }
  for (const intent of intents) {
    if (intent.claimToken !== claimToken || intent.status !== "sending") {
      throw new Error(
        `Notification intent ${intent.id} does not share the active group claim.`,
      );
    }
  }
  return claimToken;
}

async function revalidateIntent(
  intent: ClaimedNotificationIntent,
  operations: DurableAlertDeliveryOperations,
): Promise<EligibleIntent | null> {
  const target = await operations.loadTarget(intent.savedSearchId);
  if (!target) {
    await operations.cancelIntents([intent], "saved_search_deleted");
    return null;
  }
  if (target.userId !== intent.userId) {
    await operations.cancelIntents([intent], "saved_search_owner_changed");
    return null;
  }
  if (intent.channel !== "email" && intent.channel !== "discord") {
    await operations.cancelIntents([intent], "unknown_channel");
    return null;
  }
  const policy = evaluateNotificationIntent(
    {
      channel: intent.channel,
      publicationSequence: intent.publicationSequence,
      searchMatchVersion: intent.searchMatchVersion,
      channelConfigVersion: intent.channelConfigVersion,
    },
    {
      searchMatchVersion: target.searchMatchVersion,
      emailConfigVersion: target.emailConfigVersion,
      discordConfigVersion: target.discordConfigVersion,
      emailAlertsEnabled: target.emailAlertsEnabled,
      discordAlertsEnabled: target.discordAlertsEnabled,
      emailStartSequence: target.emailStartSequence,
      discordStartSequence: target.discordStartSequence,
      discordReady: target.discordAppInstalled && target.discordId !== null,
    },
  );
  if (policy.status === "cancel") {
    await operations.cancelIntents([intent], policy.reason);
    return null;
  }

  try {
    return {
      intent,
      target,
      payload: operations.parsePayload(intent.payload),
    };
  } catch {
    await operations.cancelIntents([intent], "invalid_intent_payload");
    return null;
  }
}

async function retainSubscribedIntents(
  eligible: readonly EligibleIntent[],
  operations: DurableAlertDeliveryOperations,
): Promise<boolean> {
  const first = eligible[0];
  if (!first) return false;
  try {
    if (await operations.hasActiveSubscription(first.intent.userId)) {
      return true;
    }
  } catch (error) {
    await operations.retryIntents(
      eligible.map(({ intent }) => intent),
      deliveryError(error),
    );
    return false;
  }
  await operations.cancelIntents(
    eligible.map(({ intent }) => intent),
    "subscription_inactive",
  );
  return false;
}

async function deliverEmailGroup(
  intents: readonly ClaimedNotificationIntent[],
  operations: DurableAlertDeliveryOperations,
): Promise<void> {
  requireClaimed(intents);
  const first = intents[0];
  if (!first) return;
  for (const intent of intents) {
    if (
      intent.channel !== "email" ||
      intent.runId !== first.runId ||
      intent.userId !== first.userId ||
      intent.publicationSequence !== first.publicationSequence
    ) {
      throw new Error(
        `Email notification intent ${intent.id} is outside its claimed digest group.`,
      );
    }
  }

  const eligible: EligibleIntent[] = [];
  for (const intent of intents) {
    const item = await revalidateIntent(intent, operations);
    if (item) eligible.push(item);
  }
  if (!(await retainSubscribedIntents(eligible, operations))) return;
  const firstEligible = eligible[0];
  if (!firstEligible) return;

  const previewAlerts = eligible
    .slice(0, MAX_SEARCH_ALERT_DIGEST_PREVIEWS)
    .map(({ payload }) => payload);
  const digest = SearchAlertDigest.create(
    previewAlerts,
    eligible.length,
    eligible.reduce((count, item) => count + item.payload.match.count, 0),
  );
  let delivery: NotificationDeliveryResult;
  try {
    delivery = await operations.sendEmailDigest(
      { userId: first.userId, email: firstEligible.target.email },
      digest,
      {
        idempotencyKey: `email:${first.runId}:${first.publicationSequence}:${first.userId}`,
      },
    );
  } catch (error) {
    delivery = { success: false, error: deliveryError(error) };
  }
  const eligibleIntents = eligible.map(({ intent }) => intent);
  if (!delivery.success) {
    await operations.retryIntents(eligibleIntents, delivery.error);
    return;
  }
  await operations.markDelivered(eligibleIntents);
}

async function deliverDiscordIntent(
  intent: ClaimedNotificationIntent,
  operations: DurableAlertDeliveryOperations,
): Promise<void> {
  requireClaimed([intent]);
  const eligible = await revalidateIntent(intent, operations);
  if (!eligible) return;
  if (!(await retainSubscribedIntents([eligible], operations))) return;

  let delivery: NotificationDeliveryResult;
  try {
    delivery = await operations.sendDiscordAlert(
      eligible.target.discordId ?? "",
      eligible.payload,
      { idempotencyKey: intent.id },
    );
  } catch (error) {
    delivery = { success: false, error: deliveryError(error) };
  }
  if (!delivery.success) {
    await operations.retryIntents([intent], delivery.error);
    return;
  }
  await operations.markDelivered([intent]);
}

export interface DurableAlertDeliveryBatchResult {
  status: "paused" | "complete";
  intentsProcessed: number;
}

export async function deliverDurableAlertIntentBatch(
  operations: DurableAlertDeliveryOperations,
): Promise<DurableAlertDeliveryBatchResult> {
  const emailIntents = await operations.claimEmailGroup();
  if (emailIntents.length > 0) {
    await deliverEmailGroup(emailIntents, operations);
    return { status: "paused", intentsProcessed: emailIntents.length };
  }

  const discordIntents = await operations.claimDiscordBatch();
  for (const intent of discordIntents) {
    await deliverDiscordIntent(intent, operations);
  }
  return {
    status:
      discordIntents.length < operations.deliveryBatchSize
        ? "complete"
        : "paused",
    intentsProcessed: discordIntents.length,
  };
}
