import { count, desc, gte, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { searchAlertCheck, searchNotificationIntent } from "~/schema";

/**
 * A channel's notifications from one alert check, by where they stand.
 * Waiting: not yet sent (pending, or being sent now). Retrying: a send
 * failed and is tried again later. Cancelled: dropped before sending, for
 * example after the saved search changed. Other: a status this page does
 * not know yet, counted so the totals stay complete.
 */
export type ChannelCounts = {
  delivered: number;
  waiting: number;
  retrying: number;
  cancelled: number;
  other: number;
};

export type AlertCheckSummary = {
  id: string;
  /** The ingestion day (07:00 UTC boundary) the check covers. */
  day: string;
  /** running, complete or superseded. */
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  /** By channel (email, discord); channels without notifications are absent. */
  channels: Record<string, ChannelCounts>;
};

type CheckRow = Omit<AlertCheckSummary, "channels">;
type IntentCountRow = {
  alertCheckId: string | null;
  channel: string;
  status: string;
  intents: number;
};

const STATUS_COLUMN: Record<string, keyof ChannelCounts> = {
  delivered: "delivered",
  pending: "waiting",
  sending: "waiting",
  retry: "retrying",
  cancelled: "cancelled",
};

function emptyCounts(): ChannelCounts {
  return { delivered: 0, waiting: 0, retrying: 0, cancelled: 0, other: 0 };
}

export const AlertCheckOverview = {
  /** Checks for `sinceDay` and later, newest first, with their counts. */
  async load(
    database: LibSQLDatabase,
    sinceDay: string,
  ): Promise<AlertCheckSummary[]> {
    const checks = await database
      .select({
        id: searchAlertCheck.id,
        day: searchAlertCheck.day,
        status: searchAlertCheck.status,
        startedAt: searchAlertCheck.startedAt,
        completedAt: searchAlertCheck.completedAt,
      })
      .from(searchAlertCheck)
      .where(gte(searchAlertCheck.day, sinceDay))
      .orderBy(desc(searchAlertCheck.day));
    if (checks.length === 0) return [];
    const counts = await database
      .select({
        alertCheckId: searchNotificationIntent.alertCheckId,
        channel: searchNotificationIntent.channel,
        status: searchNotificationIntent.status,
        intents: count(),
      })
      .from(searchNotificationIntent)
      .where(
        inArray(
          searchNotificationIntent.alertCheckId,
          checks.map((check) => check.id),
        ),
      )
      .groupBy(
        searchNotificationIntent.alertCheckId,
        searchNotificationIntent.channel,
        searchNotificationIntent.status,
      );
    return AlertCheckOverview.summarize(checks, counts);
  },

  /** Each check with its notification counts per channel. */
  summarize(
    checks: readonly CheckRow[],
    counts: readonly IntentCountRow[],
  ): AlertCheckSummary[] {
    return checks.map((check) => {
      const channels: Record<string, ChannelCounts> = {};
      for (const row of counts) {
        if (row.alertCheckId !== check.id) continue;
        const column = STATUS_COLUMN[row.status] ?? "other";
        const channel = channels[row.channel] ?? emptyCounts();
        channel[column] += row.intents;
        channels[row.channel] = channel;
      }
      return { ...check, channels };
    });
  },
} as const;
