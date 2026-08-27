import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const LEGACY_SCHEMA = `
  create table user (
    id text primary key,
    name text not null,
    email text not null unique,
    email_verified integer not null default 0,
    image text,
    discord_id text,
    discord_app_installed integer not null default 0,
    location_preference_mode text,
    location_zip_code text,
    location_lat real,
    location_lng real,
    created_at integer not null default 0,
    updated_at integer not null default 0
  );
  create table saved_search (id text primary key);
  create table vehicle (vin text primary key, location_code text not null);
  create table ingestion_run (
    id text primary key,
    status text not null,
    errors text,
    started_at integer not null,
    completed_at integer
  );
  create table ingestion_source_run (id text primary key);
  create table vehicle_snapshot (run_id text, vin text, source text);
  create table vehicle_change (
    id integer primary key autoincrement,
    run_id text not null,
    vin text not null,
    change_type text not null,
    payload text,
    payload_version integer not null default 1,
    created_at integer not null default 0,
    processed_at integer
  );
  create index vehicle_change_run_id_idx on vehicle_change(run_id);
  create index vehicle_change_vin_idx on vehicle_change(vin);
  create index vehicle_change_processed_at_idx on vehicle_change(processed_at, id);
`;

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

async function createMigratedClient() {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(LEGACY_SCHEMA);
    await client.execute(
      "insert into user (id, name, email) values ('existing-user', 'Existing', 'existing@example.com')",
    );
    await migrate(drizzle(client), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

describe("migration chain", () => {
  test("applies every migration and preserves billing constraints", async () => {
    const client = await createMigratedClient();
    try {
      const result = await client.execute(
        `select terms_accepted_at, terms_version
         from user where id = 'existing-user'`,
      );
      expect(result.rows[0]).toMatchObject({
        terms_accepted_at: null,
        terms_version: null,
      });

      const operations = await client.execute(
        "select count(*) as count from billing_operation",
      );
      expect(operations.rows[0]?.count).toBe(0);

      const retiredSearchUsage = await client.execute(
        "select name from sqlite_master where type = 'table' and name = 'search_usage'",
      );
      expect(retiredSearchUsage.rows).toHaveLength(0);

      await expect(
        client.execute(
          `insert into billing_operation (user_id, state, expires_at)
           values ('existing-user', 'checkout_claimed', 1787680800000)`,
        ),
      ).rejects.toThrow();
      await expect(
        client.execute(
          `insert into billing_operation (user_id, state, expires_at)
           values ('existing-user', 'checkout_open', 1787680800000)`,
        ),
      ).resolves.toBeDefined();

      const journal = await client.execute(
        "select count(*) as count from __drizzle_migrations",
      );
      const migrationCount = (await readdir(MIGRATIONS_FOLDER)).filter(
        (fileName) => fileName.endsWith(".sql"),
      ).length;
      expect(journal.rows[0]?.count).toBe(migrationCount);
    } finally {
      client.close();
    }
  });

  test("deletes account-linked yard requests but preserves anonymous requests", async () => {
    const client = await createMigratedClient();
    try {
      await client.execute(
        `insert into yard_request (id, user_id, yard_name, requester_email)
         values ('linked-request', 'existing-user', 'Linked Yard', 'existing@example.com')`,
      );
      await client.execute(
        `insert into yard_request (id, user_id, yard_name, requester_email)
         values ('anonymous-request', null, 'Anonymous Yard', null)`,
      );

      await client.execute("delete from user where id = 'existing-user'");

      const remainingRequests = await client.execute(
        "select id from yard_request order by id",
      );
      expect(remainingRequests.rows.map((row) => row.id)).toEqual([
        "anonymous-request",
      ]);
    } finally {
      client.close();
    }
  });
});
