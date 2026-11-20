import { IngestionDay } from "~/server/ingestion/ingestion-day";
import { hasDeliverableNotificationIntents } from "./durable-alert-delivery-runtime";
import { isDailySearchAlertCheckPending } from "./search-alert-check-runtime";

export type DailySearchAlertsTrigger =
  | "check_started"
  | "delivery_started"
  | "idle";

/**
 * Starts the day's saved-search alert check while it is pending; the check
 * delivers when done. Once it is done, only retries delivery. A past day is
 * skipped: the current day's check covers its vehicles. Callers pass the
 * workflow starts so this module stays out of the workflow bundle.
 */
export async function startDailySearchAlerts(
  day: string,
  start: {
    check(day: string): Promise<unknown>;
    delivery(): Promise<unknown>;
  },
): Promise<DailySearchAlertsTrigger> {
  if (IngestionDay.key(new Date()) !== day) return "idle";
  if (await isDailySearchAlertCheckPending(day)) {
    await start.check(day);
    return "check_started";
  }
  if (await hasDeliverableNotificationIntents()) {
    await start.delivery();
    return "delivery_started";
  }
  return "idle";
}
