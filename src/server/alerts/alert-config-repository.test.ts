import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSearchAlertChannel } from "./alert-config-repository";

const TEST_SCHEMA = `
  create table user (id text primary key);
  create table ingestion_run (
    id text primary key,
    publication_sequence integer
  );
  create table saved_search (
    id text primary key, user_id text not null, name text not null,
    query text not null, filters text not null,
    email_alerts_enabled integer not null default 0,
    discord_alerts_enabled integer not null default 0,
    search_match_version integer not null default 1,
    email_config_version integer not null default 1,
    discord_config_version integer not null default 1,
    email_start_sequence integer not null default 0,
    discord_start_sequence integer not null default 0,
    last_matched_publication_sequence integer not null default 0,
    last_checked_at integer, processing_lock integer,
    created_at integer not null, updated_at integer not null
  );
  create table search_notification_intent (
    id text primary key, run_id text not null, publication_sequence integer not null,
    saved_search_id text not null, user_id text not null, channel text not null,
    search_match_version integer not null, channel_config_version integer not null,
    payload text not null, status text not null, attempts integer not null,
    claim_token text, claimed_at integer, next_attempt_at integer,
    last_error text, created_at integer not null, delivered_at integer,
    cancelled_at integer
  );
`;

describe("alert configuration versions", () => {
  test("disabling email cancels only email intents and bumps only email state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "alert-config-test-"));
    const client = createClient({ url: `file:${join(directory, "test.db")}` });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      await client.executeMultiple(`
        insert into user (id) values ('user-1');
        insert into ingestion_run (id, publication_sequence) values ('run-1', 4);
        insert into saved_search (
          id, user_id, name, query, filters, email_alerts_enabled,
          discord_alerts_enabled, created_at, updated_at
        ) values ('search-1', 'user-1', 'Search', 'ford', '{}', 1, 1, 1, 1);
        insert into search_notification_intent (
          id, run_id, publication_sequence, saved_search_id, user_id, channel,
          search_match_version, channel_config_version, payload, status,
          attempts, created_at
        ) values
          ('email-1', 'run-1', 4, 'search-1', 'user-1', 'email', 1, 1, '{}', 'pending', 0, 1),
          ('discord-1', 'run-1', 4, 'search-1', 'user-1', 'discord', 1, 1, '{}', 'pending', 0, 1);
      `);
      const database = drizzle(client);
      await setSearchAlertChannel({
        database,
        searchId: "search-1",
        userId: "user-1",
        channel: "email",
        enabled: false,
      });
      const search = await client.execute(
        "select email_alerts_enabled, email_config_version, discord_config_version from saved_search",
      );
      expect(search.rows[0]?.email_alerts_enabled).toBe(0);
      expect(search.rows[0]?.email_config_version).toBe(2);
      expect(search.rows[0]?.discord_config_version).toBe(1);
      const intents = await client.execute(
        "select id, status from search_notification_intent order by id",
      );
      expect(intents.rows).toHaveLength(2);
      expect(intents.rows[0]?.id).toBe("discord-1");
      expect(intents.rows[0]?.status).toBe("pending");
      expect(intents.rows[1]?.id).toBe("email-1");
      expect(intents.rows[1]?.status).toBe("cancelled");
    } finally {
      client.close();
      rmSync(directory, { recursive: true });
    }
  });
});
