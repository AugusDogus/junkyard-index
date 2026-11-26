import { createClient, type Client } from "@libsql/client";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun, vehicleSnapshot } from "~/schema";
import { InventoryAnnouncement } from "../inventory-announcement";
import { DURABLE_INGESTION_SOURCES } from "./durable-source";
import { UrgiisCursor } from "./urgiis-cursor";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { reportUrgiisCensusProgress } from "./urgiis-progress";
import { loadVanderHaagsPublishedCursor } from "./vanderhaags-history";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { makeVehicle, TEST_SCHEMA } from "./durable-ingestion-test-fixtures";
import {
  INGESTION_RUN_RETENTION_MS,
  pruneIngestionRuns,
} from "./ingestion-run-retention";

const now = new Date("2026-11-17T12:00:00Z");
const old = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
const clients: Client[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function setup() {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await client.executeMultiple(TEST_SCHEMA);
  await client.executeMultiple(`
    create table ingestion_projector_checkpoint (name text primary key, kind text not null default 'publication', last_processed_change_id integer not null default 0, job_cursor text, job_day text, blocked_until integer, failure_count integer not null default 0, last_error_tag text, last_success_at integer, updated_at integer not null);
    drop table search_notification_intent;
    create table search_notification_intent (id text primary key, run_id text not null references ingestion_run(id) on delete cascade, status text not null, claim_token text);
    drop table vehicle_change_v2;
    create table vehicle_change_v2 (id integer primary key, run_id text not null references ingestion_run(id) on delete cascade, processed_at integer);
    create table vehicle_change (id integer primary key, run_id text references ingestion_run(id) on delete cascade);
  `);
  const database = drizzle(client);
  return { client, database };
}
async function addRun(
  database: ReturnType<typeof drizzle>,
  id: string,
  overrides: Partial<typeof ingestionRun.$inferInsert> = {},
) {
  await database.insert(ingestionRun).values({
    id,
    source: "pyp",
    status: "success",
    stage: "released",
    startedAt: old,
    lastProgressAt: old,
    completedAt: old,
    releasedAt: old,
    ...overrides,
  });
}
async function ids(client: Client) {
  return (
    await client.execute("select id from ingestion_run order by id")
  ).rows.map((row) => row.id);
}

describe("ingestion run retention", () => {
  test("deletes only runs terminal for more than 90 days, idempotently", async () => {
    const { client, database } = await setup();
    await addRun(database, "old");
    await addRun(database, "boundary", {
      completedAt: new Date(now.getTime() - INGESTION_RUN_RETENTION_MS),
      releasedAt: null,
    });
    await addRun(database, "new", { completedAt: now, releasedAt: now });
    await addRun(database, "recent-release", { releasedAt: now });
    await pruneIngestionRuns({ database, now });
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual(["boundary", "new", "recent-release"]);
  });

  test("keeps the IndexNow checkpoint and compared commit anchor until the checkpoint advances", async () => {
    const { client, database } = await setup();
    await addRun(database, "obsolete", { publicationSequence: 0 });
    await addRun(database, "compared-commit", {
      publicationSequence: 1,
      commitStartedAt: new Date(old.getTime() + 2),
    });
    await addRun(database, "checkpoint", {
      publicationSequence: 2,
      commitStartedAt: new Date(old.getTime() + 1),
    });
    await addRun(database, "latest", {
      publicationSequence: 3,
      startedAt: now,
      commitStartedAt: now,
      completedAt: now,
    });
    await InventoryAnnouncement.record(database, 2);
    const before = await InventoryAnnouncement.window(database, 3, now);
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual([
      "checkpoint",
      "compared-commit",
      "latest",
    ]);
    expect(await InventoryAnnouncement.window(database, 3, now)).toEqual(
      before,
    );
    await InventoryAnnouncement.record(database, 3);
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual(["latest"]);
  });

  test("keeps latest accepted and published baselines and the publication sequence watermark", async () => {
    const { client, database } = await setup();
    for (const id of ["earlier", "published", "accepted", "watermark"])
      await addRun(database, id, {
        // Search publishes after inventory, so a search-published run has both.
        inventoryPublishedAt: id === "published" ? old : null,
        searchPublishedAt: id === "published" ? old : null,
        publicationSequence: id === "watermark" ? 100 : null,
      });
    for (const [id, start] of [
      ["earlier", 1],
      ["published", 2],
      ["accepted", 3],
    ] as const) {
      await database.insert(ingestionSourceRun).values({
        id,
        runId: id,
        source: "pyp",
        status: "success",
        acceptanceStatus: "accepted",
        startedAt: new Date(start),
        uniqueVehicles: 20000,
      });
    }
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual(["accepted", "published", "watermark"]);
    const store = IngestionSnapshotStore.memory();
    const chunk = await store.put({
      runId: "current",
      source: "pyp",
      chunk: {
        vehicles: Array.from({ length: 5000 }, (_, i) =>
          makeVehicle(`VIN-${i}`),
        ),
        observedVins: [],
      },
    });
    await addRun(database, "current", {
      status: "running",
      stage: "sources",
      activeSlot: 1,
      completedAt: null,
      releasedAt: null,
    });
    await database.insert(ingestionSourceRun).values({
      id: "current",
      runId: "current",
      source: "pyp",
      status: "success",
      nextCursor: JSON.stringify({ source: "pyp", storeIndex: 1, page: 1 }),
      snapshotChunks: JSON.stringify([chunk]),
      vehiclesProcessed: 5000,
      startedAt: now,
    });
    const result = await validateDurableSourceRuns({
      runId: "current",
      database,
      batchClient: client,
      snapshotStore: store,
    });
    expect(result).toMatchObject({
      status: "released",
      acceptedSources: [],
      rejectedSources: [
        {
          source: "pyp",
          errors: expect.arrayContaining([
            expect.stringContaining("50% drift limit"),
          ]),
        },
      ],
    });
  });

  test("preserves every registered source's active work and independent baselines", async () => {
    const { client, database } = await setup();
    const expected: string[] = [];
    for (const source of DURABLE_INGESTION_SOURCES) {
      for (const [kind, offset] of [
        ["obsolete", -1],
        ["published", 0],
        ["accepted", 1],
      ] as const) {
        const id = `${source}:${kind}`;
        await addRun(database, id, {
          source,
          inventoryPublishedAt: kind === "published" ? old : null,
          searchPublishedAt: kind === "published" ? old : null,
        });
        await database.insert(ingestionSourceRun).values({
          id,
          runId: id,
          source,
          status: "success",
          acceptanceStatus: "accepted",
          startedAt: new Date(old.getTime() + offset),
        });
        if (kind !== "obsolete") expected.push(id);
      }
      const id = `${source}:active`;
      await addRun(database, id, { source, status: "running", activeSlot: 1 });
      expected.push(id);
    }
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual(expected.sort());
  });

  test("keeps each source's latest inventory publication and recent recovery progress", async () => {
    const { client, database } = await setup();
    await addRun(database, "older-publication", {
      inventoryPublishedAt: new Date(1),
      publicationSequence: 1,
    });
    await addRun(database, "latest-inventory", {
      inventoryPublishedAt: new Date(2),
      publicationSequence: 2,
    });
    await addRun(database, "other-watermark", {
      source: "row52",
      publicationSequence: 3,
    });
    await addRun(database, "recent-progress", { lastProgressAt: now });
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual([
      "latest-inventory",
      "other-watermark",
      "recent-progress",
    ]);
  });

  test("keeps per-source inventory publications from legacy multi-source runs", async () => {
    const { client, database } = await setup();
    for (const [id, source, publication, start] of [
      ["obsolete", "pyp", 0, 0],
      ["pyp-publication", "pyp", 1, 1],
      ["row52-publication", "row52", 2, 2],
      ["pyp-accepted", "pyp", null, 3],
    ] as const) {
      await addRun(database, id, {
        source: "all",
        inventoryPublishedAt:
          publication === null ? null : new Date(publication),
      });
      await database.insert(ingestionSourceRun).values({
        id,
        runId: id,
        source,
        status: "success",
        acceptanceStatus: "accepted",
        startedAt: new Date(start),
      });
    }
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual([
      "pyp-accepted",
      "pyp-publication",
      "row52-publication",
    ]);
  });

  test("keeps the successful published cursor when a newer accepted child failed", async () => {
    const { client, database } = await setup();
    for (const [id, publication, start, status] of [
      ["obsolete", 1, 1, "success"],
      ["cursor-baseline", 2, 2, "success"],
      ["failed-child", 3, 3, "error"],
      ["unpublished", null, 4, "success"],
    ] as const) {
      await addRun(database, id, {
        source: "vanderhaags",
        inventoryPublishedAt:
          publication === null ? null : new Date(publication),
      });
      await database.insert(ingestionSourceRun).values({
        id,
        runId: id,
        source: "vanderhaags",
        status,
        acceptanceStatus: "accepted",
        startedAt: new Date(start),
        nextCursor: JSON.stringify({ phase: "complete", marker: id }),
      });
    }
    const before = await loadVanderHaagsPublishedCursor(database);
    expect(before).toMatchObject({ marker: "cursor-baseline" });
    await pruneIngestionRuns({ database, now });
    expect(await loadVanderHaagsPublishedCursor(database)).toEqual(before);
    expect(await ids(client)).not.toContain("obsolete");
  });

  test("keeps active, nonterminal, recovery, snapshot and delivery references", async () => {
    const { client, database } = await setup();
    await addRun(database, "active", { activeSlot: 1 });
    await addRun(database, "running", { status: "running" });
    await addRun(database, "unknown", { status: "unknown" });
    await addRun(database, "unfinished", {
      completedAt: null,
      releasedAt: null,
    });
    await addRun(database, "move", { stage: "full_reindex_move_pending" });
    await addRun(database, "rebuild", { fullReindexRequired: true });
    for (const id of [
      "snapshot",
      "cursor",
      "child-running",
      "pending",
      "claimed",
    ])
      await addRun(database, id);
    for (const id of ["snapshot", "cursor", "child-running"])
      await database.insert(ingestionSourceRun).values({
        id,
        runId: id,
        source: "pyp",
        status:
          id === "child-running" || id === "cursor" ? "running" : "success",
        startedAt: old,
        snapshotChunks:
          id === "snapshot" ? '["ingestion-runs/old/chunk"]' : "[]",
        nextCursor:
          id === "cursor" ? '{"statePath":"ingestion-runs/old/state"}' : null,
      });
    await client.executeMultiple(
      "insert into search_notification_intent (id, run_id, status) values ('p', 'pending', 'pending'); insert into search_notification_intent (id, run_id, status, claim_token) values ('c', 'claimed', 'cancelled', 'live-claim');",
    );
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toHaveLength(11);
  });

  test("preserves URG retry evidence since its last publication", async () => {
    const { client, database } = await setup();
    for (const [id, start] of [
      ["before", 1],
      ["baseline", 2],
      ["retry", 3],
    ] as const) {
      await addRun(database, id, {
        source: "urgiis",
        inventoryPublishedAt: id === "baseline" ? new Date(2) : null,
      });
      await database.insert(ingestionSourceRun).values({
        id,
        runId: id,
        source: "urgiis",
        status: "success",
        acceptanceStatus: id === "baseline" ? "accepted" : "rejected",
        startedAt: new Date(start),
      });
    }
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual(["baseline", "retry"]);
    await client.execute(
      "update ingestion_run set inventory_published_at = null",
    );
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual(["baseline", "retry"]);
  });

  test("pruning cannot turn repeated URG cold-census progress into a heartbeat", async () => {
    const { database } = await setup();
    const tenant = URGIIS_TENANTS[0];
    if (!tenant) throw new Error("Missing qualified URG tenant");
    const before = UrgiisCursor.checkpoint({
      ...UrgiisCursor.initial(),
      startedAt: old.getTime(),
      asOf: old.getTime(),
      runKind: "cold",
    });
    const after = UrgiisCursor.nextTenant(
      before,
      { code: tenant.code, accepted: tenant.minimumInventory },
      URGIIS_TENANTS,
      "state",
    );
    await addRun(database, "failed-cold", {
      source: "urgiis",
      status: "error",
    });
    await database.insert(ingestionSourceRun).values({
      id: "failed-cold",
      runId: "failed-cold",
      source: "urgiis",
      status: "error",
      startedAt: old,
      nextCursor: UrgiisCursor.serialize(after),
    });
    await pruneIngestionRuns({ database, now });
    let pings = 0;
    await reportUrgiisCensusProgress({
      database,
      runId: "current",
      before,
      result: {
        cursor: after,
        status: "paused",
        count: tenant.minimumInventory,
        errors: [],
        pagesProcessed: 0,
      },
      ping: async () => {
        pings++;
      },
    });
    expect(pings).toBe(0);
  });

  test("cascades child rows without orphans", async () => {
    const { client, database } = await setup();
    await addRun(database, "old");
    await database.insert(ingestionSourceRun).values({
      id: "child",
      runId: "old",
      source: "pyp",
      status: "success",
      startedAt: old,
    });
    await database
      .insert(vehicleSnapshot)
      .values({ ...makeVehicle(), runId: "old" });
    await client.executeMultiple(
      "insert into vehicle_observation values ('old', 'pyp', 'VIN'); insert into vehicle_change values (1, 'old'); insert into vehicle_change_v2 values (1, 'old', 1); insert into search_notification_intent values ('delivered', 'old', 'delivered', null);",
    );
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual([]);
    for (const table of [
      "ingestion_source_run",
      "vehicle_observation",
      "vehicle_snapshot",
      "vehicle_change",
      "vehicle_change_v2",
      "search_notification_intent",
    ])
      expect(
        (await client.execute(`select count(*) as n from ${table}`)).rows[0]?.n,
      ).toBe(0);
    expect((await client.execute("pragma foreign_key_check")).rows).toEqual([]);
  });

  test("drains multiple bounded batches and overlapping passes safely", async () => {
    const { client, database } = await setup();
    for (let i = 0; i < 215; i++) await addRun(database, `old-${i}`);
    const run = database.run.bind(database);
    const recording = spyOn(database, "run").mockImplementation((...args) =>
      run(...args),
    );
    try {
      await Promise.all([
        pruneIngestionRuns({ database, now }),
        pruneIngestionRuns({ database, now }),
      ]);
      expect(await ids(client)).toEqual([]);
      expect(recording.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      recording.mockRestore();
    }
  });

  test("bounds total work and retries remaining history on the next pass", async () => {
    const { client, database } = await setup();
    for (let i = 0; i < 1005; i++) await addRun(database, `old-${i}`);
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toHaveLength(5);
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual([]);
  });

  test("uses the retention index to select old terminal runs", async () => {
    const { database } = await setup();
    const statements: SQL[] = [];
    const run = database.run.bind(database);
    const recording = spyOn(database, "run").mockImplementation((statement) => {
      statements.push(
        typeof statement === "string" ? sql.raw(statement) : statement.getSQL(),
      );
      return run(statement);
    });
    try {
      await pruneIngestionRuns({ database, now });
    } finally {
      recording.mockRestore();
    }
    const statement = statements[0];
    if (!statement) throw new Error("Expected retention SQL");
    const plan = await database.all<{ detail: string }>(
      sql`explain query plan ${statement}`,
    );
    expect(
      plan.some((row) =>
        row.detail.includes(
          "SEARCH r USING INDEX ingestion_run_retention_idx (completed_at<?)",
        ),
      ),
    ).toBe(true);
  });

  test("reports a failed batch as a value, logs it, then retries", async () => {
    const { client, database } = await setup();
    await addRun(database, "old");
    const error = new Error("retention database unavailable");
    const failing = spyOn(database, "run").mockRejectedValueOnce(error);
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await pruneIngestionRuns({ database, now })).toEqual({
        status: "failed",
        deleted: 0,
        batch: 1,
        message: "retention database unavailable",
      });
      expect(log).toHaveBeenCalledWith(
        "Ingestion run pruning failed; retrying next pass",
        {
          operation: "prune_ingestion_runs",
          cutoff: new Date(
            now.getTime() - INGESTION_RUN_RETENTION_MS,
          ).toISOString(),
          batch: 1,
          batchSize: 100,
          error,
        },
      );
      expect(await ids(client)).toEqual(["old"]);
    } finally {
      failing.mockRestore();
      log.mockRestore();
    }
    expect(await pruneIngestionRuns({ database, now })).toEqual({
      status: "done",
      deleted: 1,
      complete: true,
    });
    expect(await ids(client)).toEqual([]);
  });

  test("prunes pre-v2 runs that ended as success in the sources stage", async () => {
    const { client, database } = await setup();
    await addRun(database, "legacy", {
      stage: "sources",
      releasedAt: null,
      publicationSequence: null,
    });
    await addRun(database, "unreleased-v2", {
      stage: "project_changes",
      releasedAt: null,
    });
    expect(await pruneIngestionRuns({ database, now })).toEqual({
      status: "done",
      deleted: 1,
      complete: true,
    });
    expect(await ids(client)).toEqual(["unreleased-v2"]);
  });

  test("keeps legacy runs that still own rows of the vehicle_change archive", async () => {
    const { client, database } = await setup();
    await addRun(database, "archived", {
      stage: "sources",
      releasedAt: null,
      publicationSequence: null,
    });
    await client.execute(
      "insert into vehicle_change (id, run_id) values (1, 'archived')",
    );
    await pruneIngestionRuns({ database, now });
    expect(await ids(client)).toEqual(["archived"]);
    expect(
      (await client.execute("select count(*) as n from vehicle_change")).rows[0]
        ?.n,
    ).toBe(1);
  });
});
