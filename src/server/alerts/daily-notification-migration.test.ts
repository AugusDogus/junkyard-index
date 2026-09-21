import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { claimNotificationIntentGroup } from "./notification-intent-claim";
import { readFileSync } from "node:fs";

test("daily notification migration preserves delivery history and in-flight provider keys", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      pragma foreign_keys = on;
      create table user (id text primary key);
      insert into user values ('user-1');
      create table search_notification_intent (
        id text primary key, user_id text, channel text, status text,
        delivered_at integer, attempts integer, run_id text, publication_sequence integer,
        saved_search_id text not null default 'search-1', search_match_version integer not null default 1,
        channel_config_version integer not null default 1, payload text not null default '{}',
        claim_token text, claimed_at integer, next_attempt_at integer, last_error text,
        created_at integer not null default 0, cancelled_at integer
      );
      create table ingestion_run (id text primary key, status text, stage text);
      insert into ingestion_run values ('run-4', 'success', 'released');
      insert into search_notification_intent (id, user_id, channel, status, delivered_at, attempts, run_id, publication_sequence) values
        ('delivered-1', 'user-1', 'email', 'delivered', 1000, 1, 'run-1', 1),
        ('delivered-2', 'user-1', 'email', 'delivered', 2000, 1, 'run-2', 2),
        ('email-retry', 'user-1', 'email', 'retry', null, 1, 'run-3', 3),
        ('discord-retry', 'user-1', 'discord', 'sending', null, 1, 'run-3', 3),
        ('pending', 'user-1', 'email', 'pending', null, 0, 'run-4', 4);
    `);
    await client.executeMultiple(
      readFileSync(
        new URL(
          "../../../drizzle/0010_daily_notification_digest.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(
      (await client.execute("select * from search_notification_delivery"))
        .rows[0],
    ).toMatchObject({
      user_id: "user-1",
      channel: "email",
      delivered_at: 2000,
    });
    const rows = await client.execute(
      "select id, delivery_group_id from search_notification_intent where delivered_at is null order by id",
    );
    expect(rows.rows.map((row) => [row.id, row.delivery_group_id])).toEqual([
      ["discord-retry", "discord-retry"],
      ["email-retry", "email:run-3:3:user-1"],
      ["pending", null],
    ]);
    // The old application is still serving while the new deployment builds.
    await client.execute(
      "update search_notification_intent set status='sending', attempts=1 where id='pending'",
    );
    expect(
      (
        await client.execute(
          "select delivery_group_id from search_notification_intent where id='pending'",
        )
      ).rows[0]?.delivery_group_id,
    ).toBe("email:run-4:4:user-1");
    await client.execute(
      "update search_notification_intent set status='delivered', delivered_at=1789812000000 where id='pending'",
    );
    expect(
      (
        await client.execute(
          "select delivered_at from search_notification_delivery where channel='email'",
        )
      ).rows[0]?.delivered_at,
    ).toBe(1789812000000);
    // Replaying an older acknowledgement must not move the recipient's clock back.
    await client.execute(
      "update search_notification_intent set status='delivered', delivered_at=1500 where id='email-retry'",
    );
    expect(
      (
        await client.execute(
          "select delivered_at from search_notification_delivery where channel='email'",
        )
      ).rows[0]?.delivered_at,
    ).toBe(1789812000000);
    await client.execute(
      "insert into search_notification_intent (id, user_id, channel, status, attempts, run_id, publication_sequence) values ('later', 'user-1', 'email', 'pending', 0, 'run-4', 4)",
    );
    expect(
      await claimNotificationIntentGroup({
        database: drizzle(client),
        channel: "email",
        now: new Date("2026-09-19T11:00:00Z"),
        leaseMs: 900000,
        claimToken: "new-worker",
      }),
    ).toHaveLength(0);
    await client.execute(
      "update search_notification_intent set status='sending', attempts=1, delivery_group_id='email:digest:new-worker' where id='later'",
    );
    expect(
      (
        await client.execute(
          "select delivery_group_id from search_notification_intent where id='later'",
        )
      ).rows[0]?.delivery_group_id,
    ).toBe("email:digest:new-worker");
    await client.execute("delete from user");
    expect(
      (await client.execute("select * from search_notification_delivery")).rows,
    ).toHaveLength(0);
  } finally {
    client.close();
  }
});
