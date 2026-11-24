import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import type { ConsumerMode } from "./consumer-flags";
import { makeVehicle, TEST_SCHEMA } from "./durable-ingestion-test-fixtures";
import {
  runIngestionMaintenance,
  summarizeIngestionMaintenance,
} from "./ingestion-maintenance";
import {
  IngestionMaintenanceTasks,
  TERMINAL_INTENT_RETENTION_MS,
} from "./ingestion-maintenance-tasks";
import { INGESTION_RUN_RETENTION_MS } from "./ingestion-run-retention";
import {
  IngestionSnapshotStore,
  SnapshotDeleteDeadlineError,
  type SnapshotDeletePolicy,
} from "./ingestion-snapshot-store";

const GENERATION_SCHEMA = readFileSync(
  new URL("../../../drizzle/0025_search_projector.sql", import.meta.url),
  "utf8",
).replaceAll("--> statement-breakpoint", "");

const now = new Date("2026-11-20T08:30:00Z");
const longAgo = new Date(now.getTime() - INGESTION_RUN_RETENTION_MS - 1);
const clients: Client[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function setup() {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await client.executeMultiple(TEST_SCHEMA);
  await client.executeMultiple(`
    create table ingestion_projector_checkpoint (name text primary key, last_processed_change_id integer not null default 0, updated_at integer not null);
    create table vehicle_change (id integer primary key, run_id text references ingestion_run(id) on delete cascade);
    alter table vehicle_change_v2 add column created_at integer not null default 0;
    ${GENERATION_SCHEMA}
  `);
  const database = drizzle(client);
  const store = IngestionSnapshotStore.memory();
  // A run pruned for age, and a recent released run whose snapshot chunk is
  // stale (its cleanup never ran because its workflow stopped).
  await database.insert(ingestionRun).values([
    {
      id: "old",
      source: "pyp",
      status: "error",
      stage: "sources",
      startedAt: longAgo,
      lastProgressAt: longAgo,
      completedAt: longAgo,
    },
    {
      id: "stale",
      source: "pyp",
      status: "success",
      stage: "released",
      publicationSequence: 9,
      startedAt: now,
      lastProgressAt: now,
      completedAt: now,
      releasedAt: now,
    },
  ]);
  const chunk = await store.put({
    runId: "stale",
    source: "pyp",
    chunk: { vehicles: [makeVehicle("VIN-STALE")], observedVins: [] },
  });
  await database.insert(ingestionSourceRun).values({
    id: "stale:pyp",
    runId: "stale",
    source: "pyp",
    status: "success",
    snapshotChunks: JSON.stringify([chunk]),
    startedAt: now,
  });
  const expired = now.getTime() - TERMINAL_INTENT_RETENTION_MS - 1;
  await client.execute({
    sql: `insert into search_notification_intent (id, run_id, status, created_at) values
      ('old-delivered', 'stale', 'delivered', ?),
      ('old-cancelled', 'stale', 'cancelled', ?),
      ('old-pending', 'stale', 'pending', ?),
      ('recent-delivered', 'stale', 'delivered', ?)`,
    args: [expired, expired, expired, now.getTime()],
  });
  return { client, database, store };
}

function operations(
  database: LibSQLDatabase,
  store: IngestionSnapshotStore,
  mode: ConsumerMode = "enabled",
) {
  return {
    mode: async () => mode,
    outboxRetention: () =>
      IngestionMaintenanceTasks.outboxRetention(database, now),
    pruneRuns: () => IngestionMaintenanceTasks.pruneRuns(database, now),
    staleSnapshots: () =>
      IngestionMaintenanceTasks.staleSnapshots(database, store),
    terminalIntents: () =>
      IngestionMaintenanceTasks.terminalIntents(database, now),
  };
}

async function state(client: Client, store: { pathnames(): string[] }) {
  const runs = await client.execute("select id from ingestion_run order by id");
  const intents = await client.execute(
    "select id from search_notification_intent order by id",
  );
  return {
    runs: runs.rows.map((row) => row.id),
    intents: intents.rows.map((row) => row.id),
    chunks: store.pathnames().length,
  };
}

describe("ingestion-maintenance consumer", () => {
  test("prunes runs, deletes stale Blob chunks and purges old terminal intents, reporting each as a value", async () => {
    const { client, database, store } = await setup();
    const result = await runIngestionMaintenance(operations(database, store));
    expect(result).toEqual({
      status: "completed",
      failed: false,
      tasks: [
        {
          task: "outbox-retention",
          status: "done",
          deleted: 0,
          complete: true,
        },
        { task: "prune-runs", status: "done", deleted: 1, complete: true },
        { task: "stale-snapshots", status: "done", deleted: 1, complete: true },
        {
          task: "terminal-intents",
          status: "done",
          deleted: 2,
          complete: true,
        },
      ],
    });
    expect(await state(client, store)).toEqual({
      runs: ["stale"],
      intents: ["old-pending", "recent-delivered"],
      chunks: 0,
    });
    expect(summarizeIngestionMaintenance(result)).toMatchObject({
      status: "completed",
      failed: false,
      "prune-runs.deleted": 1,
      "terminal-intents.complete": true,
    });

    // Idempotent: a second run finds nothing left.
    expect(await runIngestionMaintenance(operations(database, store))).toEqual({
      status: "completed",
      failed: false,
      tasks: [
        {
          task: "outbox-retention",
          status: "done",
          deleted: 0,
          complete: true,
        },
        { task: "prune-runs", status: "done", deleted: 0, complete: true },
        { task: "stale-snapshots", status: "done", deleted: 0, complete: true },
        {
          task: "terminal-intents",
          status: "done",
          deleted: 0,
          complete: true,
        },
      ],
    });
  });

  test("a paused consumer deletes nothing", async () => {
    const { client, database, store } = await setup();
    const before = await state(client, store);
    expect(
      await runIngestionMaintenance(operations(database, store, "paused")),
    ).toEqual({ status: "paused" });
    expect(await state(client, store)).toEqual(before);
    expect(before.chunks).toBe(1);
  });

  test("a failed task is reported and the other tasks still run", async () => {
    const { client, database, store } = await setup();
    const log = spyOn(console, "error").mockImplementation(() => {});
    const failing = spyOn(database, "run").mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    try {
      const result = await runIngestionMaintenance({
        ...operations(database, store),
        // Outbox retention runs first; skip it so pruning meets the failure.
        outboxRetention: async () => ({
          task: "outbox-retention",
          status: "done",
          deleted: 0,
          complete: true,
        }),
      });
      expect(result).toEqual({
        status: "completed",
        failed: true,
        tasks: [
          {
            task: "outbox-retention",
            status: "done",
            deleted: 0,
            complete: true,
          },
          {
            task: "prune-runs",
            status: "failed",
            deleted: 0,
            message: "batch 1: database unavailable",
          },
          {
            task: "stale-snapshots",
            status: "done",
            deleted: 1,
            complete: true,
          },
          {
            task: "terminal-intents",
            status: "done",
            deleted: 2,
            complete: true,
          },
        ],
      });
      expect((await state(client, store)).runs).toEqual(["old", "stale"]);
    } finally {
      failing.mockRestore();
      log.mockRestore();
    }
  });

  test("an unexpected throw becomes a failed task value", async () => {
    const { database, store } = await setup();
    const result = await runIngestionMaintenance({
      ...operations(database, store),
      staleSnapshots: async () => {
        throw new Error("step exhausted its retries");
      },
    });
    expect(result).toMatchObject({
      status: "completed",
      failed: true,
      tasks: [
        { task: "outbox-retention", status: "done" },
        { task: "prune-runs", status: "done" },
        {
          task: "stale-snapshots",
          status: "failed",
          deleted: 0,
          message: "step exhausted its retries",
        },
        { task: "terminal-intents", status: "done" },
      ],
    });
  });

  /** A released run whose 600 staged chunks were never cleaned up. */
  async function largeStaleRun(
    database: LibSQLDatabase,
    store: IngestionSnapshotStore,
  ) {
    const chunks: string[] = [];
    for (let index = 0; index < 600; index += 1)
      chunks.push(
        await store.put({
          runId: "stale",
          source: "urgiis",
          chunk: { vehicles: [], observedVins: [`VIN${index}`] },
        }),
      );
    await database.insert(ingestionSourceRun).values({
      id: "stale:urgiis",
      runId: "stale",
      source: "urgiis",
      status: "success",
      snapshotChunks: JSON.stringify(chunks),
      startedAt: now,
    });
    return chunks;
  }

  async function registered(client: Client, id: string) {
    const result = await client.execute({
      sql: "select snapshot_chunks from ingestion_source_run where id = ?",
      args: [id],
    });
    return JSON.parse(String(result.rows[0]?.snapshot_chunks)) as string[];
  }

  test("stale snapshot cleanup keeps what it deleted before a Blob failure, and the next tick resumes", async () => {
    const { client, database, store } = await setup();
    const chunks = await largeStaleRun(database, store);
    let deletes = 0;
    const limited: IngestionSnapshotStore = {
      ...store,
      async delete(pathnames, policy) {
        deletes += 1;
        // The small pyp run goes first, then one slice of the URG run.
        if (deletes > 2)
          throw new Error(
            "Vercel Blob: Too many requests please lower the number of concurrent requests - try again in 60 seconds.",
          );
        await store.delete(pathnames, policy);
      },
    };

    const failed = await IngestionMaintenanceTasks.staleSnapshots(
      database,
      limited,
    );

    expect(failed).toMatchObject({
      task: "stale-snapshots",
      status: "failed",
      deleted: 251,
    });
    expect(await registered(client, "stale:urgiis")).toEqual(chunks.slice(250));

    expect(
      await IngestionMaintenanceTasks.staleSnapshots(database, store),
    ).toEqual({
      task: "stale-snapshots",
      status: "done",
      deleted: 350,
      complete: true,
    });
    expect(store.pathnames()).toEqual([]);
  });

  test("stale snapshot cleanup stops at its time budget and the next tick resumes", async () => {
    const { client, database, store } = await setup();
    const chunks = await largeStaleRun(database, store);
    let clock = 0;
    const policies: SnapshotDeletePolicy[] = [];
    const slow: IngestionSnapshotStore = {
      ...store,
      async delete(pathnames, policy) {
        policies.push(policy);
        clock += 2 * 60_000;
        await store.delete(pathnames, policy);
      },
    };

    expect(
      await IngestionMaintenanceTasks.staleSnapshots(
        database,
        slow,
        () => clock,
      ),
    ).toEqual({
      task: "stale-snapshots",
      status: "done",
      deleted: 251,
      complete: false,
    });
    expect(await registered(client, "stale:urgiis")).toEqual(chunks.slice(250));
    // The step may start 5 min into an 800 s invocation, after the earlier
    // tasks, so cleanup gets 3 min, and no Blob wait runs past them.
    expect(policies).toEqual([
      { kind: "paced", deadline: 3 * 60_000 },
      { kind: "paced", deadline: 3 * 60_000 },
    ]);

    expect(
      await IngestionMaintenanceTasks.staleSnapshots(database, store),
    ).toEqual({
      task: "stale-snapshots",
      status: "done",
      deleted: 350,
      complete: true,
    });
  });

  test("stale snapshot cleanup that reaches its deadline inside a delete stops without failing", async () => {
    const { client, database, store } = await setup();
    const chunks = await largeStaleRun(database, store);
    let deletes = 0;
    const deadlined: IngestionSnapshotStore = {
      ...store,
      async delete(pathnames, policy) {
        deletes += 1;
        if (deletes > 2) throw new SnapshotDeleteDeadlineError(0, 250);
        await store.delete(pathnames, policy);
      },
    };

    expect(
      await IngestionMaintenanceTasks.staleSnapshots(database, deadlined),
    ).toEqual({
      task: "stale-snapshots",
      status: "done",
      deleted: 251,
      complete: false,
    });
    expect(await registered(client, "stale:urgiis")).toEqual(chunks.slice(250));
    // It stops there: no further batch retries the stopped delete.
    expect(deletes).toBe(3);
  });

  test("outbox retention deletes only projected changes the live generation covers or that aged out", async () => {
    const { client, database } = await setup();
    const day = 24 * 60 * 60 * 1000;
    const insert = (vin: string, createdAt: number) =>
      client.execute({
        sql: "insert into vehicle_change_v2 (run_id, vin, change_type, created_at) values ('stale', ?, 'upsert', ?) returning id",
        args: [vin, createdAt],
      });
    // Ids grow with created_at. 1-2: aged out; 3: recent but covered by
    // the live snapshot; 4: recent; 5: not projected yet.
    await insert("OLD1", now.getTime() - 20 * day);
    await insert("OLD2", now.getTime() - 15 * day);
    await insert("SNAP", now.getTime() - 2 * day);
    await insert("RECENT", now.getTime() - day);
    await insert("PENDING", now.getTime());
    await client.execute(
      "insert into ingestion_projector_checkpoint (name, last_processed_change_id, updated_at) values ('search-projector', 4, 0)",
    );
    const remaining = async () =>
      (
        await client.execute("select vin from vehicle_change_v2 order by id")
      ).rows.map((row) => row.vin);

    // Before the projector has a live generation nothing is deleted: the
    // changes still owe a rebuild.
    expect(
      await IngestionMaintenanceTasks.outboxRetention(database, now),
    ).toEqual({
      task: "outbox-retention",
      status: "done",
      deleted: 0,
      complete: true,
    });
    expect(await remaining()).toHaveLength(5);

    await client.execute(
      "insert into search_index_generation (id, environment, index_name, status, reason, snapshot_change_id, requested_at, live_at, updated_at) values ('live-1', 'production', 'vehicles', 'live', 'bootstrap', 3, 0, 0, 0)",
    );
    expect(
      await IngestionMaintenanceTasks.outboxRetention(database, now),
    ).toEqual({
      task: "outbox-retention",
      status: "done",
      deleted: 3,
      complete: true,
    });
    expect(await remaining()).toEqual(["RECENT", "PENDING"]);
  });
});
