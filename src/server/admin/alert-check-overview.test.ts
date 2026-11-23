import { describe, expect, test } from "bun:test";
import { createAdminTestDatabase } from "./admin-test-database";
import { AlertCheckOverview } from "./alert-check-overview";

describe("AlertCheckOverview.load", () => {
  test("reads checks since a day, newest first, with notifications by channel", async () => {
    const { client, db } = await createAdminTestDatabase();
    await client.execute(`insert into search_alert_check
      (id, day, status, checked_through, started_at, last_progress_at, completed_at) values
      ('old', '2026-11-01', 'complete', 0, 1, 1, 2),
      ('yesterday', '2026-11-21', 'complete', 0, 10, 10, 20),
      ('today', '2026-11-22', 'running', 0, 30, 30, null)`);
    await client.execute(`insert into search_notification_intent
      (id, alert_check_id, channel, status) values
      ('a', 'yesterday', 'email', 'delivered'),
      ('b', 'yesterday', 'email', 'delivered'),
      ('c', 'yesterday', 'email', 'retry'),
      ('d', 'yesterday', 'discord', 'cancelled'),
      ('e', 'today', 'discord', 'pending'),
      ('f', 'today', 'discord', 'sending'),
      ('g', 'old', 'email', 'delivered')`);
    expect(await AlertCheckOverview.load(db, "2026-11-20")).toEqual([
      {
        id: "today",
        day: "2026-11-22",
        status: "running",
        startedAt: new Date(30),
        completedAt: null,
        channels: {
          discord: { delivered: 0, waiting: 2, retrying: 0, cancelled: 0 },
        },
      },
      {
        id: "yesterday",
        day: "2026-11-21",
        status: "complete",
        startedAt: new Date(10),
        completedAt: new Date(20),
        channels: {
          email: { delivered: 2, waiting: 0, retrying: 1, cancelled: 0 },
          discord: { delivered: 0, waiting: 0, retrying: 0, cancelled: 1 },
        },
      },
    ]);
  });

  test("reads nothing more without checks", async () => {
    const { db } = await createAdminTestDatabase();
    expect(await AlertCheckOverview.load(db, "2026-11-20")).toEqual([]);
  });
});
