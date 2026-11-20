import type { ConsumerMode } from "~/server/ingestion/consumer-flags";
import type { SearchAlertsMode } from "./search-alerts-flag";

/**
 * Whether notifications may go out: the consumer-notification-delivery flag
 * (missing means enabled) and the fail-closed search-alerts-enabled flag
 * must both allow it. Every delivery batch checks this, so pausing either
 * stops deliveries however the workflow was started (this cron, the daily
 * alert check, the deadline cron, or a run from an older deployment once it
 * reaches new code).
 */
export function notificationDeliveryAllowed(modes: {
  consumer: ConsumerMode;
  alerts: SearchAlertsMode;
}): boolean {
  return modes.consumer === "enabled" && modes.alerts === "enabled";
}

/** What one notification-delivery cron tick did. */
export type NotificationDeliveryTick =
  /** The consumer-notification-delivery flag paused it. */
  | { status: "paused" }
  /** search-alerts-enabled is off (or missing): alerts fail closed. */
  | { status: "alerts_disabled" }
  | { status: "idle" }
  | { status: "started" };

/**
 * Starts delivery when a notification can go out now, independent of any
 * ingestion pass or alert check, so retries, expired claims and released
 * holds go out on schedule. Both kill switches must allow it: the consumer
 * flag (missing means enabled) and the fail-closed search-alerts-enabled
 * flag. Neither paused state reads or changes an intent, so delivery resumes
 * where it stopped.
 */
export async function triggerNotificationDelivery(operations: {
  consumerMode(): Promise<ConsumerMode>;
  alertsEnabled(): Promise<boolean>;
  hasDeliverableIntents(): Promise<boolean>;
  startDelivery(): Promise<unknown>;
}): Promise<NotificationDeliveryTick> {
  if ((await operations.consumerMode()) === "paused") {
    return { status: "paused" };
  }
  if (!(await operations.alertsEnabled())) return { status: "alerts_disabled" };
  if (!(await operations.hasDeliverableIntents())) return { status: "idle" };
  await operations.startDelivery();
  return { status: "started" };
}
