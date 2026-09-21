import { createTestClient } from "../ingestion/durable-ingestion-test-fixtures";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import {
  cancelClaimedNotificationIntents,
  claimNotificationIntentGroup,
  markNotificationGroupDelivered,
} from "./notification-intent-claim";

const TEST_SCHEMA = `
  create table user (id text primary key);
  insert into user values ('user-1'), ('user-2');
  create table ingestion_run (
    id text primary key,
    status text not null,
    stage text not null
  );

  create table search_notification_intent (
    id text primary key,
    run_id text not null default 'run-1',
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
