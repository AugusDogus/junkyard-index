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
    make text not null default 'Ford',
    location_code text not null,
    location_name text not null default 'Yard',
    location_city text not null default 'Unknown',
    state_abbr text not null default 'CA',
    lat real not null default 0,
    lng real not null default 0,
    details_url text,
    available_date text,
    first_seen_at integer not null default 0,
    last_seen_at integer not null default 0,
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
    run_id text,
    source text not null default 'pyp',
    status text not null default 'success',
    start_cursor text,
    next_cursor text,
    pages_processed integer not null default 0,
    vehicles_processed integer not null default 0,
    errors text,
    started_at integer not null default 0,
    completed_at integer
  );
  create index ingestion_source_run_run_id_idx on ingestion_source_run(run_id);
  create index ingestion_source_run_source_idx on ingestion_source_run(source);
  create index ingestion_source_run_status_idx on ingestion_source_run(status);
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

  test("classifies existing listings' first sightings by their yard's baseline", async () => {
    const client = createClient({ url: ":memory:" });
    const folder = await mkdtemp(join(tmpdir(), "junkyard-migrations-"));
    try {
      const journal = z
        .object({
          entries: z.array(z.object({ tag: z.string() }).passthrough()),
        })
        .passthrough()
        .parse(
          JSON.parse(
            await readFile(
              join(MIGRATIONS_FOLDER, "meta/_journal.json"),
              "utf8",
            ),
          ),
        );
      const through = journal.entries.findIndex(
        (entry) => entry.tag === "0027_vehicle_first_sighting",
      );
      expect(through).toBeGreaterThan(0);
      await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
      await writeFile(
        join(folder, "meta/_journal.json"),
        JSON.stringify({
          ...journal,
          entries: journal.entries.slice(0, through),
        }),
      );
      await client.executeMultiple(LEGACY_SCHEMA);
      await migrate(drizzle(client), { migrationsFolder: folder });
      await client.executeMultiple(`
        insert into yard_arrival_baseline values
          ('pyp', 'old', 0), ('calton', 'calton', 5000);
        insert into vehicle (vin, source, location_code, first_seen_at) values
          ('legacy', 'pyp', 'old', 100),
          ('backfill', 'calton', 'calton', 5000),
          ('arrival', 'calton', 'calton', 6000),
          ('unpublished', 'jimsimport', 'jims', 7000);
        insert into vehicle_departure (vin, source, location_code, year, make,
          model, first_seen_at, departed_at, recorded_at) values
          ('gone-backfill', 'calton', 'calton', 2000, 'Volvo', '240', 5000, 8000, 8000),
          ('gone-arrival', 'calton', 'calton', 2000, 'Volvo', '240', 5500, 8000, 8000);
      `);
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
      const sightings = async (table: string) =>
        (
          await client.execute(
            `select vin, first_sighting from ${table} order by vin`,
          )
        ).rows.map((row) => [row.vin, row.first_sighting]);
      expect(await sightings("vehicle")).toEqual([
        ["arrival", "arrival"],
        ["backfill", "yard_backfill"],
        ["legacy", "arrival"],
        ["unpublished", "yard_backfill"],
      ]);
      expect(await sightings("vehicle_departure")).toEqual([
        ["gone-arrival", "arrival"],
        ["gone-backfill", "yard_backfill"],
      ]);
    } finally {
      client.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  test("backfills yard checks with inherited dates and each yard's last change", async () => {
    const client = createClient({ url: ":memory:" });
    const folder = await mkdtemp(join(tmpdir(), "junkyard-migrations-"));
    try {
      const journal = z
        .object({
          entries: z.array(z.object({ tag: z.string() }).passthrough()),
        })
        .passthrough()
        .parse(
          JSON.parse(
            await readFile(
              join(MIGRATIONS_FOLDER, "meta/_journal.json"),
              "utf8",
            ),
          ),
        );
      const through = journal.entries.findIndex(
        (entry) => entry.tag === "0033_yard_check",
      );
      expect(through).toBeGreaterThan(0);
      await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
      await writeFile(
        join(folder, "meta/_journal.json"),
        JSON.stringify({
          ...journal,
          entries: journal.entries.slice(0, through),
        }),
      );
      await client.executeMultiple(LEGACY_SCHEMA);
      await migrate(drizzle(client), { migrationsFolder: folder });
      await client.executeMultiple(`
        insert into yard_inventory (source, location_code, location_name,
          location_city, state_abbr, lat, lng, vehicle_count, updated_at,
          last_published_at) values
          ('pyp', 'tulsa', 'Tulsa', 'Tulsa', 'OK', 0, 0, 2, 900, 800),
          ('pyp', 'okc', 'OKC', 'OKC', 'OK', 0, 0, 1, 900, null);
        insert into vehicle (vin, source, location_code, first_seen_at,
          last_seen_at, missing_since_at) values
          ('a', 'pyp', 'tulsa', 100, 300, null),
          ('b', 'pyp', 'tulsa', 200, 250, 400),
          ('c', 'pyp', 'okc', 150, 150, null);
      `);
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
      expect(
        (
          await client.execute(
            "select * from yard_check order by location_code",
          )
        ).rows.map((row) => ({
          yard: row.location_code,
          outcome: row.outcome,
          reportedAt: row.reported_at,
          lastCheckedAt: row.last_checked_at,
          lastCheckedRunId: row.last_checked_run_id,
          lastChangedAt: row.last_changed_at,
          lastArrivalAt: row.last_arrival_at,
        })),
      ).toEqual([
        {
          yard: "okc",
          outcome: "unreported",
          reportedAt: 900,
          lastCheckedAt: null,
          lastCheckedRunId: null,
          lastChangedAt: 150,
          lastArrivalAt: 150,
        },
        {
          yard: "tulsa",
          outcome: "unreported",
          reportedAt: 800,
          lastCheckedAt: 800,
          lastCheckedRunId: null,
          lastChangedAt: 400,
          lastArrivalAt: 200,
        },
      ]);
    } finally {
      client.close();
      await rm(folder, { recursive: true, force: true });
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

test("commit claims search active runs instead of scanning run history", async () => {
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
    const details: string[] = [];
    for (const statement of statements) {
      if (typeof statement === "string" || Array.isArray(statement))
        throw new Error("Expected parameterized claim statements");
      const plan = await client.execute({
        ...statement,
        sql: `EXPLAIN QUERY PLAN ${statement.sql}`,
      });
      details.push(...plan.rows.map((row) => String(row.detail)));
    }
    // Waiters retry every few minutes, so no claim statement may walk the
    // run history.
    expect(details.filter((detail) => detail.startsWith("SCAN"))).toEqual([]);
    expect(
      details.filter(
        (detail) =>
          detail.includes("SEARCH other") &&
          detail.includes("ingestion_run_commit_queue_idx"),
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

test("source freshness reads only the started_at index, never run cursors", async () => {
  const client = await createMigratedClient();
  try {
    const { loadSourceFreshness } = await import("./ingestion/durable-health");
    const queries: { sql: string; params: unknown[] }[] = [];
    await loadSourceFreshness(
      drizzle(client, {
        logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
      }),
      new Date("2026-11-23T01:00:00Z"),
    );
    const [query] = queries;
    if (!query) throw new Error("loadSourceFreshness ran no query.");
    const plan = await client.execute({
      sql: `EXPLAIN QUERY PLAN ${query.sql}`,
      args: query.params.map((param) =>
        typeof param === "number" || typeof param === "string" ? param : null,
      ),
    });
    // A table read pulls every recent run's megabyte cursors to reach
    // acceptance_status, which timed out prerendering on production.
    expect(plan.rows.map((row) => String(row.detail))).toContain(
      "SEARCH ingestion_source_run USING COVERING INDEX ingestion_source_run_started_at_idx (started_at>?)",
    );
  } finally {
    client.close();
  }
});

test("admin run reads stay in indexes, never run cursors or error text", async () => {
  const client = await createMigratedClient();
  try {
    const { SourceRunRepository } =
      await import("./admin/source-run-repository");
    const { SearchRepository } = await import("./admin/search-repository");
    const queries: { sql: string; params: unknown[] }[] = [];
    const db = drizzle(client, {
      logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
    });
    const since = new Date("2026-11-09T00:00:00Z");
    const plans = new Map<string, string[]>();
    // recent and recentForSource name ingestion_run_admin_idx with INDEXED
    // BY, so they throw here if a later migration drops or renames it.
    const reads = {
      recent: () => SourceRunRepository.recent(db, since),
      recentForSource: () =>
        SourceRunRepository.recentForSource(db, "pyp", since),
      forSource: () => SourceRunRepository.forSource(db, "pyp", 14),
      errorExcerpts: () =>
        SourceRunRepository.errorExcerpts(db, [
          { id: "a", source: "pyp", startedAt: since },
          { id: "b", source: "row52", startedAt: since },
        ]),
      fullReindexRequired: () => SearchRepository.fullReindexRequired(db),
    };
    for (const [name, read] of Object.entries(reads)) {
      queries.length = 0;
      await read();
      const [query] = queries;
      if (!query) throw new Error(`The admin read ${name} ran no query.`);
      const plan = await client.execute({
        sql: `EXPLAIN QUERY PLAN ${query.sql}`,
        args: query.params.map((param) =>
          typeof param === "number" || typeof param === "string" ? param : null,
        ),
      });
      plans.set(
        name,
        plan.rows.map((row) => String(row.detail)),
      );
    }
    // The table stores these columns after the run cursors, which reach
    // megabytes per run: a table read took 5 to 16 s on production.
    expect(plans.get("recent")).toEqual([
      "SEARCH ingestion_source_run USING COVERING INDEX ingestion_source_run_started_at_idx (started_at>?)",
      "SEARCH ingestion_run USING COVERING INDEX ingestion_run_admin_idx (id=?)",
    ]);
    expect(plans.get("recentForSource")).toEqual([
      "SEARCH ingestion_source_run USING COVERING INDEX ingestion_source_run_source_started_at_idx (source=? AND started_at>?)",
      "SEARCH ingestion_run USING COVERING INDEX ingestion_run_admin_idx (id=?)",
    ]);
    // These two also read the ingestion run's own error text, so they join
    // ingestion_run's table, for a few runs only (a page, or one per source).
    expect(plans.get("forSource")?.[0]).toBe(
      "SEARCH ingestion_source_run USING COVERING INDEX ingestion_source_run_source_started_at_idx (source=?)",
    );
    expect(plans.get("errorExcerpts")?.[0]).toBe(
      "SEARCH ingestion_source_run USING COVERING INDEX ingestion_source_run_source_started_at_idx (source=? AND started_at>?)",
    );
    // ingestion_run stores the flag after each run's error text.
    expect(plans.get("fullReindexRequired")).toEqual([
      "SEARCH ingestion_run USING INDEX ingestion_run_full_reindex_required_idx (full_reindex_required=?)",
    ]);
    for (const [name, details] of plans) {
      expect({
        name,
        scans: details.filter((d) => d.startsWith("SCAN")),
      }).toEqual({ name, scans: [] });
    }
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
    // Pin the released metadata as well as exercising libSQL's timestamp gate.
    // Later migrations are ordered by migration-journal.test.ts.
    expect(
      journal.entries.slice(17, 22).map((entry) => [entry.tag, entry.when]),
    ).toEqual([
      ["0017_observed_vehicle_arrival", 1794787200000],
      ["0018_ingestion_cost_indexes", 1794871322488],
      ["0019_vehicle_departure", 1794992048862],
      ["0020_inventory_snapshot", 1794992409438],
      ["0021_yard_publication", 1795046400000],
    ]);
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
    const publication = snapshot.parse(
      JSON.parse(
        await readFile(
          join(MIGRATIONS_FOLDER, "meta/0021_snapshot.json"),
          "utf8",
        ),
      ),
    );
    expect(publication.prevId).toBe(inventory.id);
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
    const publicationColumn = (
      await client.execute("pragma table_info(yard_inventory)")
    ).rows.find((row) => row.name === "last_published_at");
    expect(publicationColumn?.type).toBe("INTEGER");
    expect(publicationColumn?.notnull).toBe(0);
  } finally {
    client.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test("0022 keeps existing run-owned intents and requires exactly one intent owner", async () => {
  const client = createClient({ url: ":memory:" });
  const folder = await mkdtemp(join(tmpdir(), "junkyard-migrations-"));
  try {
    const journal = z
      .object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) })
      .passthrough()
      .parse(
        JSON.parse(
          await readFile(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"),
        ),
      );
    const before = journal.entries.findIndex(
      (entry) => entry.tag === "0022_daily_search_alert_check",
    );
    expect(before).toBeGreaterThan(0);
    await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, before) }),
    );
    await client.executeMultiple(LEGACY_SCHEMA);
    await migrate(drizzle(client), { migrationsFolder: folder });
    await client.executeMultiple(`
      insert into user (id, name, email) values ('user-1', 'User', 'user@example.com');
      insert into saved_search (id) values ('search-1');
      insert into ingestion_run (id, source, status, stage, started_at, last_progress_at)
        values ('run-1', 'pyp', 'success', 'released', 0, 0);
      insert into search_notification_intent (
        id, run_id, publication_sequence, saved_search_id, user_id, channel,
        search_match_version, channel_config_version, payload, status,
        attempts, delivery_group_id, claim_token, created_at
      ) values (
        'intent-1', 'run-1', 4, 'search-1', 'user-1', 'email', 2, 3, '{"a":1}',
        'retry', 1, 'email:digest:x', null, 123
      );
    `);

    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

    expect(
      (await client.execute("select * from search_notification_intent")).rows,
    ).toEqual([
      expect.objectContaining({
        id: "intent-1",
        run_id: "run-1",
        alert_check_id: null,
        publication_sequence: 4,
        status: "retry",
        attempts: 1,
        delivery_group_id: "email:digest:x",
        payload: '{"a":1}',
        created_at: 123,
      }),
    ]);
    expect((await client.execute("pragma foreign_key_check")).rows).toEqual([]);
    const insertIntent = (
      id: string,
      runId: string | null,
      checkId: string | null,
    ) =>
      client.execute({
        sql: `insert into search_notification_intent (
          id, run_id, alert_check_id, publication_sequence, saved_search_id,
          user_id, channel, search_match_version, channel_config_version,
          payload
        ) values (?, ?, ?, 5, 'search-1', 'user-1', 'discord', 1, 1, '{}')`,
        args: [id, runId, checkId],
      });
    await client.execute(
      "insert into search_alert_check (id, day, status, checked_through, started_at, last_progress_at) values ('check-1', '2026-11-20', 'running', 0, 0, 0)",
    );
    await expect(insertIntent("ownerless", null, null)).rejects.toThrow();
    await expect(insertIntent("both", "run-1", "check-1")).rejects.toThrow();
    await expect(
      insertIntent("checked", null, "check-1"),
    ).resolves.toBeDefined();
  } finally {
    client.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test("0024 generalizes consumer checkpoints, keeps live rows and drops dead ones", async () => {
  const client = createClient({ url: ":memory:" });
  const folder = await mkdtemp(join(tmpdir(), "junkyard-migrations-"));
  try {
    const journal = z
      .object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) })
      .passthrough()
      .parse(
        JSON.parse(
          await readFile(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"),
        ),
      );
    const before = journal.entries.findIndex(
      (entry) => entry.tag === "0024_consumer_checkpoint",
    );
    expect(before).toBeGreaterThan(0);
    await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, before) }),
    );
    await client.executeMultiple(LEGACY_SCHEMA);
    await migrate(drizzle(client), { migrationsFolder: folder });
    // Production created the table with drizzle-kit push, outside migrations.
    await client.executeMultiple(`
      create table ingestion_projector_checkpoint (
        name text primary key not null,
        last_processed_change_id integer default 0 not null,
        updated_at integer default (cast(unixepoch('subsecond') * 1000 as integer)) not null
      );
      insert into ingestion_projector_checkpoint (name, last_processed_change_id, updated_at) values
        ('vehicle_algolia', 3164343, 100),
        ('inventory-snapshot:v1', 826, 200),
        ('inventory-snapshot:v2', 826, 300),
        ('inventory-snapshot:v3', 826, 400),
        ('indexnow-announcement', 900, 500);
    `);

    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

    expect(
      (
        await client.execute(
          "select name, kind, last_processed_change_id, job_cursor, job_day, blocked_until, failure_count, last_error_tag, last_success_at, updated_at from ingestion_projector_checkpoint order by name",
        )
      ).rows,
    ).toEqual([
      expect.objectContaining({
        name: "indexnow-announcement",
        kind: "publication",
        last_processed_change_id: 900,
        job_cursor: null,
        job_day: null,
        blocked_until: null,
        failure_count: 0,
        last_error_tag: null,
        last_success_at: 500,
        updated_at: 500,
      }),
      expect.objectContaining({
        name: "inventory-snapshot:v3",
        kind: "publication",
        last_processed_change_id: 826,
        job_cursor: null,
        job_day: null,
        blocked_until: null,
        failure_count: 0,
        last_error_tag: null,
        last_success_at: 400,
        updated_at: 400,
      }),
    ]);
  } finally {
    client.close();
    await rm(folder, { recursive: true, force: true });
  }
});

// Previews and development share one database. It applied an earlier draft
// of the VIN schema as 0025 and 0026 (whens 1795449600000 and 1795536000000)
// before main took 0025, so 0026_vin_canonical_models uses the draft 0026's
// when: production (last 1795449600000) applies it, and the shared database,
// which already has every object in it, skips it.
const PREVIEW_VIN_DRAFT_MIGRATIONS = [
  {
    hash: "preview-0025-vin-canonical-models",
    when: 1795449600000,
    sql: `
      CREATE TABLE vehicle_model_redirect (from_path text PRIMARY KEY NOT NULL, to_path text NOT NULL);
      CREATE TABLE vin_decode_cache (pattern text PRIMARY KEY NOT NULL, data text, retry_after integer, updated_at integer NOT NULL);
      ALTER TABLE vehicle ADD source_make text;
      ALTER TABLE vehicle ADD source_model text;
    `,
  },
  {
    hash: "preview-0026-search-index-schema",
    when: 1795536000000,
    sql: "CREATE TABLE IF NOT EXISTS search_index_schema (index_name text PRIMARY KEY NOT NULL, version integer NOT NULL, updated_at integer NOT NULL);",
  },
];

async function migrateThroughMain(client: Client, folder: string) {
  const journal = z
    .object({
      entries: z.array(
        z.object({ tag: z.string(), when: z.number() }).passthrough(),
      ),
    })
    .passthrough()
    .parse(
      JSON.parse(
        await readFile(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"),
      ),
    );
  const vin = journal.entries.findIndex(
    (entry) => entry.tag === "0026_vin_canonical_models",
  );
  expect(vin).toBeGreaterThan(0);
  expect(journal.entries[vin]?.when).toBe(1795536000000);
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
  await writeFile(
    join(folder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, vin) }),
  );
  await client.executeMultiple(LEGACY_SCHEMA);
  await migrate(drizzle(client), { migrationsFolder: folder });
}

async function vinSchema(client: Client) {
  const tables = await client.execute(
    "select name from sqlite_master where type = 'table' and name in ('search_index_schema', 'vehicle_model_redirect', 'vin_decode_cache') order by name",
  );
  const columns = await client.execute(
    "select name from pragma_table_info('vehicle') where name in ('source_make', 'source_model') order by name",
  );
  return {
    tables: tables.rows.map((row) => row.name),
    columns: columns.rows.map((row) => row.name),
  };
}

async function appliedMigrations(client: Client) {
  return (
    await client.execute(
      "select hash, created_at from __drizzle_migrations order by id",
    )
  ).rows.map((row) => [row.hash, Number(row.created_at)]);
}

const VIN_SCHEMA = {
  tables: ["search_index_schema", "vehicle_model_redirect", "vin_decode_cache"],
  columns: ["source_make", "source_model"],
};

test.each(["production", "preview"])(
  "0026 leaves a %s database with the VIN schema",
  async (database) => {
    const root = await mkdtemp(join(tmpdir(), "junkyard-migrations-"));
    const client = createClient({ url: `file:${join(root, "db.sqlite")}` });
    try {
      await migrateThroughMain(client, join(root, "main"));
      if (database === "preview") {
        for (const draft of PREVIEW_VIN_DRAFT_MIGRATIONS) {
          await client.executeMultiple(draft.sql);
          await client.execute({
            sql: "insert into __drizzle_migrations (hash, created_at) values (?, ?)",
            args: [draft.hash, draft.when],
          });
        }
      } else {
        expect(await vinSchema(client)).toEqual({ tables: [], columns: [] });
      }
      const before = await appliedMigrations(client);

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      expect(await vinSchema(client)).toEqual(VIN_SCHEMA);
      const after = await appliedMigrations(client);
      expect(after.slice(0, before.length)).toEqual(before);
      // Migrations after 0026 apply to both databases.
      expect(
        after
          .slice(before.length)
          .map(([, when]) => Number(when))
          .filter((when) => when <= 1795536000000),
      ).toEqual(database === "production" ? [1795536000000] : []);
      await client.execute(
        "insert into search_index_schema (index_name, version, updated_at) values ('vehicles', 12, 0)",
      );
    } finally {
      client.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
