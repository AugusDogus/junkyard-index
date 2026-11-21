import { createTestClient } from "../ingestion/durable-ingestion-test-fixtures";
import { describe, expect, test } from "bun:test";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import {
  cancelClaimedNotificationIntents,
  claimNotificationIntentGroup,
  hasDeliverableNotificationIntent,
  markNotificationGroupDelivered,
} from "./notification-intent-claim";
import { touchSearchAlertCheck } from "./search-alert-check";

const TEST_SCHEMA = `
  create table user (id text primary key);
  insert into user values ('user-1'), ('user-2');
  create table ingestion_run (
    id text primary key,
    status text not null,
    stage text not null
  );

  create table search_alert_check (
    id text primary key,
    day text not null default '',
    status text not null,
    last_progress_at integer not null default 0
  );

  create table search_notification_intent (
    id text primary key,
    run_id text default 'run-1',
    alert_check_id text,
    publication_sequence integer not null default 1,
    saved_search_id text not null default 'search-1',
    user_id text not null default 'user-1',
    channel text not null default 'email',
    search_match_version integer not null default 1,
    channel_config_version integer not null default 1,
    payload text not null default '{}',
    status text not null default 'pending',
    attempts integer not null default 0,
    delivery_group_id text,
    claim_token text,
    claimed_at integer,
    next_attempt_at integer,
    last_error text,
    created_at integer not null default 0,
    delivered_at integer,
    cancelled_at integer
  );

  create table search_notification_delivery (
    user_id text not null,
    channel text not null,
    delivered_at integer not null,
    primary key (user_id, channel)
  );

  insert into ingestion_run (id, status, stage)
  values ('run-1', 'success', 'released');

  -- Grouping and daily-limit tests run after each day's alert check finished.
  insert into search_alert_check (id, day, status) values
    ('done-2026-08-22', '2026-08-22', 'complete'),
    ('done-2026-09-19', '2026-09-19', 'complete'),
    ('done-2026-09-20', '2026-09-20', 'complete'),
    ('done-2026-09-21', '2026-09-21', 'complete');
`;

describe("notification intent claims", () => {
  test("defers later matches until the next day and combines publications", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into ingestion_run (id, status, stage) values ('run-2', 'success', 'released');
        insert into search_notification_intent (id, run_id)
        values ('later-1', 'run-1'), ('later-2', 'run-2');
      `);
      const deliveredAt = new Date("2026-09-19T08:00:00Z");
      await client.execute({
        sql: "insert into search_notification_delivery values ('user-1', 'email', ?)",
        args: [deliveredAt.getTime()],
      });
      const claim = (now: Date) =>
        claimNotificationIntentGroup({
          channel: "email",
          database: drizzle(client),
          now,
          leaseMs: 900000,
          claimToken: "next-day",
        });
      expect(await claim(new Date("2026-09-20T06:59:59Z"))).toHaveLength(0);
      const next = await claim(new Date("2026-09-20T07:00:00Z"));
      expect(next.map((row) => row.id).sort()).toEqual(["later-1", "later-2"]);
      expect(new Set(next.map((row) => row.deliveryGroupId)).size).toBe(1);
    } finally {
      cleanup();
    }
  });

  test("reports deliverable work only when the daily limit lets a claim succeed", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into search_notification_intent (id) values ('held');
      `);
      await client.execute({
        sql: "insert into search_notification_delivery values ('user-1', 'email', ?)",
        args: [new Date("2026-09-19T08:00:00Z").getTime()],
      });
      const deliverable = (now: Date) =>
        hasDeliverableNotificationIntent({
          database: drizzle(client),
          now,
          leaseMs: 900000,
        });
      expect(await deliverable(new Date("2026-09-20T06:59:59Z"))).toBe(false);
      expect(await deliverable(new Date("2026-09-20T07:00:00Z"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test.each(["email", "discord"] as const)(
    "%s delivery gates only that recipient and channel, even after intent deletion",
    async (channel) => {
      const { client, cleanup } = createTestClient();
      try {
        await client.executeMultiple(TEST_SCHEMA);
        await client.execute({
          sql: "insert into search_notification_intent (id, channel) values ('first', ?)",
          args: [channel],
        });
        const database = drizzle(client);
        const now = new Date("2026-09-19T10:00:00Z");
        const claim = (claimToken: string) =>
          claimNotificationIntentGroup({
            database,
            channel,
            now,
            leaseMs: 900000,
            claimToken,
          });
        expect(await claim("first-claim")).toHaveLength(1);
        await markNotificationGroupDelivered({
          database,
          userId: "user-1",
          channel,
          intentIds: ["first"],
          claimToken: "first-claim",
          now,
        });
        await client.execute(
          "delete from search_notification_intent where id='first'",
        );
        await client.execute({
          sql: "insert into search_notification_intent (id, channel) values ('later', ?)",
          args: [channel],
        });
        expect(await claim("later-claim")).toHaveLength(0);
        await client.execute({
          sql: "insert into search_notification_intent (id, user_id, channel) values ('other-user', 'user-2', ?)",
          args: [channel],
        });
        expect((await claim("other-claim")).map((row) => row.id)).toEqual([
          "other-user",
        ]);
        const otherChannel = channel === "email" ? "discord" : "email";
        await client.execute({
          sql: "insert into search_notification_intent (id, channel) values ('other-channel', ?)",
          args: [otherChannel],
        });
        expect(
          await claimNotificationIntentGroup({
            database,
            channel: otherChannel,
            now,
            leaseMs: 900000,
            claimToken: "other-channel",
          }),
        ).toHaveLength(1);
      } finally {
        cleanup();
      }
    },
  );

  test("reclaims a same-day Discord retry without opening the gate to new pending matches", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into search_notification_intent (id, channel, status, delivery_group_id, claim_token)
        values ('sent', 'discord', 'sending', 'discord:group:1', 'first-claim');
        insert into search_notification_intent (id, saved_search_id, channel, status, next_attempt_at, delivery_group_id)
        values ('retry-later', 'search-2', 'discord', 'retry', 0, 'discord:group:1');
      `);
      const database = drizzle(client);
      const now = new Date("2026-09-19T10:00:00Z");
      await markNotificationGroupDelivered({
        database,
        userId: "user-1",
        channel: "discord",
        intentIds: ["sent"],
        claimToken: "first-claim",
        now,
      });
      await client.execute({
        sql: "insert into search_notification_intent (id, saved_search_id, channel) values ('later-pending', 'search-3', 'discord')",
      });
      const claimed = await claimNotificationIntentGroup({
        database,
        channel: "discord",
        now,
        leaseMs: 900000,
        claimToken: "retry-claim",
      });
      expect(claimed.map((row) => row.id)).toEqual(["retry-later"]);
    } finally {
      cleanup();
    }
  });

  test("a confirmed stale send consumes the day without changing a newer claim", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(
        `${TEST_SCHEMA} insert into search_notification_intent (id, status, claim_token) values ('first', 'sending', 'new-worker');`,
      );
      const now = new Date("2026-09-19T10:00:00Z");
      await markNotificationGroupDelivered({
        database: drizzle(client),
        userId: "user-1",
        channel: "email",
        intentIds: ["first"],
        claimToken: "old-worker",
        now,
      });
      expect(
        (
          await client.execute(
            "select delivered_at from search_notification_delivery",
          )
        ).rows[0]?.delivered_at,
      ).toBe(now.getTime());
      expect(
        (
          await client.execute(
            "select status, claim_token from search_notification_intent",
          )
        ).rows[0],
      ).toMatchObject({ status: "sending", claim_token: "new-worker" });
    } finally {
      cleanup();
    }
  });

  test.each(["cancel", "delete"] as const)(
    "counts a successful send when its search is changed in flight: %s",
    async (change) => {
      const { client, cleanup } = createTestClient();
      try {
        await client.executeMultiple(
          `${TEST_SCHEMA} insert into search_notification_intent (id) values ('first');`,
        );
        const database = drizzle(client);
        const now = new Date("2026-09-19T10:00:00Z");
        await claimNotificationIntentGroup({
          database,
          channel: "email",
          now,
          leaseMs: 900000,
          claimToken: "sending",
        });
        if (change === "cancel") {
          await cancelClaimedNotificationIntents({
            database,
            intentIds: ["first"],
            claimToken: "sending",
            reason: "channel_no_longer_eligible",
          });
        } else {
          await client.execute(
            "delete from search_notification_intent where id = 'first'",
          );
        }
        await markNotificationGroupDelivered({
          database,
          userId: "user-1",
          channel: "email",
          intentIds: ["first"],
          claimToken: "sending",
          now,
        });
        await client.execute(
          "insert into search_notification_intent (id) values ('later')",
        );
        expect(
          await claimNotificationIntentGroup({
            database,
            channel: "email",
            now,
            leaseMs: 900000,
            claimToken: "again",
          }),
        ).toHaveLength(0);
      } finally {
        cleanup();
      }
    },
  );

  test("reclaims a crashed digest without adding new matches or changing its key", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into search_notification_intent (id) values ('first');
      `);
      const database = drizzle(client);
      const claim = (now: string, claimToken: string) =>
        claimNotificationIntentGroup({
          database,
          channel: "email",
          now: new Date(now),
          leaseMs: 900000,
          claimToken,
        });
      const first = await claim("2026-09-19T10:00:00Z", "first-claim");
      await client.execute(
        "insert into search_notification_intent (id) values ('later')",
      );
      expect(await claim("2026-09-19T10:01:00Z", "busy")).toHaveLength(0);
      const retry = await claim("2026-09-19T10:16:00Z", "reclaim");
      expect(retry.map((row) => row.id)).toEqual(["first"]);
      expect(retry[0]?.deliveryGroupId).toBe(first[0]?.deliveryGroupId);
      await client.execute({
        sql: "update search_notification_intent set status='retry', claim_token=null, next_attempt_at=? where id='first'",
        args: [new Date("2026-09-20T10:00:00Z").getTime()],
      });
      expect(await claim("2026-09-20T07:00:00Z", "not-due")).toHaveLength(0);
      const nextDayRetry = await claim("2026-09-20T10:00:00Z", "next-day");
      expect(nextDayRetry.map((row) => row.id)).toEqual(["first"]);
      expect(nextDayRetry[0]?.deliveryGroupId).toBe(first[0]?.deliveryGroupId);
      await markNotificationGroupDelivered({
        database,
        userId: "user-1",
        channel: "email",
        intentIds: ["first"],
        claimToken: "next-day",
        now: new Date("2026-09-20T10:00:00Z"),
      });
      expect(await claim("2026-09-20T11:00:00Z", "still-gated")).toHaveLength(
        0,
      );
      expect(
        (await claim("2026-09-21T07:00:00Z", "tomorrow")).map((row) => row.id),
      ).toEqual(["later"]);
    } finally {
      cleanup();
    }
  });

  test("a completely cancelled digest does not consume the daily allowance", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(
        `${TEST_SCHEMA} insert into search_notification_intent (id) values ('first');`,
      );
      const database = drizzle(client);
      const now = new Date("2026-09-19T10:00:00Z");
      await claimNotificationIntentGroup({
        database,
        channel: "email",
        now,
        leaseMs: 900000,
        claimToken: "cancel",
      });
      await cancelClaimedNotificationIntents({
        database,
        intentIds: ["first"],
        claimToken: "cancel",
        reason: "disabled",
      });
      await client.execute(
        "insert into search_notification_intent (id) values ('later')",
      );
      expect(
        await claimNotificationIntentGroup({
          database,
          channel: "email",
          now,
          leaseMs: 900000,
          claimToken: "valid",
        }),
      ).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("a stale worker cannot cancel a reclaimed intent", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into search_notification_intent (id, status, claim_token)
        values ('intent-1', 'sending', 'new-claim');
      `);
      const database = drizzle(client);
      expect(
        await cancelClaimedNotificationIntents({
          database,
          intentIds: ["intent-1"],
          claimToken: "stale-claim",
          reason: "stale-worker",
        }),
      ).toBe(0);
      let row = await client.execute(
        "select status, claim_token from search_notification_intent",
      );
      expect(row.rows[0]?.status).toBe("sending");
      expect(row.rows[0]?.claim_token).toBe("new-claim");

      expect(
        await cancelClaimedNotificationIntents({
          database,
          intentIds: ["intent-1"],
          claimToken: "new-claim",
          reason: "subscription-inactive",
        }),
      ).toBe(1);
      row = await client.execute(
        "select status, claim_token from search_notification_intent",
      );
      expect(row.rows[0]?.status).toBe("cancelled");
      expect(row.rows[0]?.claim_token).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("concurrent workers atomically claim an email digest group once", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into search_notification_intent (id, saved_search_id)
        values ('intent-1', 'search-1'), ('intent-2', 'search-2');
      `);
      const database = drizzle(client);
      const now = new Date("2026-08-22T07:00:00.000Z");
      const claim = (claimToken: string) =>
        claimNotificationIntentGroup({
          channel: "email",
          database,
          now,
          leaseMs: 15 * 60 * 1000,
          claimToken,
        });
      const [first, second] = await Promise.all([
        claim("claim-a"),
        claim("claim-b"),
      ]);

      expect(first.length + second.length).toBe(2);
      const row = await client.execute(
        "select status, attempts, claim_token from search_notification_intent order by id",
      );
      expect(row.rows[0]?.status).toBe("sending");
      expect(row.rows[0]?.attempts).toBe(1);
      const claimToken = row.rows[0]?.claim_token;
      if (typeof claimToken !== "string") {
        throw new Error(
          "Expected the intent to retain its winning claim token",
        );
      }
      expect(["claim-a", "claim-b"]).toContain(claimToken);
      expect(row.rows[1]?.claim_token).toBe(claimToken);
    } finally {
      cleanup();
    }
  });

  test("does not claim intents until their ingestion run is released", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into ingestion_run (id, status, stage)
        values ('run-active', 'running', 'match_alerts');
        insert into ingestion_run (id, status, stage)
        values ('run-abandoned', 'abandoned', 'match_alerts');
        insert into search_notification_intent (id, run_id)
        values ('active-intent', 'run-active');
        insert into search_notification_intent (id, run_id)
        values ('abandoned-intent', 'run-abandoned');
      `);
      const database = drizzle(client);
      const claimed = await claimNotificationIntentGroup({
        channel: "email",
        database,
        now: new Date("2026-08-22T07:00:00.000Z"),
        leaseMs: 15 * 60 * 1000,
        claimToken: "claim-a",
      });

      expect(claimed).toHaveLength(0);
      const rows = await client.execute(
        "select id, status from search_notification_intent order by id",
      );
      expect(JSON.stringify(rows.rows)).toBe(
        JSON.stringify([
          { id: "abandoned-intent", status: "pending" },
          { id: "active-intent", status: "pending" },
        ]),
      );
    } finally {
      cleanup();
    }
  });

  describe("while today's alert check runs", () => {
    const now = new Date("2026-11-20T19:00:00.000Z");
    const leaseMs = 15 * 60 * 1000;
    // A holdover from an earlier day: its run released, it never went out.
    const SETUP = (todayProgressAt: number) => `${TEST_SCHEMA}
      insert into search_alert_check (id, day, status, last_progress_at) values
        ('yesterday', '2026-11-19', 'running', ${now.getTime()}),
        ('today', '2026-11-20', 'running', ${todayProgressAt});
      insert into search_notification_intent (id, run_id, alert_check_id, saved_search_id, created_at)
      values
        ('held', 'run-1', null, 'search-1', 1),
        ('today-1', null, 'today', 'search-2', 2);
    `;

    async function deliver(database: LibSQLDatabase, claimToken: string) {
      const claimed = await claimNotificationIntentGroup({
        channel: "email",
        database,
        now,
        leaseMs,
        claimToken,
      });
      if (claimed.length > 0)
        await markNotificationGroupDelivered({
          database,
          userId: "user-1",
          channel: "email",
          intentIds: claimed.map((row) => row.id),
          claimToken,
          now,
        });
      return claimed;
    }

    test("an earlier intent waits and goes out in one digest with today's matches", async () => {
      const { client, cleanup } = createTestClient();
      try {
        await client.executeMultiple(SETUP(now.getTime() - 5 * 60 * 1000));
        const database = drizzle(client);
        // Only today's check holds intents; yesterday's running row does not.
        expect(
          await hasDeliverableNotificationIntent({ database, now, leaseMs }),
        ).toBe(false);
        expect(await deliver(database, "early")).toHaveLength(0);

        await client.execute(
          "update search_alert_check set status = 'complete' where id = 'today'",
        );
        const delivered = await deliver(database, "digest");
        expect(delivered.map((row) => row.id).sort()).toEqual([
          "held",
          "today-1",
        ]);
        expect(new Set(delivered.map((row) => row.deliveryGroupId)).size).toBe(
          1,
        );
        expect(
          (
            await client.execute(
              "select count(*) as n from search_notification_intent where status = 'pending'",
            )
          ).rows[0]?.n,
        ).toBe(0);
      } finally {
        cleanup();
      }
    });

    test("a check that stopped progressing no longer holds earlier intents", async () => {
      const { client, cleanup } = createTestClient();
      try {
        // Algolia has failed every attempt for two hours.
        await client.executeMultiple(SETUP(now.getTime() - 2 * 60 * 60 * 1000));
        const database = drizzle(client);
        const delivered = await deliver(database, "holdover");
        expect(delivered.map((row) => row.id)).toEqual(["held"]);
        // The check's own matches still wait for it to finish.
        expect(
          (
            await client.execute(
              "select status from search_notification_intent where id = 'today-1'",
            )
          ).rows[0]?.status,
        ).toBe("pending");
      } finally {
        cleanup();
      }
    });
  });

  describe("across the 07:00 UTC day boundary", () => {
    const leaseMs = 15 * 60 * 1000;

    async function deliver(
      database: LibSQLDatabase,
      at: string,
      claimToken: string,
    ) {
      const now = new Date(at);
      const claimed = await claimNotificationIntentGroup({
        channel: "email",
        database,
        now,
        leaseMs,
        claimToken,
      });
      if (claimed.length > 0)
        await markNotificationGroupDelivered({
          database,
          userId: "user-1",
          channel: "email",
          intentIds: claimed.map((row) => row.id),
          claimToken,
          now,
        });
      return claimed.map((row) => row.id).sort();
    }

    const SETUP = `${TEST_SCHEMA}
      insert into search_alert_check (id, day, status, last_progress_at)
      values ('day-1', '2026-11-20', 'running', 0);
      insert into search_notification_intent (id, run_id, alert_check_id, saved_search_id, created_at)
      values ('day-1-match', null, 'day-1', 'search-1', 1);
    `;

    test("a check finishing after the boundary sends its matches in the new day's one digest", async () => {
      const { client, cleanup } = createTestClient();
      try {
        await client.executeMultiple(SETUP);
        const database = drizzle(client);
        // Yesterday's check, retried overnight, finishes after 07:00 UTC.
        await client.execute(
          "update search_alert_check set status = 'complete' where id = 'day-1'",
        );
        // Today's check has not been created yet, so its matches are still
        // to come.
        expect(
          await deliver(database, "2026-11-21T07:05:00Z", "early"),
        ).toEqual([]);
        await client.executeMultiple(`
          insert into search_alert_check (id, day, status, last_progress_at)
          values ('day-2', '2026-11-21', 'running', ${Date.parse("2026-11-21T15:00:00Z")});
          insert into search_notification_intent (id, run_id, alert_check_id, saved_search_id, created_at)
          values ('day-2-match', null, 'day-2', 'search-2', 2);
        `);
        expect(
          await deliver(database, "2026-11-21T15:01:00Z", "running"),
        ).toEqual([]);
        await client.execute(
          "update search_alert_check set status = 'complete' where id = 'day-2'",
        );
        expect(
          await deliver(database, "2026-11-21T15:30:00Z", "digest"),
        ).toEqual(["day-1-match", "day-2-match"]);
      } finally {
        cleanup();
      }
    });

    test("no check an hour past the deadline releases earlier intents", async () => {
      const { client, cleanup } = createTestClient();
      try {
        await client.executeMultiple(SETUP);
        await client.execute(
          "update search_alert_check set status = 'complete' where id = 'day-1'",
        );
        const database = drizzle(client);
        expect(
          await deliver(database, "2026-11-21T18:59:00Z", "before"),
        ).toEqual([]);
        expect(
          await deliver(database, "2026-11-21T19:00:00Z", "after"),
        ).toEqual(["day-1-match"]);
      } finally {
        cleanup();
      }
    });

    test.each([false, true])(
      "a check waiting for the search writer keeps holding earlier intents (heartbeat=%j)",
      async (heartbeat) => {
        const { client, cleanup } = createTestClient();
        try {
          await client.executeMultiple(`${SETUP}
            update search_alert_check set status = 'complete' where id = 'day-1';
            insert into search_alert_check (id, day, status, last_progress_at)
            values ('day-2', '2026-11-21', 'running', ${Date.parse("2026-11-21T15:00:00Z")});
          `);
          const database = drizzle(client);
          // Its next batch waits behind a search index migration; each lock
          // retry is a heartbeat.
          if (heartbeat)
            for (const at of ["15:30", "15:59", "16:30"])
              await touchSearchAlertCheck(
                database,
                "2026-11-21",
                new Date(`2026-11-21T${at}:00Z`),
              );
          expect(
            await deliver(database, "2026-11-21T16:31:00Z", "waiting"),
          ).toEqual(heartbeat ? [] : ["day-1-match"]);
          // A finished check never moves back to running.
          await client.execute(
            "update search_alert_check set status = 'complete', last_progress_at = 0 where id = 'day-2'",
          );
          await touchSearchAlertCheck(
            database,
            "2026-11-21",
            new Date("2026-11-21T16:32:00Z"),
          );
          const [row] = (
            await client.execute(
              "select status, last_progress_at from search_alert_check where id = 'day-2'",
            )
          ).rows;
          expect(row).toMatchObject({
            status: "complete",
            last_progress_at: 0,
          });
        } finally {
          cleanup();
        }
      },
    );

    test("a digest already grouped retries while today's check progresses", async () => {
      const { client, cleanup } = createTestClient();
      try {
        const now = Date.parse("2026-11-21T15:00:00Z");
        await client.executeMultiple(`${TEST_SCHEMA}
          insert into search_alert_check (id, day, status, last_progress_at)
          values ('day-2', '2026-11-21', 'running', ${now});
          insert into search_notification_intent (
            id, run_id, saved_search_id, status, attempts, delivery_group_id,
            next_attempt_at, created_at
          ) values ('retrying', 'run-1', 'search-1', 'retry', 1, 'email:digest:old', ${now}, 1);
        `);
        expect(
          await deliver(drizzle(client), "2026-11-21T15:00:00Z", "retry"),
        ).toEqual(["retrying"]);
      } finally {
        cleanup();
      }
    });
  });

  test("claims all Discord searches in one recipient group", async () => {
    const { client, cleanup } = createTestClient();
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into search_notification_intent (id, saved_search_id, channel)
        values
          ('discord-1', 'search-1', 'discord'),
          ('discord-2', 'search-2', 'discord');
      `);
      const claimed = await claimNotificationIntentGroup({
        channel: "discord",
        database: drizzle(client),
        now: new Date("2026-08-22T07:00:00.000Z"),
        leaseMs: 15 * 60 * 1000,
        claimToken: "discord-claim",
      });

      expect(claimed).toHaveLength(2);
      expect(claimed[0]?.id).toBe("discord-1");
      const pending = await client.execute(
        "select status from search_notification_intent where id = 'discord-2'",
      );
      expect(pending.rows[0]?.status).toBe("sending");
    } finally {
      cleanup();
    }
  });
});
