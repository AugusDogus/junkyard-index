import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { transferAnonymousSearchUsage } from "./anonymous-search-usage-transfer";

async function testDatabase() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    create table user (id text primary key);
    create table search_usage (
      user_id text not null references user(id) on delete cascade,
      day text not null,
      count integer not null,
      updated_at integer not null,
      primary key (user_id, day)
    );
    insert into user (id) values ('guest-1'), ('user-1');
  `);
  return { client, database: drizzle(client) };
}

describe("transferAnonymousSearchUsage", () => {
  test("copies every guest day when the destination has no usage", async () => {
    const { client, database } = await testDatabase();
    try {
      await client.executeMultiple(`
        insert into search_usage values ('guest-1', '2026-08-23', 2, 10);
        insert into search_usage values ('guest-1', '2026-08-24', 3, 20);
      `);

      await transferAnonymousSearchUsage({
        database,
        anonymousUserId: "guest-1",
        newUserId: "user-1",
      });

      const result = await client.execute(
        "select day, count from search_usage where user_id = 'user-1' order by day",
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]?.day).toBe("2026-08-23");
      expect(result.rows[0]?.count).toBe(2);
      expect(result.rows[1]?.day).toBe("2026-08-24");
      expect(result.rows[1]?.count).toBe(3);
      const source = await client.execute(
        "select count(*) as count from search_usage where user_id = 'guest-1'",
      );
      expect(source.rows[0]?.count).toBe(0);
    } finally {
      client.close();
    }
  });

  test("adds guest usage to an existing destination day", async () => {
    const { client, database } = await testDatabase();
    try {
      await client.executeMultiple(`
        insert into search_usage values ('guest-1', '2026-08-24', 3, 20);
        insert into search_usage values ('user-1', '2026-08-24', 4, 10);
      `);

      await transferAnonymousSearchUsage({
        database,
        anonymousUserId: "guest-1",
        newUserId: "user-1",
      });

      const result = await client.execute(
        "select count, updated_at from search_usage where user_id = 'user-1' and day = '2026-08-24'",
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.count).toBe(7);
      expect(result.rows[0]?.updated_at).toBe(20);
    } finally {
      client.close();
    }
  });

  test("consumes guest usage exactly once across concurrent and repeated callbacks", async () => {
    const { client, database } = await testDatabase();
    try {
      await client.executeMultiple(`
        insert into search_usage values ('guest-1', '2026-08-24', 3, 20);
        insert into search_usage values ('user-1', '2026-08-24', 4, 10);
      `);

      const transfer = () =>
        transferAnonymousSearchUsage({
          database,
          anonymousUserId: "guest-1",
          newUserId: "user-1",
        });
      await Promise.all([transfer(), transfer()]);
      await transfer();

      const result = await client.execute(
        "select count from search_usage where user_id = 'user-1' and day = '2026-08-24'",
      );
      expect(result.rows[0]?.count).toBe(7);
    } finally {
      client.close();
    }
  });
});
