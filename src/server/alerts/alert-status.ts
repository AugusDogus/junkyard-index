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

// A check is expected finished this long after it stops counting as stuck:
// after the missing-check grace (deadline plus staleAfterMs), and after its
// own start plus staleAfterMs.
const CHECK_GRACE_MS = 60 * 60 * 1000;

function previousDay(now: Date): string {
  return IngestionDay.key(new Date(IngestionDay.start(now).getTime() - 1));
}

export type AlertStatusInputs = {
  mode: SearchAlertsMode;
  /** The latest day whose alert check completed, if any. */
  lastCompletedDay: string | null;
  /** Yesterday's and today's alert checks, where they were opened. */
  openedChecks: { day: string; startedAt: Date }[];
  /** When the longest-waiting deliverable notification became due. */
  oldestDeliverableAt: Date | null;
};

export type AlertStatus =
  | { status: "paused"; lastCompletedDay: string | null }
  | {
      status: "healthy" | "unhealthy";
      lastCompletedDay: string | null;
      /**
       * Null while no check is expected: none opened yesterday or today,
       * because alerts were paused then or were just switched back on.
       */
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
        .select({
          day: searchAlertCheck.day,
          startedAt: searchAlertCheck.startedAt,
        })
        .from(searchAlertCheck)
        .where(inArray(searchAlertCheck.day, [yesterday, today]))
        .orderBy(searchAlertCheck.day),
      mode === "enabled"
        ? oldestDeliverableNotificationIntentAt({ database, now, leaseMs })
        : Promise.resolve(null),
    ]);
    return {
      mode,
      lastCompletedDay: check?.day ?? null,
      openedChecks: opened,
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
    const yesterday = previousDay(now);
    // A check is expected to have completed only once it was opened and has
    // had 2 hours from its own start, across the 07:00 UTC day boundary too;
    // today's is not expected before 20:00 UTC either. No check opens while
    // alerts are paused, so a day without one (paused, just switched back on,
    // or a search-alerts cron that never opened it) expects nothing.
    const hadTime = (check: { startedAt: Date } | undefined) =>
      check !== undefined &&
      now.getTime() - check.startedAt.getTime() >=
        SearchAlertSchedule.staleAfterMs + CHECK_GRACE_MS;
    const pastOverdue =
      now.getTime() >=
      SearchAlertSchedule.missingCheckGraceAt(now).getTime() + CHECK_GRACE_MS;
    const todayExpected =
      pastOverdue &&
      hadTime(inputs.openedChecks.find((check) => check.day === today));
    const yesterdayExpected = hadTime(
      inputs.openedChecks.find((check) => check.day === yesterday),
    );
    const expectedDay = todayExpected
      ? today
      : yesterdayExpected
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
