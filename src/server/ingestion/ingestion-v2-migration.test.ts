import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { resolve } from "node:path";

const LEGACY_SCHEMA = `
  create table user (id text primary key);
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

const clients: Client[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

describe("ingestion v2 migration", () => {
  test("upgrades legacy data and enforces the new invariants", async () => {
    const client = createClient({ url: ":memory:" });
    clients.push(client);
    await client.executeMultiple(LEGACY_SCHEMA);
    await client.executeMultiple(`
      insert into vehicle values ('vin-1', 'yard-a');
      insert into vehicle values ('vin-2', 'yard-b');
      insert into ingestion_run values ('old-success', 'success', null, 1000, 2000);
      insert into ingestion_run values ('latest-success', 'success', null, 3000, 4000);
      insert into ingestion_run values ('running', 'running', null, 5000, null);
      insert into vehicle_change (run_id, vin, change_type, processed_at) values ('latest-success', 'vin-1', 'upsert', null);
      insert into vehicle_change (run_id, vin, change_type, processed_at) values ('latest-success', 'vin-1', 'upsert', null);
      insert into vehicle_change (run_id, vin, change_type, processed_at) values ('old-success', 'vin-2', 'upsert', 2000);
    `);

    const migrationPath = resolve(
      import.meta.dir,
      "../../../drizzle/0000_ingestion_v2.sql",
    );
    const migration = await Bun.file(migrationPath).text();
    await client.executeMultiple(
      migration.replaceAll("--> statement-breakpoint", ""),
    );

    const latestSuccess = await client.execute({
      sql: `select stage, last_progress_at, publication_sequence,
                   published_vehicle_count, published_yard_count
            from ingestion_run where id = ?`,
      args: ["latest-success"],
    });
    expect(latestSuccess.rows[0]).toMatchObject({
      stage: "released",
      last_progress_at: 3000,
      publication_sequence: 1,
      published_vehicle_count: null,
      published_yard_count: null,
    });

    const running = await client.execute({
      sql: "select active_slot, last_progress_at from ingestion_run where id = ?",
      args: ["running"],
    });
    expect(running.rows[0]).toMatchObject({
      active_slot: 1,
      last_progress_at: 5000,
    });

    const changes = await client.execute(
      "select count(*) as count from vehicle_change",
    );
    expect(changes.rows[0]?.count).toBe(1);

    const pendingChange = await client.execute(
      "select id, processed_at from vehicle_change",
    );
    expect(pendingChange.rows[0]).toMatchObject({ id: 2, processed_at: null });

    const changeIndexes = await client.execute(
      "select name from sqlite_master where type = 'index' and tbl_name = 'vehicle_change'",
    );
    expect(changeIndexes.rows.map((row) => row.name)).toContain(
      "vehicle_change_run_vin_type_idx",
    );

    const migrationTables = await client.execute(
      "select name from sqlite_master where type = 'table' and name like 'vehicle_change%migration%'",
    );
    expect(migrationTables.rows).toHaveLength(0);

    const intentTable = await client.execute(
      "select name from sqlite_master where type = 'table' and name = 'search_notification_intent'",
    );
    expect(intentTable.rows[0]?.name).toBe("search_notification_intent");

    await expect(
      client.execute({
        sql: "insert into ingestion_run (id, status, started_at, active_slot) values (?, ?, ?, ?)",
        args: ["second-running", "running", 6000, 1],
      }),
    ).rejects.toThrow();
  });
});
