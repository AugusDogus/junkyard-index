import { and, count, eq, gte, isNotNull, sql, type SQL } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { savedSearch, searchNotificationIntent, user } from "~/schema";
import type { AlertChannel } from "~/server/alerts/alert-config-repository";
import { AdminSeries, type DayValue } from "./admin-series";

/** Days of sign-ups and alert sends the analytics page charts. */
export const ANALYTICS_DAYS = 30;
/** Weeks of new saved searches, this week included. */
export const SAVED_SEARCH_WEEKS = 12;

const CHANNELS = [
  "email",
  "discord",
] as const satisfies readonly AlertChannel[];

export type UserStats = {
  total: number;
  verified: number;
  newPerDay: DayValue[];
};

export type SavedSearchStats = {
  total: number;
  emailAlerts: number;
  discordAlerts: number;
  /** With email, Discord or both on. */
  anyAlerts: number;
  /** Keyed by each week's Monday (UTC). */
  perWeek: DayValue[];
};

export type AlertStats = {
  /** Notifications delivered per UTC day. */
  sent: Record<AlertChannel, DayValue[]>;
  /** A send failed and is tried again later; counted whatever their age. */
  retrying: Record<AlertChannel, number>;
  /** Dropped before sending, of those created in the last 30 days. */
  cancelled: Record<AlertChannel, number>;
};

/** The UTC day of an epoch-ms column, as `YYYY-MM-DD`. */
function utcDay(column: SQLiteColumn): SQL<string> {
  return sql<string>`date(${column} / 1000, 'unixepoch')`;
}

function isChannel(value: string): value is AlertChannel {
  return CHANNELS.some((channel) => channel === value);
}

function byChannel(
  rows: readonly { channel: string; value: number }[],
): Record<AlertChannel, number> {
  const totals: Record<AlertChannel, number> = { email: 0, discord: 0 };
  for (const row of rows) {
    if (isChannel(row.channel)) totals[row.channel] += row.value;
  }
  return totals;
}

/**
 * Site analytics from the database. Each read touches the user, saved
 * search or notification tables only, which are small (hundreds of rows in
 * Nov 2026), and windows by time where the table grows daily.
 */
export const SiteAnalytics = {
  async users(database: LibSQLDatabase, now: Date): Promise<UserStats> {
    const days = AdminSeries.lastDays(now, ANALYTICS_DAYS);
    const since = AdminSeries.dayStart(days[0] ?? AdminSeries.dayKey(now));
    const day = utcDay(user.createdAt);
    const [totals, perDay] = await Promise.all([
      database
        .select({
          total: count(),
          verified:
            sql<number>`coalesce(sum(${user.emailVerified}), 0)`.mapWith(
              Number,
            ),
        })
        .from(user),
      database
        .select({ day, value: count() })
        .from(user)
        .where(gte(user.createdAt, since))
        .groupBy(day),
    ]);
    return {
      total: totals[0]?.total ?? 0,
      verified: totals[0]?.verified ?? 0,
      newPerDay: AdminSeries.fillDays(perDay, days),
    };
  },

  async savedSearches(
    database: LibSQLDatabase,
    now: Date,
  ): Promise<SavedSearchStats> {
    const sinceMonday = (now.getUTCDay() + 6) % 7;
    const days = AdminSeries.lastDays(
      now,
      (SAVED_SEARCH_WEEKS - 1) * 7 + sinceMonday + 1,
    );
    const since = AdminSeries.dayStart(days[0] ?? AdminSeries.dayKey(now));
    const day = utcDay(savedSearch.createdAt);
    const sumOf = (condition: SQL) =>
      sql<number>`coalesce(sum(case when ${condition} then 1 else 0 end), 0)`.mapWith(
        Number,
      );
    const [totals, perDay] = await Promise.all([
      database
        .select({
          total: count(),
          emailAlerts: sumOf(sql`${savedSearch.emailAlertsEnabled} = 1`),
          discordAlerts: sumOf(sql`${savedSearch.discordAlertsEnabled} = 1`),
          anyAlerts: sumOf(
            sql`${savedSearch.emailAlertsEnabled} = 1 or ${savedSearch.discordAlertsEnabled} = 1`,
          ),
        })
        .from(savedSearch),
      database
        .select({ day, value: count() })
        .from(savedSearch)
        .where(gte(savedSearch.createdAt, since))
        .groupBy(day),
    ]);
    const row = totals[0];
    return {
      total: row?.total ?? 0,
      emailAlerts: row?.emailAlerts ?? 0,
      discordAlerts: row?.discordAlerts ?? 0,
      anyAlerts: row?.anyAlerts ?? 0,
      perWeek: AdminSeries.weeks(AdminSeries.fillDays(perDay, days)),
    };
  },

  async alerts(database: LibSQLDatabase, now: Date): Promise<AlertStats> {
    const days = AdminSeries.lastDays(now, ANALYTICS_DAYS);
    const since = AdminSeries.dayStart(days[0] ?? AdminSeries.dayKey(now));
    const intent = searchNotificationIntent;
    const day = utcDay(intent.deliveredAt);
    const [sent, retrying, cancelled] = await Promise.all([
      database
        .select({ day, channel: intent.channel, value: count() })
        .from(intent)
        .where(
          and(
            eq(intent.status, "delivered"),
            isNotNull(intent.deliveredAt),
            gte(intent.deliveredAt, since),
          ),
        )
        .groupBy(day, intent.channel),
      database
        .select({ channel: intent.channel, value: count() })
        .from(intent)
        .where(eq(intent.status, "retry"))
        .groupBy(intent.channel),
      database
        .select({ channel: intent.channel, value: count() })
        .from(intent)
        .where(
          and(eq(intent.status, "cancelled"), gte(intent.createdAt, since)),
        )
        .groupBy(intent.channel),
    ]);
    const sentFor = (channel: AlertChannel) =>
      AdminSeries.fillDays(
        sent.filter((row) => row.channel === channel),
        days,
      );
    return {
      sent: { email: sentFor("email"), discord: sentFor("discord") },
      retrying: byChannel(retrying),
      cancelled: byChannel(cancelled),
    };
  },
} as const;
