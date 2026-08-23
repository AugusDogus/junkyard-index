import type { AlertChannel } from "./alert-config-repository";

export interface NotificationIntentPolicyInput {
  channel: AlertChannel;
  publicationSequence: number;
  searchMatchVersion: number;
  channelConfigVersion: number;
}

export interface NotificationTargetPolicyInput {
  searchMatchVersion: number;
  emailConfigVersion: number;
  discordConfigVersion: number;
  emailAlertsEnabled: boolean;
  discordAlertsEnabled: boolean;
  emailStartSequence: number;
  discordStartSequence: number;
  discordReady: boolean;
}

export type NotificationIntentPolicyResult =
  | { status: "eligible" }
  | {
      status: "cancel";
      reason: "search_match_version_changed" | "channel_no_longer_eligible";
    };

export function evaluateNotificationIntent(
  intent: NotificationIntentPolicyInput,
  target: NotificationTargetPolicyInput,
): NotificationIntentPolicyResult {
  if (target.searchMatchVersion !== intent.searchMatchVersion) {
    return { status: "cancel", reason: "search_match_version_changed" };
  }
  const channelEligible =
    intent.channel === "email"
      ? target.emailAlertsEnabled &&
        target.emailConfigVersion === intent.channelConfigVersion &&
        intent.publicationSequence > target.emailStartSequence
      : target.discordAlertsEnabled &&
        target.discordConfigVersion === intent.channelConfigVersion &&
        intent.publicationSequence > target.discordStartSequence &&
        target.discordReady;
  return channelEligible
    ? { status: "eligible" }
    : { status: "cancel", reason: "channel_no_longer_eligible" };
}
