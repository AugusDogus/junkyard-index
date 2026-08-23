import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import {
  cancelClaimedNotificationIntents,
  claimDiscordNotificationIntents,
  claimEmailNotificationIntentGroup,
} from "./notification-intent-claim";

const TEST_SCHEMA = `
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
    claim_token text,
    claimed_at integer,
    next_attempt_at integer,
    last_error text,
    created_at integer not null default 0,
    delivered_at integer,
    cancelled_at integer
  );

  insert into ingestion_run (id, status, stage)
  values ('run-1', 'success', 'released');
`;

describe("notification intent claims", () => {
  test("a stale worker cannot cancel a reclaimed intent", async () => {
    const client = createClient({ url: ":memory:" });
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
      client.close();
    }
  });

  test("concurrent workers atomically claim an email digest group once", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into search_notification_intent (id, saved_search_id)
        values ('intent-1', 'search-1'), ('intent-2', 'search-2');
      `);
      const database = drizzle(client);
      const now = new Date("2026-08-22T07:00:00.000Z");
      const claim = (claimToken: string) =>
        claimEmailNotificationIntentGroup({
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
      client.close();
    }
  });

  test("does not claim intents until their ingestion run is released", async () => {
    const client = createClient({ url: ":memory:" });
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
      const claimed = await claimEmailNotificationIntentGroup({
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
      client.close();
    }
  });

  test("claims Discord intents independently in bounded batches", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`${TEST_SCHEMA}
        insert into search_notification_intent (id, saved_search_id, channel)
        values
          ('discord-1', 'search-1', 'discord'),
          ('discord-2', 'search-2', 'discord');
      `);
      const claimed = await claimDiscordNotificationIntents({
        database: drizzle(client),
        now: new Date("2026-08-22T07:00:00.000Z"),
        leaseMs: 15 * 60 * 1000,
        batchSize: 1,
        claimToken: "discord-claim",
      });

      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.id).toBe("discord-1");
      const pending = await client.execute(
        "select status from search_notification_intent where id = 'discord-2'",
      );
      expect(pending.rows[0]?.status).toBe("pending");
    } finally {
      client.close();
    }
  });
});
