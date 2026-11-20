import { createClient, type Client } from "@libsql/client";
import { afterEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import {
  AlertStatus,
  DELIVERY_STALE_AFTER_MS,
  type AlertStatusInputs,
} from "./alert-status";

const HOUR = 60 * 60 * 1000;
const LEASE_MS = 15 * 60 * 1000;
// Ingestion days start at 07:00 UTC; the alert deadline is 18:00 UTC.
const morning = new Date("2026-11-20T10:00:00Z");
const evening = new Date("2026-11-20T20:30:00Z");

const enabled: AlertStatusInputs = {
  mode: "enabled",
  lastCompletedDay: "2026-11-19",
  openedDays: ["2026-11-19"],
  oldestDeliverableAt: null,
};

describe("AlertStatus.evaluate", () => {
  test("paused alerts are reported, not judged", () => {
    expect(
      AlertStatus.evaluate(
        { ...enabled, mode: "disabled", lastCompletedDay: "2026-11-01" },
        evening,
      ),
    ).toEqual({ status: "paused", lastCompletedDay: "2026-11-01" });
  });

  test("expects yesterday's check until today's is overdue, then today's", () => {
    expect(AlertStatus.evaluate(enabled, morning)).toMatchObject({
      status: "healthy",
      expectedDay: "2026-11-19",
    });
    expect(
      AlertStatus.evaluate(
        { ...enabled, lastCompletedDay: "2026-11-18" },
        morning,
      ),
    ).toMatchObject({ status: "unhealthy", expectedDay: "2026-11-19" });
    expect(AlertStatus.evaluate(enabled, evening)).toMatchObject({
      status: "unhealthy",
      expectedDay: "2026-11-20",
    });
    expect(
      AlertStatus.evaluate(
        {
          ...enabled,
          lastCompletedDay: "2026-11-20",
          openedDays: ["2026-11-19", "2026-11-20"],
        },
        evening,
      ),
    ).toMatchObject({ status: "healthy", problems: [] });
  });

  test("re-enabling alerts after a pause is healthy until today's check is overdue", () => {
    const resumed = {
      ...enabled,
      lastCompletedDay: "2026-11-10",
      openedDays: [],
    };
    expect(AlertStatus.evaluate(resumed, morning)).toMatchObject({
      status: "healthy",
      expectedDay: null,
    });
    // The deadline cron should have opened and finished today's check.
    expect(AlertStatus.evaluate(resumed, evening)).toMatchObject({
      status: "unhealthy",
      expectedDay: "2026-11-20",
    });
  });

  test("a notification deliverable for too long is unhealthy", () => {
    expect(
      AlertStatus.evaluate(
        { ...enabled, oldestDeliverableAt: new Date(morning.getTime() - HOUR) },
        morning,
      ),
    ).toMatchObject({ status: "healthy" });
    const stale = AlertStatus.evaluate(
      {
        ...enabled,
        oldestDeliverableAt: new Date(
          morning.getTime() - DELIVERY_STALE_AFTER_MS - 1,
        ),
      },
      morning,
    );
    expect(stale).toMatchObject({ status: "unhealthy" });
    expect(stale.status === "unhealthy" && stale.problems).toEqual([
      expect.stringContaining("notification-delivery cron"),
    ]);
  });
});

describe("AlertStatus.load", () => {
  let client: Client;
  afterEach(() => client.close());

  async function setup() {
    client = createClient({ url: ":memory:" });
    await client.executeMultiple(`
      create table ingestion_run (id text primary key, status text not null, stage text not null);
      create table search_alert_check (
        id text primary key, day text not null, status text not null,
        last_progress_at integer not null default 0, completed_at integer
      );
      create table search_notification_intent (
        id text primary key, run_id text, alert_check_id text,
        user_id text not null default 'user-1', channel text not null default 'email',
        status text not null default 'pending', delivery_group_id text,
        claimed_at integer, next_attempt_at integer, created_at integer not null default 0
      );
      create table search_notification_delivery (
        user_id text not null, channel text not null, delivered_at integer not null
      );
    `);
    return drizzle(client);
  }

  test("reads the latest completed check, the opened days and when the oldest intent became deliverable", async () => {
    const database = await setup();
    const due = morning.getTime() - 3 * HOUR;
    await client.execute({
      sql: `insert into search_alert_check (id, day, status, completed_at) values
        ('a', '2026-11-18', 'complete', 0),
        ('b', '2026-11-19', 'complete', ?),
        ('c', '2026-11-20', 'running', null)`,
      args: [due - HOUR],
    });
    await client.execute({
      sql: `insert into search_notification_intent (id, alert_check_id, status, next_attempt_at, created_at) values
        ('retry-due', 'b', 'retry', ?, 0),
        ('retry-later', 'b', 'retry', ?, 0)`,
      args: [due, morning.getTime() + HOUR],
    });
    expect(
      await AlertStatus.load(database, morning, "enabled", LEASE_MS),
    ).toEqual({
      mode: "enabled",
      lastCompletedDay: "2026-11-19",
      openedDays: ["2026-11-19", "2026-11-20"],
      oldestDeliverableAt: new Date(due),
    });
    // Paused alerts read no intents.
    expect(
      await AlertStatus.load(database, morning, "disabled", LEASE_MS),
    ).toMatchObject({ mode: "disabled", oldestDeliverableAt: null });
  });

  test("an intent held until a check completed counts from that completion, not its creation", async () => {
    const database = await setup();
    const completedAt = morning.getTime() - 5 * 60 * 1000;
    // Yesterday's intent waits for today's check, which just completed.
    await client.execute({
      sql: `insert into search_alert_check (id, day, status, completed_at) values
        ('b', '2026-11-19', 'complete', 0),
        ('c', '2026-11-20', 'complete', ?)`,
      args: [completedAt],
    });
    await client.execute({
      sql: "insert into search_notification_intent (id, alert_check_id, status, created_at) values ('held', 'b', 'pending', ?)",
      args: [morning.getTime() - 3 * HOUR],
    });
    const inputs = await AlertStatus.load(
      database,
      morning,
      "enabled",
      LEASE_MS,
    );
    expect(inputs.oldestDeliverableAt).toEqual(new Date(completedAt));
    expect(AlertStatus.evaluate(inputs, morning)).toMatchObject({
      status: "healthy",
    });
  });
});
