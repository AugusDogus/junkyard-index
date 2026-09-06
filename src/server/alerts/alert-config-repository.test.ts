import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEARCHABLE_VEHICLE_YEAR_RANGE } from "~/lib/saved-search-filters";
import {
  disableUserAlertChannels,
  setSearchAlertChannel,
  updateSavedSearch,
} from "./alert-config-repository";

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
    last_checked_at integer, alert_quarantined_at integer,
    alert_quarantine_reason text, processing_lock integer,
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
  test("resets alert matching only when match criteria change", async () => {
    const directory = mkdtempSync(join(tmpdir(), "alert-config-test-"));
    const client = createClient({ url: `file:${join(directory, "test.db")}` });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      await client.executeMultiple(`
        insert into user (id) values ('user-1');
        insert into ingestion_run (id, publication_sequence) values ('run-1', 4);
        insert into saved_search (
          id, user_id, name, query, filters, email_alerts_enabled,
          search_match_version, email_start_sequence, discord_start_sequence,
          last_matched_publication_sequence, last_checked_at,
          alert_quarantined_at, alert_quarantine_reason, created_at, updated_at
        ) values (
          'search-1', 'user-1', 'Old', 'ford', '{}', 1, 3, 2, 2, 2,
          1000, 1000, 'Too broad', 1, 1
        );
        insert into search_notification_intent (
          id, run_id, publication_sequence, saved_search_id, user_id, channel,
          search_match_version, channel_config_version, payload, status,
          attempts, created_at
        ) values (
          'email-1', 'run-1', 4, 'search-1', 'user-1', 'email', 3, 1,
          '{}', 'pending', 0, 1
        );
      `);
      const database = drizzle(client);

      expect(
        await updateSavedSearch({
          database,
          searchId: "search-1",
          userId: "user-1",
          name: "Renamed",
          query: "ford",
          filters: JSON.stringify({
            minYear: SEARCHABLE_VEHICLE_YEAR_RANGE.min,
            maxYear: SEARCHABLE_VEHICLE_YEAR_RANGE.max,
            sortBy: "oldest",
          }),
        }),
      ).toBe(true);
      const metadataOnlySearch = await client.execute(
        `select name, search_match_version, email_start_sequence,
                discord_start_sequence, last_matched_publication_sequence,
                last_checked_at
         from saved_search where id = 'search-1'`,
      );
      expect(metadataOnlySearch.rows[0]).toMatchObject({
        name: "Renamed",
        search_match_version: 3,
        email_start_sequence: 2,
        discord_start_sequence: 2,
        last_matched_publication_sequence: 2,
        last_checked_at: 1000,
      });
      const preservedIntent = await client.execute(
        "select status, cancelled_at from search_notification_intent where id = 'email-1'",
      );
      expect(preservedIntent.rows[0]).toMatchObject({
        status: "pending",
        cancelled_at: null,
      });

      expect(
        await updateSavedSearch({
          database,
          searchId: "search-1",
          userId: "user-1",
          name: "New",
          query: "honda",
          filters: '{"minYear":2008}',
        }),
      ).toBe(true);

      const search = await client.execute(
        `select name, query, filters, search_match_version,
                email_start_sequence, discord_start_sequence,
                last_matched_publication_sequence, last_checked_at,
                alert_quarantined_at, alert_quarantine_reason
         from saved_search where id = 'search-1'`,
      );
      expect(search.rows[0]).toMatchObject({
        name: "New",
        query: "honda",
        filters: '{"minYear":2008}',
        search_match_version: 4,
        email_start_sequence: 4,
        discord_start_sequence: 4,
        last_matched_publication_sequence: 4,
        alert_quarantined_at: null,
        alert_quarantine_reason: null,
      });
      expect(Number(search.rows[0]?.last_checked_at)).toBeGreaterThan(1000);
      const intent = await client.execute(
        "select status, cancelled_at from search_notification_intent where id = 'email-1'",
      );
      expect(intent.rows[0]?.status).toBe("cancelled");
      expect(Number(intent.rows[0]?.cancelled_at)).toBeGreaterThan(1000);
    } finally {
      client.close();
      rmSync(directory, { recursive: true });
    }
  });

  for (const mode of [
    "channels",
    "criteria_and_channels",
    "rollback",
  ] as const) {
    test(`saves search and channel edits atomically: ${mode}`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "saved-search-edit-test-"));
      const client = createClient({
        url: `file:${join(directory, "test.db")}`,
      });
      try {
        await client.executeMultiple(TEST_SCHEMA);
        await client.executeMultiple(`
          insert into user (id) values ('user-1');
          insert into ingestion_run (id, publication_sequence) values ('run-1', 4);
          insert into saved_search (
            id, user_id, name, query, filters, email_alerts_enabled, discord_alerts_enabled,
            search_match_version, email_start_sequence, discord_start_sequence,
            last_matched_publication_sequence, created_at, updated_at
          ) values ('search-1', 'user-1', 'Old', 'ford', '{}', 1, 0, 3, 2, 2, 2, 1, 1),
                   ('search-2', 'user-1', 'Other', 'ford', '{}', 1, 0, 3, 2, 2, 2, 1, 1);
          insert into search_notification_intent (
            id, run_id, publication_sequence, saved_search_id, user_id, channel,
            search_match_version, channel_config_version, payload, status, attempts, created_at
          ) values ('email-1', 'run-1', 4, 'search-1', 'user-1', 'email', 3, 1, '{}', 'pending', 0, 1),
                   ('email-2', 'run-1', 4, 'search-2', 'user-1', 'email', 3, 1, '{}', 'pending', 0, 1);
        `);
        if (mode === "rollback")
          await client.executeMultiple(`
          create trigger fail_cancellation before update on search_notification_intent
          begin select raise(abort, 'Cancellation failed'); end;
        `);
        const update = updateSavedSearch({
          database: drizzle(client),
          searchId: "search-1",
          userId: "user-1",
          name: "Updated",
          query: mode === "channels" ? "ford" : "honda",
          filters: "{}",
          emailAlertsEnabled: false,
          discordAlertsEnabled: true,
        });
        if (mode === "rollback") await expect(update).rejects.toThrow();
        else expect(await update).toBe(true);
        const searches = await client.execute(
          "select * from saved_search order by id",
        );
        expect(searches.rows[0]).toMatchObject(
          mode === "rollback"
            ? {
                name: "Old",
                query: "ford",
                email_alerts_enabled: 1,
                discord_alerts_enabled: 0,
                email_config_version: 1,
                discord_config_version: 1,
                search_match_version: 3,
              }
            : {
                name: "Updated",
                query: mode === "channels" ? "ford" : "honda",
                email_alerts_enabled: 0,
                discord_alerts_enabled: 1,
                email_config_version: 2,
                discord_config_version: 2,
                search_match_version: mode === "channels" ? 3 : 4,
                email_start_sequence: mode === "channels" ? 2 : 4,
                discord_start_sequence: 4,
                last_matched_publication_sequence: mode === "channels" ? 2 : 4,
              },
        );
        expect(searches.rows[1]).toMatchObject({
          name: "Other",
          email_alerts_enabled: 1,
          discord_alerts_enabled: 0,
          email_config_version: 1,
          discord_config_version: 1,
        });
        const intents = await client.execute(
          "select id, status from search_notification_intent order by id",
        );
        expect(intents.rows[0]?.status).toBe(
          mode === "rollback" ? "pending" : "cancelled",
        );
        expect(intents.rows[1]?.status).toBe("pending");
      } finally {
        client.close();
        rmSync(directory, { recursive: true });
      }
    });
  }

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

  test("disabling a user's alerts updates both channels and intents atomically", async () => {
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

      expect(
        await disableUserAlertChannels({ database, userId: "user-1" }),
      ).toEqual(["search-1"]);

      const search = await client.execute(
        "select email_alerts_enabled, discord_alerts_enabled, email_config_version, discord_config_version from saved_search",
      );
      expect(search.rows[0]?.email_alerts_enabled).toBe(0);
      expect(search.rows[0]?.discord_alerts_enabled).toBe(0);
      expect(search.rows[0]?.email_config_version).toBe(2);
      expect(search.rows[0]?.discord_config_version).toBe(2);
      const intents = await client.execute(
        "select status from search_notification_intent order by id",
      );
      expect(intents.rows.map(({ status }) => status)).toEqual([
        "cancelled",
        "cancelled",
      ]);
    } finally {
      client.close();
      rmSync(directory, { recursive: true });
    }
  });
});
