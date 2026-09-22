import type { NotificationDeliveryResult } from "~/lib/notification-delivery-result";
import {
  SearchAlertDigest,
  combineSearchAlerts,
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
  | "alert_entitlement_missing";

export interface DurableAlertDeliveryOperations {
  claimEmailGroup(): Promise<ClaimedNotificationIntent[]>;
  claimDiscordGroup(): Promise<ClaimedNotificationIntent[]>;
  loadTargets(
    savedSearchIds: readonly string[],
  ): Promise<readonly NotificationIntentTarget[]>;
  parsePayload(payload: string): SearchAlertData;
  hasAlertEntitlement(userId: string): Promise<boolean>;
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
  target: NotificationIntentTarget | undefined,
  operations: DurableAlertDeliveryOperations,
): Promise<EligibleIntent | null> {
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

async function retainAlertEntitledIntents(
  eligible: readonly EligibleIntent[],
  operations: DurableAlertDeliveryOperations,
): Promise<boolean> {
  const first = eligible[0];
  if (!first) return false;
  try {
    if (await operations.hasAlertEntitlement(first.intent.userId)) {
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
    "alert_entitlement_missing",
  );
  return false;
}

async function deliverNotificationGroup(
  intents: readonly ClaimedNotificationIntent[],
  operations: DurableAlertDeliveryOperations,
): Promise<void> {
  requireClaimed(intents);
  const first = intents[0];
  if (!first) return;
  for (const intent of intents) {
    if (
      (intent.channel !== "email" && intent.channel !== "discord") ||
      intent.channel !== first.channel ||
      intent.userId !== first.userId ||
      !first.deliveryGroupId ||
      intent.deliveryGroupId !== first.deliveryGroupId
    ) {
      throw new Error(
        `Notification intent ${intent.id} is outside its claimed digest group.`,
      );
    }
  }

  const searchIds = [...new Set(intents.map((intent) => intent.savedSearchId))];
  const targets = new Map(
    (await operations.loadTargets(searchIds)).map((target) => [
      target.searchId,
      target,
    ]),
  );
  const eligible: EligibleIntent[] = [];
  for (const intent of [...intents].sort((a, b) => a.id.localeCompare(b.id))) {
    const item = await revalidateIntent(
      intent,
      targets.get(intent.savedSearchId),
      operations,
    );
    if (item) eligible.push(item);
  }
  if (!(await retainAlertEntitledIntents(eligible, operations))) return;
  const firstEligible = eligible[0];
  if (!firstEligible) return;

  const payloads = eligible.map(({ payload }) => payload);
  const idempotencyKey = first.deliveryGroupId;
  if (!idempotencyKey)
    throw new Error("Notification digest has no durable group ID.");
  let delivery: NotificationDeliveryResult;
  try {
    if (first.channel === "email") {
      delivery = await operations.sendEmailDigest(
        { userId: first.userId, email: firstEligible.target.email },
        SearchAlertDigest.fromAlerts(payloads),
        { idempotencyKey },
      );
    } else {
      delivery = { success: true };
      for (const alert of combineSearchAlerts(payloads)) {
        const result = await operations.sendDiscordAlert(
          firstEligible.target.discordId ?? "",
          alert,
          { idempotencyKey: `${idempotencyKey}:${alert.searchId}` },
        );
        if (!result.success) {
          delivery = result;
          break;
        }
      }
    }
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

export interface DurableAlertDeliveryBatchResult {
  status: "paused" | "complete";
  intentsProcessed: number;
}

export async function deliverDurableAlertIntentBatch(
  operations: DurableAlertDeliveryOperations,
): Promise<DurableAlertDeliveryBatchResult> {
  const emailIntents = await operations.claimEmailGroup();
  if (emailIntents.length > 0) {
    await deliverNotificationGroup(emailIntents, operations);
    return { status: "paused", intentsProcessed: emailIntents.length };
  }

  const discordIntents = await operations.claimDiscordGroup();
  if (discordIntents.length > 0) {
    await deliverNotificationGroup(discordIntents, operations);
    return { status: "paused", intentsProcessed: discordIntents.length };
  }
  return { status: "complete", intentsProcessed: 0 };
}
