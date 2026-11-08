import { createClient, type Client } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

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
  create table saved_search (id text primary key, last_checked_at integer);
  create table vehicle (
    vin text primary key,
    source text not null default 'pyp',
    location_code text not null,
    location_name text not null default 'Yard',
    location_city text not null default 'Unknown',
    state_abbr text not null default 'CA',
    lat real not null default 0,
    lng real not null default 0,
    details_url text,
    first_seen_at integer not null default 0,
    missing_since_at integer
  );
  create table ingestion_run (
    id text primary key,
    source text not null,
    status text not null,
    errors text,
    started_at integer not null,
    completed_at integer
  );
  create table ingestion_source_run (
    id text primary key,
    started_at integer not null default 0
  );
  create table vehicle_snapshot (run_id text, vin text, source text);
  create table autorecycler_org_geo (
    org_lookup text primary key,
    lat real not null,
    lng real not null,
    location_name text not null,
    location_city text not null default 'Unknown',
    state text not null,
    state_abbr text not null,
    address text,
    updated_at integer not null
  );
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

      const arrivalColumns = await client.execute("pragma table_info(vehicle)");
      expect(
        arrivalColumns.rows.find(
          (column) => column.name === "observed_arrival_at",
        ),
      ).toMatchObject({
        type: "INTEGER",
        notnull: 0,
        dflt_value: null,
      });

      const operations = await client.execute(
        "select count(*) as count from billing_operation",
      );
      expect(operations.rows[0]?.count).toBe(0);

      const retiredSearchUsage = await client.execute(
        "select name from sqlite_master where type = 'table' and name = 'search_usage'",
      );
      expect(retiredSearchUsage.rows).toHaveLength(0);
      expect(
        (
          await client.execute(
            "select count(*) as count from vehicle_observation",
          )
        ).rows[0]?.count,
      ).toBe(0);

      const row52Exclusions = await client.execute(
        "select location_id, reason from row52_yard_exclusion order by location_id",
      );
      expect(row52Exclusions.rows).toHaveLength(1);
      expect(row52Exclusions.rows[0]?.location_id).toBe(83);
      expect(row52Exclusions.rows[0]?.reason).toBe(
        "Former PICK-n-PULL Tallahassee yard acquired by GO Pull-It",
      );

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

  test("seeds existing yards without inventing observed dates", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(LEGACY_SCHEMA);
      await client.execute(
        "insert into vehicle (vin, source, location_code, first_seen_at) values ('old-car', 'pyp', 'yard-1', 123)",
      );
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
      expect(
        (await client.execute("select * from yard_arrival_baseline")).rows.map(
          (row) => ({
            source: row.source,
            location_code: row.location_code,
            established_at: row.established_at,
          }),
        ),
      ).toEqual([
        { source: "pyp", location_code: "yard-1", established_at: 0 },
      ]);
      expect(
        (
          await client.execute(
            "select observed_arrival_at, first_seen_at from vehicle",
          )
        ).rows.map((row) => ({
          observed_arrival_at: row.observed_arrival_at,
          first_seen_at: row.first_seen_at,
        })),
      ).toEqual([{ observed_arrival_at: null, first_seen_at: 123 }]);
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

test("publish-turn waits search active runs instead of scanning run history", async () => {
  const client = await createMigratedClient();
  try {
    const { createDurableIngestionRepository } =
      await import("./ingestion/durable-ingestion-repository");
    const { IngestionSnapshotStore } =
      await import("./ingestion/ingestion-snapshot-store");
    const statements: Array<Parameters<Client["batch"]>[0][number]> = [];
    const repository = createDurableIngestionRepository(
      drizzle(client),
      {
        async batch(batch, mode) {
          statements.push(...batch);
          return client.batch(batch, mode);
        },
      },
      IngestionSnapshotStore.memory(),
    );
    await client.execute(
      "insert into ingestion_run (id, source, status, stage, active_slot, started_at, last_progress_at) values ('claim', 'pyp', 'running', 'sources', 1, 0, 0)",
    );
    await repository.claimCommit("claim");
    const claim = statements.at(-1);
    if (!claim || typeof claim === "string" || Array.isArray(claim))
      throw new Error("Expected a claim statement");
    const plan = await client.execute({
      ...claim,
      sql: `EXPLAIN QUERY PLAN ${claim.sql}`,
    });
    const details = plan.rows.map((row) => String(row.detail));
    expect(details.filter((detail) => detail.includes("SCAN other"))).toEqual(
      [],
    );
    expect(
      details.filter(
        (detail) =>
          detail.includes("SEARCH other") &&
          detail.includes("ingestion_run_active_commit_idx"),
      ),
    ).toHaveLength(2);
  } finally {
    client.close();
  }
});

test("source-scoped VIN pagination uses the source/VIN index", async () => {
  const client = await createMigratedClient();
  try {
    const plan = await client.execute({
      sql: "EXPLAIN QUERY PLAN SELECT vin, source, missing_since_at FROM vehicle WHERE source IN (?) AND vin > ? ORDER BY vin LIMIT 500",
      args: ["pyp", "VIN-1"],
    });
    const details = plan.rows.map((row) => String(row.detail));
    expect(
      details.some((detail) =>
        detail.includes(
          "SEARCH vehicle USING INDEX vehicle_source_vin_idx (source=? AND vin>?)",
        ),
      ),
    ).toBe(true);
  } finally {
    client.close();
  }
});

test("upgrades production through 0016 with ordered arrival, ingestion, departure and inventory migrations", async () => {
  const client = createClient({ url: ":memory:" });
  const folder = await mkdtemp(join(tmpdir(), "junkyard-migrations-"));
  try {
    const journal = z
      .object({
        version: z.string(),
        dialect: z.string(),
        entries: z.array(
          z.object({
            idx: z.number(),
            version: z.string(),
            when: z.number(),
            tag: z.string(),
            breakpoints: z.boolean(),
          }),
        ),
      })
      .parse(
        JSON.parse(
          await readFile(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"),
        ),
      );
    // Assert the actual metadata as well as exercising libSQL's timestamp gate.
    expect(
      journal.entries.slice(17).map((entry) => [entry.tag, entry.when]),
    ).toEqual([
      ["0017_observed_vehicle_arrival", 1794787200000],
      ["0018_ingestion_cost_indexes", 1794871322488],
      ["0019_vehicle_departure", 1794992048862],
      ["0020_inventory_snapshot", 1794992409438],
    ]);
    for (let i = 1; i < journal.entries.length; i++) {
      const current = journal.entries[i];
      const previous = journal.entries[i - 1];
      if (!current || !previous)
        throw new Error("Expected consecutive migration entries");
      expect(current.idx).toBe(previous.idx + 1);
      expect(current.when).toBeGreaterThan(previous.when);
    }
    const snapshot = z.object({ id: z.string(), prevId: z.string() });
    const prior = snapshot.parse(
      JSON.parse(
        await readFile(
          join(MIGRATIONS_FOLDER, "meta/0016_snapshot.json"),
          "utf8",
        ),
      ),
    );
    const arrival = snapshot.parse(
      JSON.parse(
        await readFile(
          join(MIGRATIONS_FOLDER, "meta/0017_snapshot.json"),
          "utf8",
        ),
      ),
    );
    const cost = snapshot.parse(
      JSON.parse(
        await readFile(
          join(MIGRATIONS_FOLDER, "meta/0018_snapshot.json"),
          "utf8",
        ),
      ),
    );
    expect(arrival.prevId).toBe(prior.id);
    expect(cost.prevId).toBe(arrival.id);
    const departure = snapshot.parse(
      JSON.parse(
        await readFile(
          join(MIGRATIONS_FOLDER, "meta/0019_snapshot.json"),
          "utf8",
        ),
      ),
    );
    expect(departure.prevId).toBe(cost.id);
    const inventory = snapshot.parse(
      JSON.parse(
        await readFile(
          join(MIGRATIONS_FOLDER, "meta/0020_snapshot.json"),
          "utf8",
        ),
      ),
    );
    expect(inventory.prevId).toBe(departure.id);
    await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 17) }),
    );
    await client.executeMultiple(LEGACY_SCHEMA);
    await migrate(drizzle(client), { migrationsFolder: folder });
    expect(
      (
        await client.execute(
          "select max(created_at) as last from __drizzle_migrations",
        )
      ).rows[0]?.last,
    ).toBe(1794107008473);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    expect(
      (await client.execute("select count(*) as n from __drizzle_migrations"))
        .rows[0]?.n,
    ).toBe(journal.entries.length);
    expect(
      (
        await client.execute(
          "select name from sqlite_master where type = 'index' and name = 'ingestion_run_retention_idx'",
        )
      ).rows,
    ).toHaveLength(1);
    expect((await client.execute("pragma foreign_key_check")).rows).toEqual([]);
  } finally {
    client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
