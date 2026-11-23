import { describe, expect, test } from "bun:test";
import { createAdminTestDatabase } from "./admin-test-database";
import {
  ANALYTICS_DAYS,
  SAVED_SEARCH_WEEKS,
  SiteAnalytics,
} from "./site-analytics";

// A Sunday, so this week began on Monday Nov 16.
const NOW = new Date("2026-11-22T12:00:00Z");
const at = (iso: string) => Date.parse(iso);

describe("SiteAnalytics.users", () => {
  test("counts users, verified emails and sign-ups per UTC day for 30 days", async () => {
    const { client, db } = await createAdminTestDatabase();
    await client.execute({
      sql: `insert into user (id, email, email_verified, created_at) values
        ('old', 'a@x', 1, ?), ('d1', 'b@x', 0, ?), ('d2', 'c@x', 1, ?),
        ('today', 'd@x', 0, ?)`,
      args: [
        at("2026-10-01T00:00:00Z"),
        at("2026-11-21T00:30:00Z"),
        at("2026-11-21T23:30:00Z"),
        at("2026-11-22T08:00:00Z"),
      ],
    });
    const users = await SiteAnalytics.users(db, NOW);
    expect(users.total).toBe(4);
    expect(users.verified).toBe(2);
    expect(users.newPerDay).toHaveLength(ANALYTICS_DAYS);
    expect(users.newPerDay[0]).toEqual({ day: "2026-10-24", value: 0 });
    expect(users.newPerDay.slice(-2)).toEqual([
      { day: "2026-11-21", value: 2 },
      { day: "2026-11-22", value: 1 },
    ]);
  });
});

describe("SiteAnalytics.savedSearches", () => {
  test("counts searches with alerts and new ones per week", async () => {
    const { client, db } = await createAdminTestDatabase();
    await client.execute({
      sql: `insert into saved_search (id, email_alerts_enabled, discord_alerts_enabled, created_at) values
        ('both', 1, 1, ?), ('email', 1, 0, ?), ('none', 0, 0, ?), ('old', 0, 1, ?)`,
      args: [
        at("2026-11-16T00:00:00Z"),
        at("2026-11-22T10:00:00Z"),
        at("2026-11-15T23:00:00Z"),
        at("2026-01-01T00:00:00Z"),
      ],
    });
    const searches = await SiteAnalytics.savedSearches(db, NOW);
    expect(searches).toMatchObject({
      total: 4,
      emailAlerts: 2,
      discordAlerts: 2,
      anyAlerts: 3,
    });
    expect(searches.perWeek).toHaveLength(SAVED_SEARCH_WEEKS);
    expect(searches.perWeek[0]).toEqual({ day: "2026-08-31", value: 0 });
    expect(searches.perWeek.slice(-2)).toEqual([
      { day: "2026-11-09", value: 1 },
      { day: "2026-11-16", value: 2 },
    ]);
  });
});

describe("SiteAnalytics.alerts", () => {
  test("counts sends per day by channel, and retrying and cancelled ones", async () => {
    const { client, db } = await createAdminTestDatabase();
    await client.execute({
      sql: `insert into search_notification_intent
        (id, alert_check_id, channel, status, created_at, delivered_at) values
        ('e1', 'c', 'email', 'delivered', ?, ?),
        ('e2', 'c', 'email', 'delivered', ?, ?),
        ('d1', 'c', 'discord', 'delivered', ?, ?),
        ('old', 'c', 'email', 'delivered', ?, ?),
        ('r1', 'c', 'discord', 'retry', ?, null),
        ('x1', 'c', 'email', 'cancelled', ?, null),
        ('xold', 'c', 'email', 'cancelled', ?, null)`,
      args: [
        at("2026-11-21T07:00:00Z"),
        at("2026-11-21T07:05:00Z"),
        at("2026-11-22T07:00:00Z"),
        at("2026-11-22T07:05:00Z"),
        at("2026-11-21T07:00:00Z"),
        at("2026-11-21T07:05:00Z"),
        at("2026-09-01T07:00:00Z"),
        at("2026-09-01T07:05:00Z"),
        at("2026-11-22T07:00:00Z"),
        at("2026-11-20T07:00:00Z"),
        at("2026-09-01T07:00:00Z"),
      ],
    });
    const alerts = await SiteAnalytics.alerts(db, NOW);
    expect(alerts.sent.email).toHaveLength(ANALYTICS_DAYS);
    expect(alerts.sent.email.slice(-2)).toEqual([
      { day: "2026-11-21", value: 1 },
      { day: "2026-11-22", value: 1 },
    ]);
    expect(alerts.sent.discord.slice(-2)).toEqual([
      { day: "2026-11-21", value: 1 },
      { day: "2026-11-22", value: 0 },
    ]);
    expect(alerts.retrying).toEqual({ email: 0, discord: 1 });
    expect(alerts.cancelled).toEqual({ email: 1, discord: 0 });
  });
});
