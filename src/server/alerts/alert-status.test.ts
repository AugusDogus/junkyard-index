import { createClient, type Client } from "@libsql/client";
import { afterEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import {
  AlertStatus,
  DELIVERY_STALE_AFTER_MS,
  type AlertStatusInputs,
} from "./alert-status";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const LEASE_MS = 15 * MINUTE;
// Ingestion days start at 07:00 UTC; the alert deadline is 18:00 UTC.
const morning = new Date("2026-11-20T10:00:00Z");
const evening = new Date("2026-11-20T20:30:00Z");
const utc = (time: string) => new Date(`2026-11-${time}Z`);

const yesterdaysCheck = { day: "2026-11-19", startedAt: utc("19T16:00:00") };
const enabled: AlertStatusInputs = {
  mode: "enabled",
  lastCompletedDay: "2026-11-19",
  openedChecks: [yesterdaysCheck],
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
    // Alerts were on yesterday, so the deadline cron should have opened today's.
    expect(AlertStatus.evaluate(enabled, evening)).toMatchObject({
      status: "unhealthy",
      expectedDay: "2026-11-20",
    });
    expect(
      AlertStatus.evaluate(
        {
          ...enabled,
          lastCompletedDay: "2026-11-20",
          openedChecks: [
            yesterdaysCheck,
            { day: "2026-11-20", startedAt: utc("20T16:00:00") },
          ],
        },
        evening,
      ),
    ).toMatchObject({ status: "healthy", problems: [] });
  });

  test("switching alerts back on after 20:00 UTC stays healthy while today's first check runs", () => {
    const resumed = {
      ...enabled,
      lastCompletedDay: "2026-11-17",
      openedChecks: [],
    };
    const switchedOn = utc("20T20:05:00");
    expect(AlertStatus.evaluate(resumed, morning)).toMatchObject({
      status: "healthy",
      expectedDay: null,
    });
    expect(AlertStatus.evaluate(resumed, switchedOn)).toMatchObject({
      status: "healthy",
      expectedDay: null,
    });
    // The :40 cron opens today's check; it gets the usual time to finish.
    const opened = {
      ...resumed,
      openedChecks: [{ day: "2026-11-20", startedAt: utc("20T20:40:00") }],
    };
    expect(AlertStatus.evaluate(opened, utc("20T21:30:00"))).toMatchObject({
      status: "healthy",
    });
    expect(AlertStatus.evaluate(opened, utc("20T22:41:00"))).toMatchObject({
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
      create table ingestion_run (
        id text primary key, status text not null, stage text not null,
        released_at integer
      );
      create table search_alert_check (
        id text primary key, day text not null, status text not null,
        started_at integer not null default 0,
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

  async function check(
    id: string,
    day: string,
    status: string,
    times: { started: Date; progress?: Date; completed?: Date },
  ) {
    await client.execute({
      sql: "insert into search_alert_check (id, day, status, started_at, last_progress_at, completed_at) values (?, ?, ?, ?, ?, ?)",
      args: [
        id,
        day,
        status,
        times.started.getTime(),
        (times.progress ?? times.started).getTime(),
        times.completed?.getTime() ?? null,
      ],
    });
  }

  test("reads the latest completed check, the opened checks and the oldest deliverable intent", async () => {
    const database = await setup();
    await check("a", "2026-11-18", "complete", {
      started: utc("18T16:00:00"),
      completed: utc("18T16:10:00"),
    });
    await check("b", "2026-11-19", "complete", {
      started: utc("19T16:00:00"),
      completed: utc("19T16:10:00"),
    });
    await check("c", "2026-11-20", "running", {
      started: utc("20T09:55:00"),
    });
    const due = utc("20T07:00:00");
    // Grouped retries are not held for today's check.
    await client.execute({
      sql: `insert into search_notification_intent (id, alert_check_id, status, delivery_group_id, next_attempt_at, created_at) values
        ('retry-due', 'b', 'retry', 'g1', ?, 0),
        ('retry-later', 'b', 'retry', 'g2', ?, 0)`,
      args: [due.getTime(), morning.getTime() + HOUR],
    });
    expect(
      await AlertStatus.load(database, morning, "enabled", LEASE_MS),
    ).toEqual({
      mode: "enabled",
      lastCompletedDay: "2026-11-19",
      openedChecks: [
        { day: "2026-11-19", startedAt: utc("19T16:00:00") },
        { day: "2026-11-20", startedAt: utc("20T09:55:00") },
      ],
      oldestDeliverableAt: due,
    });
    // Paused alerts read no intents.
    expect(
      await AlertStatus.load(database, morning, "disabled", LEASE_MS),
    ).toMatchObject({ mode: "disabled", oldestDeliverableAt: null });
  });

  test("an intent released by a stalled check is dated from that release, not its creation", async () => {
    const database = await setup();
    await check("b", "2026-11-19", "complete", {
      started: utc("19T16:00:00"),
      completed: utc("19T16:10:00"),
    });
    // Today's check stopped progressing at 10:30; its hold lifted at 11:30.
    await check("c", "2026-11-20", "running", {
      started: utc("20T10:00:00"),
      progress: utc("20T10:30:00"),
    });
    // The recipient got yesterday's digest at 17:30, after this intent.
    await client.executeMultiple(`
      insert into search_notification_intent (id, alert_check_id, status, created_at)
        values ('late', 'b', 'pending', ${utc("19T17:00:00").getTime()});
      insert into search_notification_delivery (user_id, channel, delivered_at)
        values ('user-1', 'email', ${utc("19T17:30:00").getTime()});
    `);
    const now = utc("20T12:00:00");
    const inputs = await AlertStatus.load(database, now, "enabled", LEASE_MS);
    expect(inputs.oldestDeliverableAt).toEqual(utc("20T11:30:00"));
    expect(AlertStatus.evaluate(inputs, now)).toMatchObject({
      status: "healthy",
    });
  });

  test("a later check completing does not reset a stuck retry's clock", async () => {
    const database = await setup();
    await check("b", "2026-11-19", "complete", {
      started: utc("19T16:00:00"),
      completed: utc("19T16:10:00"),
    });
    await check("c", "2026-11-20", "complete", {
      started: utc("20T11:00:00"),
      completed: utc("20T11:30:00"),
    });
    await client.execute({
      sql: "insert into search_notification_intent (id, alert_check_id, status, delivery_group_id, next_attempt_at, created_at) values ('stuck', 'b', 'retry', 'g1', ?, ?)",
      args: [utc("20T06:00:00").getTime(), utc("19T16:10:00").getTime()],
    });
    const now = utc("20T12:00:00");
    const inputs = await AlertStatus.load(database, now, "enabled", LEASE_MS);
    expect(inputs.oldestDeliverableAt).toEqual(utc("20T06:00:00"));
    expect(AlertStatus.evaluate(inputs, now)).toMatchObject({
      status: "unhealthy",
    });
  });
});
