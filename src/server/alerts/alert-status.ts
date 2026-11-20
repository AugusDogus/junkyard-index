import { desc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { searchAlertCheck } from "~/schema";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import { oldestDeliverableNotificationIntentAt } from "./notification-intent-claim";
import { SearchAlertSchedule } from "./search-alert-schedule";
import type { SearchAlertsMode } from "./search-alerts-flag";

/**
 * A deliverable notification waiting longer than this means delivery is not
 * running: the notification-delivery cron starts it every 15 minutes.
 */
export const DELIVERY_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

// Today's check is expected finished this long after it stops counting as
// stuck (the deadline plus SearchAlertSchedule.staleAfterMs).
const CHECK_GRACE_MS = 60 * 60 * 1000;

function previousDay(now: Date): string {
  return IngestionDay.key(new Date(IngestionDay.start(now).getTime() - 1));
}

export type AlertStatusInputs = {
  mode: SearchAlertsMode;
  /** The latest day whose alert check completed, if any. */
  lastCompletedDay: string | null;
  /** Of yesterday and today, the days whose alert check was opened. */
  openedDays: string[];
  /** When the longest-waiting deliverable notification became due. */
  oldestDeliverableAt: Date | null;
};

export type AlertStatus =
  | { status: "paused"; lastCompletedDay: string | null }
  | {
      status: "healthy" | "unhealthy";
      lastCompletedDay: string | null;
      /** Null while no check is expected (alerts were paused yesterday). */
      expectedDay: string | null;
      oldestDeliverableAt: string | null;
      problems: string[];
    };

export const AlertStatus = {
  async load(
    database: LibSQLDatabase,
    now: Date,
    mode: SearchAlertsMode,
    leaseMs: number,
  ): Promise<AlertStatusInputs> {
    const today = IngestionDay.key(now);
    const yesterday = previousDay(now);
    const [[check], opened, oldestDeliverableAt] = await Promise.all([
      database
        .select({ day: searchAlertCheck.day })
        .from(searchAlertCheck)
        .where(eq(searchAlertCheck.status, "complete"))
        .orderBy(desc(searchAlertCheck.day))
        .limit(1),
      database
        .select({ day: searchAlertCheck.day })
        .from(searchAlertCheck)
        .where(inArray(searchAlertCheck.day, [yesterday, today])),
      mode === "enabled"
        ? oldestDeliverableNotificationIntentAt({ database, now, leaseMs })
        : Promise.resolve(null),
    ]);
    return {
      mode,
      lastCompletedDay: check?.day ?? null,
      openedDays: opened.map((row) => row.day).sort(),
      oldestDeliverableAt,
    };
  },

  /**
   * Alerts are healthy while the latest alert check is no older than expected
   * (yesterday's until today's is overdue, then today's) and no deliverable
   * notification has waited too long. Paused alerts (the fail-closed
   * search-alerts-enabled flag) are reported, not judged.
   */
  evaluate(inputs: AlertStatusInputs, now: Date): AlertStatus {
    if (inputs.mode === "disabled") {
      return { status: "paused", lastCompletedDay: inputs.lastCompletedDay };
    }
    const today = IngestionDay.key(now);
    const graceStart = new Date(now.getTime() - CHECK_GRACE_MS);
    const todayOverdue =
      IngestionDay.key(graceStart) === today &&
      SearchAlertSchedule.isPastMissingCheckGrace(graceStart);
    // Today's check must exist once it is overdue: the deadline cron opens
    // it. Yesterday's is expected only if it was opened, since no check opens
    // while alerts are paused.
    const yesterday = previousDay(now);
    const expectedDay = todayOverdue
      ? today
      : inputs.openedDays.includes(yesterday)
        ? yesterday
        : null;
    const problems: string[] = [];
    if (
      expectedDay !== null &&
      (inputs.lastCompletedDay === null ||
        inputs.lastCompletedDay < expectedDay)
    ) {
      problems.push(
        `No saved-search alert check has completed for ${expectedDay} (last completed: ${inputs.lastCompletedDay ?? "none"}). Check the search-alerts cron and the searchAlertCheckWorkflow runs.`,
      );
    }
    if (
      inputs.oldestDeliverableAt !== null &&
      now.getTime() - inputs.oldestDeliverableAt.getTime() >
        DELIVERY_STALE_AFTER_MS
    ) {
      problems.push(
        `A deliverable notification has waited since ${inputs.oldestDeliverableAt.toISOString()}. Check the notification-delivery cron, its consumer flag and the vehicleNotificationDeliveryWorkflow runs.`,
      );
    }
    return {
      status: problems.length === 0 ? "healthy" : "unhealthy",
      lastCompletedDay: inputs.lastCompletedDay,
      expectedDay,
      oldestDeliverableAt: inputs.oldestDeliverableAt?.toISOString() ?? null,
      problems,
    };
  },
} as const;
