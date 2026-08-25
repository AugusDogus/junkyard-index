import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { deleteExpiredAnonymousUsers } from "./anonymous-user-cleanup";

const NOW = new Date("2026-08-24T18:00:00.000Z");
const OLD = NOW.getTime() - 8 * 24 * 60 * 60 * 1000;

describe("anonymous user cleanup", () => {
  test("deletes only expired guests without an active session", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`
        pragma foreign_keys = on;
        create table user (
          id text primary key,
          is_anonymous integer not null,
          created_at integer not null
        );
        create table session (
          id text primary key,
          user_id text not null references user(id) on delete cascade,
          expires_at integer not null
        );
        create table search_usage (
          user_id text not null references user(id) on delete cascade,
          day text not null,
          count integer not null
        );
        insert into user values
          ('expired', 1, ${OLD}),
          ('active', 1, ${OLD}),
          ('recent', 1, ${NOW.getTime()}),
          ('registered', 0, ${OLD});
        insert into session values
          ('active-session', 'active', ${NOW.getTime() + 1000});
        insert into search_usage values ('expired', '2026-08-24', 4);
      `);

      const deleted = await deleteExpiredAnonymousUsers({
        database: drizzle(client),
        now: NOW,
      });

      expect(deleted).toBe(1);
      const users = await client.execute("select id from user order by id");
      expect(users.rows.map(({ id }) => id)).toEqual([
        "active",
        "recent",
        "registered",
      ]);
      const usage = await client.execute("select user_id from search_usage");
      expect(usage.rows).toEqual([]);
    } finally {
      client.close();
    }
  });
});
