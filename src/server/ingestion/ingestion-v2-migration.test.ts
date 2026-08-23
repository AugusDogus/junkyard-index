import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { getTableName } from "drizzle-orm";
import { resolve } from "node:path";
import { legacyVehicleChange, vehicleChange } from "~/schema";

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
  test("models both the archived and active change logs", () => {
    expect(getTableName(legacyVehicleChange)).toBe("vehicle_change");
    expect(getTableName(vehicleChange)).toBe("vehicle_change_v2");
  });

  test("preserves both change logs in every migration snapshot", async () => {
    for (const snapshotName of ["0000_snapshot.json", "0001_snapshot.json"]) {
      const snapshot = await Bun.file(
        resolve(import.meta.dir, `../../../drizzle/meta/${snapshotName}`),
      ).text();
      expect(snapshot).toContain('"vehicle_change": {');
      expect(snapshot).toContain('"vehicle_change_v2": {');
    }
  });

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
      insert into vehicle_change (run_id, vin, change_type, processed_at) values ('latest-success', 'vin-1', 'upsert', 4000);
      insert into vehicle_change (run_id, vin, change_type, processed_at) values ('latest-success', 'vin-1', 'upsert', 4001);
      insert into vehicle_change (run_id, vin, change_type, processed_at) values ('old-success', 'vin-2', 'upsert', 2000);
    `);

    const migrationPath = resolve(
      import.meta.dir,
      "../../../drizzle/0000_ingestion_v2.sql",
    );
    const migration = await Bun.file(migrationPath).text();
    const forwardMigration = await Bun.file(
      resolve(
        import.meta.dir,
        "../../../drizzle/0001_create_vehicle_change_v2.sql",
      ),
    ).text();
    const migrations = `${migration}\n${forwardMigration}`;
    expect(migrations).not.toContain("update ingestion_run");
    expect(migrations).not.toContain("drop table vehicle_change");
    expect(migrations).not.toContain("delete from vehicle_change");
    expect(migrations).not.toContain(" on vehicle_change(");
    await client.executeMultiple(
      migration.replaceAll("--> statement-breakpoint", ""),
    );
    await client.executeMultiple(
      forwardMigration.replaceAll("--> statement-breakpoint", ""),
    );

    const latestSuccess = await client.execute({
      sql: `select status, errors, started_at, completed_at,
                   stage, active_slot, last_progress_at,
                   full_reindex_required, publication_sequence
            from ingestion_run where id = ?`,
      args: ["latest-success"],
    });
    expect(latestSuccess.rows[0]).toMatchObject({
      status: "success",
      errors: null,
      started_at: 3000,
      completed_at: 4000,
      stage: "sources",
      active_slot: null,
      last_progress_at: 0,
      full_reindex_required: 0,
      publication_sequence: null,
    });

    const running = await client.execute({
      sql: `select status, started_at, completed_at, active_slot,
                   last_progress_at, full_reindex_required
            from ingestion_run where id = ?`,
      args: ["running"],
    });
    expect(running.rows[0]).toMatchObject({
      status: "running",
      started_at: 5000,
      completed_at: null,
      active_slot: null,
      last_progress_at: 0,
      full_reindex_required: 0,
    });

    const changes = await client.execute(
      "select count(*) as count from vehicle_change",
    );
    expect(changes.rows[0]?.count).toBe(3);

    const preservedChanges = await client.execute(
      "select id, processed_at from vehicle_change order by id",
    );
    expect(preservedChanges.rows).toHaveLength(3);
    expect(
      preservedChanges.rows.every((row) => row.processed_at !== null),
    ).toBe(true);

    const legacyChangeIndexes = await client.execute(
      "select name from sqlite_master where type = 'index' and tbl_name = 'vehicle_change'",
    );
    expect(legacyChangeIndexes.rows.map((row) => row.name)).not.toContain(
      "vehicle_change_v2_run_vin_type_idx",
    );

    const newChanges = await client.execute(
      "select count(*) as count from vehicle_change_v2",
    );
    expect(newChanges.rows[0]?.count).toBe(0);
    const newChangeIndexes = await client.execute(
      "select name from sqlite_master where type = 'index' and tbl_name = 'vehicle_change_v2'",
    );
    expect(newChangeIndexes.rows.map((row) => row.name)).toContain(
      "vehicle_change_v2_run_vin_type_idx",
    );
    await client.execute(
      "insert into vehicle_change_v2 (run_id, vin, change_type) values ('latest-success', 'vin-1', 'upsert')",
    );
    await expect(
      client.execute(
        "insert into vehicle_change_v2 (run_id, vin, change_type) values ('latest-success', 'vin-1', 'upsert')",
      ),
    ).rejects.toThrow();

    const migrationTables = await client.execute(
      "select name from sqlite_master where type = 'table' and name like 'vehicle_change%migration%'",
    );
    expect(migrationTables.rows).toHaveLength(0);

    const intentTable = await client.execute(
      "select name from sqlite_master where type = 'table' and name = 'search_notification_intent'",
    );
    expect(intentTable.rows[0]?.name).toBe("search_notification_intent");

    await client.execute({
      sql: "insert into ingestion_run (id, status, started_at, active_slot) values (?, ?, ?, ?)",
      args: ["fresh-running", "running", 6000, 1],
    });
    await expect(
      client.execute({
        sql: "insert into ingestion_run (id, status, started_at, active_slot) values (?, ?, ?, ?)",
        args: ["second-running", "running", 7000, 1],
      }),
    ).rejects.toThrow();
  });

  test("creates the new change log after 0000 was already journaled", async () => {
    const client = createClient({ url: ":memory:" });
    clients.push(client);
    await client.executeMultiple(LEGACY_SCHEMA);
    await client.executeMultiple(`
      insert into ingestion_run values ('legacy-run', 'success', null, 1000, 2000);
      insert into vehicle_change (run_id, vin, change_type, processed_at)
      values ('legacy-run', 'legacy-vin', 'upsert', 2000);
    `);
    const legacyObjectsBefore = await client.execute(
      `select type, name, tbl_name, sql from sqlite_master
       where tbl_name = 'vehicle_change' order by type, name`,
    );
    const legacyRowsBefore = await client.execute(
      "select * from vehicle_change order by id",
    );
    const forwardMigration = await Bun.file(
      resolve(
        import.meta.dir,
        "../../../drizzle/0001_create_vehicle_change_v2.sql",
      ),
    ).text();

    await client.executeMultiple(
      forwardMigration.replaceAll("--> statement-breakpoint", ""),
    );
    await client.executeMultiple(
      forwardMigration.replaceAll("--> statement-breakpoint", ""),
    );

    const legacyObjectsAfter = await client.execute(
      `select type, name, tbl_name, sql from sqlite_master
       where tbl_name = 'vehicle_change' order by type, name`,
    );
    const legacyRowsAfter = await client.execute(
      "select * from vehicle_change order by id",
    );
    expect(legacyObjectsAfter.rows).toEqual(legacyObjectsBefore.rows);
    expect(legacyRowsAfter.rows).toEqual(legacyRowsBefore.rows);
    const newChanges = await client.execute(
      "select count(*) as count from vehicle_change_v2",
    );
    expect(newChanges.rows[0]?.count).toBe(0);
  });
});
