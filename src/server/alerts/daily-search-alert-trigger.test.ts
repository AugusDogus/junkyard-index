import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { createTestClient } from "~/server/ingestion/durable-ingestion-test-fixtures";
import {
  isPastSearchAlertDeadline,
  runSearchAlertCheck,
  startDailySearchAlerts,
} from "./daily-search-alert-trigger";
import {
  claimNotificationIntentGroup,
  hasDeliverableNotificationIntent,
} from "./notification-intent-claim";
import {
  openSearchAlertCheckState,
  type SearchAlertCheckBatchResult,
  type SearchAlertCheckState,
} from "./search-alert-check";

function trigger(state: {
  check: SearchAlertCheckState;
  deliverable: boolean;
}) {
  const started: string[] = [];
  return {
    started,
    operations: (now: Date) => ({
      now,
      alertsEnabled: async () => true,
      openCheck: async () => state.check,
      hasDeliverableIntents: async () => state.deliverable,
      startCheck: async (day: string) => {
        started.push(`check:${day}`);
      },
      startDelivery: async () => {
        started.push("delivery");
      },
    }),
  };
}

const DAY = "2026-11-20";
const DURING_DAY = new Date("2026-11-20T19:00:00Z");

describe("daily search alert trigger", () => {
  test("restarts a running check and starts delivery, which the claim holds while the check progresses", async () => {
    const { started, operations } = trigger({
      check: "running",
      deliverable: true,
    });
    expect(await startDailySearchAlerts(DAY, operations(DURING_DAY))).toEqual({
      status: "triggered",
      check: true,
      delivery: true,
    });
    expect(started).toEqual([`check:${DAY}`, "delivery"]);
  });

  test("a finished check only starts delivery, and only when something can go out", async () => {
    const finished = trigger({ check: "finished", deliverable: true });
    expect(
      await startDailySearchAlerts(DAY, finished.operations(DURING_DAY)),
    ).toEqual({ status: "triggered", check: false, delivery: true });
    expect(finished.started).toEqual(["delivery"]);

    const idle = trigger({ check: "finished", deliverable: false });
    expect(
      await startDailySearchAlerts(DAY, idle.operations(DURING_DAY)),
    ).toEqual({ status: "triggered", check: false, delivery: false });
    expect(idle.started).toEqual([]);
  });

  test("a past day starts no check but still delivers", async () => {
    const { started, operations } = trigger({
      check: "missing",
      deliverable: true,
    });
    // 07:00 UTC starts the next ingestion day.
    const nextDay = new Date("2026-11-21T07:00:00Z");
    expect(await startDailySearchAlerts(DAY, operations(nextDay))).toEqual({
      status: "triggered",
      check: false,
      delivery: true,
    });
    expect(started).toEqual(["delivery"]);
  });

  test.each([
    // The first deadline cron, before any pass opened today's check.
    "2026-11-20T18:40:00Z",
    // A pass that ends late, past the hold for a check that never appears.
    "2026-11-20T20:00:00Z",
  ])(
    "at %s, a held-over intent is not delivered before the check it starts finishes",
    async (at) => {
      const { client, cleanup } = createTestClient();
      try {
        await client.executeMultiple(`
        create table user (id text primary key);
        insert into user values ('user-1');
        create table ingestion_run (
          id text primary key, source text not null, status text not null,
          stage text not null, active_slot integer, commit_started_at integer,
          full_reindex_required integer not null default 0,
          publication_sequence integer, started_at integer not null
        );
        insert into ingestion_run (id, source, status, stage, started_at)
        values ('run-1', 'pyp', 'success', 'released', 0);
        create table vehicle_change_v2 (
          id integer primary key autoincrement, run_id text not null,
          vin text not null, change_type text not null, processed_at integer
        );
        create table ingestion_projector_checkpoint (
          name text primary key, kind text not null default 'publication',
          last_processed_change_id integer not null default 0
        );
        create table search_alert_check (
          id text primary key, day text not null unique, status text not null,
          checked_through integer not null, search_cursor text,
          started_at integer not null, last_progress_at integer not null,
          completed_at integer
        );
        create table search_notification_intent (
          id text primary key, run_id text, alert_check_id text,
          publication_sequence integer not null default 1,
          saved_search_id text not null default 'search-1',
          user_id text not null default 'user-1',
          channel text not null default 'email',
          search_match_version integer not null default 1,
          channel_config_version integer not null default 1,
          payload text not null default '{}',
          status text not null default 'pending',
          attempts integer not null default 0, delivery_group_id text,
          claim_token text, claimed_at integer, next_attempt_at integer,
          last_error text, created_at integer not null default 0,
          delivered_at integer, cancelled_at integer
        );
        create table search_notification_delivery (
          user_id text not null, channel text not null,
          delivered_at integer not null, primary key (user_id, channel)
        );
        -- Yesterday's match, never sent: its run released.
        insert into search_notification_intent (id, run_id) values ('held', 'run-1');
      `);
        const database = drizzle(client);
        const now = new Date(at);
        const claimed: string[] = [];
        const result = await startDailySearchAlerts(DAY, {
          now,
          alertsEnabled: async () => true,
          openCheck: (day) =>
            openSearchAlertCheckState({ database, client }, day, now),
          hasDeliverableIntents: () =>
            hasDeliverableNotificationIntent({
              database,
              now,
              leaseMs: 900000,
            }),
          // The check workflow is only enqueued here; it has not run a batch.
          startCheck: async () => undefined,
          startDelivery: async () => {
            const group = await claimNotificationIntentGroup({
              channel: "email",
              database,
              now,
              leaseMs: 900000,
              claimToken: "deadline",
            });
            claimed.push(...group.map((row) => row.id));
          },
        });
        expect(result).toEqual({
          status: "triggered",
          check: true,
          delivery: false,
        });
        expect(claimed).toEqual([]);
        expect(
          (await client.execute("select day, status from search_alert_check"))
            .rows,
        ).toEqual([expect.objectContaining({ day: DAY, status: "running" })]);
      } finally {
        cleanup();
      }
    },
  );

  test("paused alerts open no check and start neither the check nor delivery", async () => {
    const started: string[] = [];
    let opened = 0;
    const result = await startDailySearchAlerts(DAY, {
      now: DURING_DAY,
      alertsEnabled: async () => false,
      openCheck: async () => {
        opened += 1;
        return "running";
      },
      hasDeliverableIntents: async () => true,
      startCheck: async () => {
        started.push("check");
      },
      startDelivery: async () => {
        started.push("delivery");
      },
    });
    expect(result).toEqual({ status: "alerts_disabled" });
    expect(opened).toBe(0);
    expect(started).toEqual([]);
  });

  test("the deadline is 18:00 UTC within the 07:00 UTC ingestion day", () => {
    expect(
      isPastSearchAlertDeadline(new Date("2026-11-20T17:59:59.999Z")),
    ).toBe(false);
    expect(isPastSearchAlertDeadline(new Date("2026-11-20T18:00:00Z"))).toBe(
      true,
    );
    expect(isPastSearchAlertDeadline(new Date("2026-11-21T06:59:59Z"))).toBe(
      true,
    );
    expect(isPastSearchAlertDeadline(new Date("2026-11-21T07:00:00Z"))).toBe(
      false,
    );
  });
});

describe("search alert check run", () => {
  function drain(batches: SearchAlertCheckBatchResult[]) {
    const events: string[] = [];
    const queue = [...batches];
    return {
      events,
      run: () =>
        runSearchAlertCheck({
          runBatch: async () => {
            const batch = queue.shift();
            if (!batch) throw new Error("Unexpected extra batch");
            events.push(`batch:${batch.status}`);
            return batch;
          },
          waitForRetry: async () => {
            events.push("wait");
          },
          startDelivery: async () => {
            events.push("delivery");
          },
        }),
    };
  }

  test("waits out blocked batches, sums progress and delivers once complete", async () => {
    const { events, run } = drain([
      { status: "waiting", checkId: "check" },
      {
        status: "paused",
        checkId: "check",
        searchesProcessed: 50,
        intentsCreated: 2,
      },
      { status: "waiting", checkId: "check" },
      {
        status: "complete",
        checkId: "check",
        searchesProcessed: 3,
        intentsCreated: 1,
      },
    ]);
    expect(await run()).toEqual({
      status: "completed",
      searchesProcessed: 53,
      intentsCreated: 3,
    });
    expect(events).toEqual([
      "batch:waiting",
      "wait",
      "batch:paused",
      "batch:waiting",
      "wait",
      "batch:complete",
      "delivery",
    ]);
  });

  test("alerts paused mid-check stop the run without delivering", async () => {
    const { events, run } = drain([
      {
        status: "paused",
        checkId: "check",
        searchesProcessed: 50,
        intentsCreated: 1,
      },
      { status: "alerts_disabled" },
    ]);
    expect(await run()).toEqual({ status: "alerts_disabled" });
    expect(events).toEqual(["batch:paused", "batch:alerts_disabled"]);
  });

  test("a superseded or never-started check still delivers earlier intents", async () => {
    for (const batch of [
      { status: "stopped", checkId: "check" },
      { status: "not_started" },
    ] satisfies SearchAlertCheckBatchResult[]) {
      const { events, run } = drain([batch]);
      expect(await run()).toEqual({ status: batch.status });
      expect(events).toEqual([`batch:${batch.status}`, "delivery"]);
    }
  });
});
