import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import {
  INDEX_GENERATION_KEY,
  publishFullReindexForRun,
} from "./durable-algolia-publish";

const TEST_SCHEMA = `
  create table ingestion_run (
    id text primary key,
    source text not null,
    status text not null,
    stage text not null,
    active_slot integer,
    full_reindex_required integer not null default 0,
    full_reindex_move_task_id integer,
    started_at integer not null,
    last_progress_at integer not null,
    search_published_at integer
  );

  create table vehicle_change (
    id integer primary key autoincrement,
    processed_at integer
  );
`;

async function insertRun(
  client: ReturnType<typeof createClient>,
  params: {
    id: string;
    status: "running" | "abandoned";
    stage: string;
    activeSlot: 1 | null;
    fullReindexRequired: boolean;
    startedAt: number;
  },
) {
  await client.execute({
    sql: `
      insert into ingestion_run (
        id, source, status, stage, active_slot, full_reindex_required,
        started_at, last_progress_at
      ) values (?, 'all', ?, ?, ?, ?, ?, ?)
    `,
    args: [
      params.id,
      params.status,
      params.stage,
      params.activeSlot,
      Number(params.fullReindexRequired),
      params.startedAt,
      params.startedAt,
    ],
  });
}

describe("durable Algolia full-index publication", () => {
  test("makes a definitively rejected move recoverable without unfencing ambiguous failures", async () => {
    const runCase = async (error: Error) => {
      const client = createClient({ url: ":memory:" });
      await client.executeMultiple(TEST_SCHEMA);
      const startedAt = Date.parse("2026-08-22T07:00:00.000Z");
      await insertRun(client, {
        id: "run-1",
        status: "running",
        stage: "full_reindex_publish",
        activeSlot: 1,
        fullReindexRequired: true,
        startedAt,
      });
      try {
        await publishFullReindexForRun({
          runId: "run-1",
          runStartedAt: new Date(startedAt),
          database: drizzle(client),
          indexName: "vehicles",
          algolia: {
            getSettings: async () => ({}),
            operationIndex: async () => {
              throw error;
            },
            waitForTask: async () => undefined,
          },
        });
      } catch (caught) {
        expect(caught).toBe(error);
      }
      const row = await client.execute(
        "select stage, full_reindex_move_task_id from ingestion_run where id = 'run-1'",
      );
      client.close();
      return row.rows[0];
    };

    const rejected = new Error("forbidden");
    Object.defineProperty(rejected, "status", { value: 403 });
    expect((await runCase(rejected))?.stage).toBe(
      "full_reindex_publish_failed",
    );
    expect((await runCase(new Error("connection reset")))?.stage).toBe(
      "full_reindex_move_pending",
    );
  });

  test("enters the critical stage and persists the move task before waiting", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const startedAt = Date.parse("2026-08-22T07:00:00.000Z");
      await insertRun(client, {
        id: "run-1",
        status: "running",
        stage: "full_reindex_publish",
        activeSlot: 1,
        fullReindexRequired: true,
        startedAt,
      });
      let settingsCalls = 0;
      const result = await publishFullReindexForRun({
        runId: "run-1",
        runStartedAt: new Date(startedAt),
        database: drizzle(client),
        indexName: "vehicles",
        algolia: {
          getSettings: async () => ({
            userData:
              settingsCalls++ === 0
                ? undefined
                : { [INDEX_GENERATION_KEY]: "run-1" },
          }),
          operationIndex: async () => {
            const row = await client.execute(
              "select stage from ingestion_run where id = 'run-1'",
            );
            expect(row.rows[0]?.stage).toBe("full_reindex_move_pending");
            return { taskID: 42 };
          },
          waitForTask: async ({ taskID }) => {
            expect(taskID).toBe(42);
            const row = await client.execute(
              "select full_reindex_move_task_id from ingestion_run where id = 'run-1'",
            );
            expect(row.rows[0]?.full_reindex_move_task_id).toBe(42);
          },
        },
      });

      expect(result.status).toBe("complete");
      const row = await client.execute(
        "select stage, full_reindex_move_task_id from ingestion_run where id = 'run-1'",
      );
      expect(row.rows[0]?.stage).toBe("match_alerts");
      expect(row.rows[0]?.full_reindex_move_task_id).toBeNull();
    } finally {
      client.close();
    }
  });

  test("reconciles a persisted in-flight move without submitting another", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const startedAt = Date.parse("2026-08-22T07:00:00.000Z");
      await insertRun(client, {
        id: "run-1",
        status: "running",
        stage: "full_reindex_move_pending",
        activeSlot: 1,
        fullReindexRequired: true,
        startedAt,
      });
      await client.execute(
        "update ingestion_run set full_reindex_move_task_id = 99 where id = 'run-1'",
      );
      let published = false;
      let moveCalls = 0;
      const result = await publishFullReindexForRun({
        runId: "run-1",
        runStartedAt: new Date(startedAt),
        database: drizzle(client),
        indexName: "vehicles",
        algolia: {
          getSettings: async () => ({
            userData: published
              ? { [INDEX_GENERATION_KEY]: "run-1" }
              : undefined,
          }),
          operationIndex: async () => {
            moveCalls += 1;
            return { taskID: 100 };
          },
          waitForTask: async ({ taskID }) => {
            expect(taskID).toBe(99);
            published = true;
          },
        },
      });

      expect(result.status).toBe("complete");
      expect(moveCalls).toBe(0);
    } finally {
      client.close();
    }
  });

  test("reconciles an already-moved generation without moving it again", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const startedAt = Date.parse("2026-08-22T07:00:00.000Z");
      await insertRun(client, {
        id: "older-repair",
        status: "abandoned",
        stage: "reconcile_missing",
        activeSlot: null,
        fullReindexRequired: true,
        startedAt: startedAt - 1,
      });
      await insertRun(client, {
        id: "run-1",
        status: "running",
        stage: "full_reindex_publish",
        activeSlot: 1,
        fullReindexRequired: true,
        startedAt,
      });
      await insertRun(client, {
        id: "newer-repair",
        status: "abandoned",
        stage: "reconcile_missing",
        activeSlot: null,
        fullReindexRequired: true,
        startedAt: startedAt + 1,
      });
      let moveCalls = 0;
      const result = await publishFullReindexForRun({
        runId: "run-1",
        runStartedAt: new Date(startedAt),
        database: drizzle(client),
        indexName: "vehicles",
        algolia: {
          getSettings: async () => ({
            userData: { [INDEX_GENERATION_KEY]: "run-1" },
          }),
          operationIndex: async () => {
            moveCalls += 1;
            return { taskID: 1 };
          },
          waitForTask: async () => undefined,
        },
      });

      expect(result.status).toBe("complete");
      expect(moveCalls).toBe(0);
      const rows = await client.execute(
        "select id, stage, full_reindex_required from ingestion_run order by id",
      );
      expect(JSON.stringify(rows.rows)).toBe(
        JSON.stringify([
          {
            id: "newer-repair",
            stage: "reconcile_missing",
            full_reindex_required: 1,
          },
          {
            id: "older-repair",
            stage: "reconcile_missing",
            full_reindex_required: 0,
          },
          {
            id: "run-1",
            stage: "match_alerts",
            full_reindex_required: 0,
          },
        ]),
      );
    } finally {
      client.close();
    }
  });

  test("marks every change covered by the published generation as processed", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const startedAt = Date.parse("2026-08-22T07:00:00.000Z");
      await insertRun(client, {
        id: "run-1",
        status: "running",
        stage: "full_reindex_publish",
        activeSlot: 1,
        fullReindexRequired: true,
        startedAt,
      });
      await client.executeMultiple(`
        insert into vehicle_change (processed_at) values (null), (null), (1234);
      `);

      const result = await publishFullReindexForRun({
        runId: "run-1",
        runStartedAt: new Date(startedAt),
        database: drizzle(client),
        indexName: "vehicles",
        algolia: {
          getSettings: async () => ({
            userData: { [INDEX_GENERATION_KEY]: "run-1" },
          }),
          operationIndex: async () => ({ taskID: 1 }),
          waitForTask: async () => undefined,
        },
      });

      expect(result.status).toBe("complete");
      const pending = await client.execute(
        "select count(*) as count from vehicle_change where processed_at is null",
      );
      expect(pending.rows[0]?.count).toBe(0);
      const previouslyProcessed = await client.execute(
        "select processed_at from vehicle_change where id = 3",
      );
      expect(previouslyProcessed.rows[0]?.processed_at).toBe(1234);
    } finally {
      client.close();
    }
  });

  test("rolls back the publish checkpoint when change cleanup fails", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const startedAt = Date.parse("2026-08-22T07:00:00.000Z");
      await insertRun(client, {
        id: "run-1",
        status: "running",
        stage: "full_reindex_publish",
        activeSlot: 1,
        fullReindexRequired: true,
        startedAt,
      });
      await client.executeMultiple(`
        insert into vehicle_change (processed_at) values (null);
        create trigger reject_change_cleanup
        before update of processed_at on vehicle_change
        begin
          select raise(abort, 'injected change cleanup failure');
        end;
      `);
      const publish = () =>
        publishFullReindexForRun({
          runId: "run-1",
          runStartedAt: new Date(startedAt),
          database: drizzle(client),
          indexName: "vehicles",
          algolia: {
            getSettings: async () => ({
              userData: { [INDEX_GENERATION_KEY]: "run-1" },
            }),
            operationIndex: async () => ({ taskID: 1 }),
            waitForTask: async () => undefined,
          },
        });

      await expect(publish()).rejects.toThrow("change cleanup failure");
      const run = await client.execute(
        "select stage, full_reindex_required from ingestion_run where id = 'run-1'",
      );
      expect(run.rows[0]?.stage).toBe("full_reindex_publish");
      expect(run.rows[0]?.full_reindex_required).toBe(1);
    } finally {
      client.close();
    }
  });

  test("does not checkpoint or clear repair obligations for an abandoned run", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const startedAt = Date.parse("2026-08-22T07:00:00.000Z");
      await insertRun(client, {
        id: "run-abandoned",
        status: "abandoned",
        stage: "full_reindex_publish",
        activeSlot: null,
        fullReindexRequired: true,
        startedAt,
      });
      const result = await publishFullReindexForRun({
        runId: "run-abandoned",
        runStartedAt: new Date(startedAt),
        database: drizzle(client),
        indexName: "vehicles",
        algolia: {
          getSettings: async () => ({
            userData: { [INDEX_GENERATION_KEY]: "run-abandoned" },
          }),
          operationIndex: async () => ({ taskID: 1 }),
          waitForTask: async () => undefined,
        },
      });

      expect(result).toEqual({ status: "stopped" });
      const row = await client.execute(
        "select status, stage, full_reindex_required from ingestion_run",
      );
      expect(JSON.stringify(row.rows[0])).toBe(
        JSON.stringify({
          status: "abandoned",
          stage: "full_reindex_publish",
          full_reindex_required: 1,
        }),
      );
    } finally {
      client.close();
    }
  });

  test("atomically preserves the publish checkpoint when repair cleanup fails", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const startedAt = Date.parse("2026-08-22T07:00:00.000Z");
      await insertRun(client, {
        id: "older-repair",
        status: "abandoned",
        stage: "reconcile_missing",
        activeSlot: null,
        fullReindexRequired: true,
        startedAt: startedAt - 1,
      });
      await insertRun(client, {
        id: "run-1",
        status: "running",
        stage: "full_reindex_publish",
        activeSlot: 1,
        fullReindexRequired: true,
        startedAt,
      });
      await client.executeMultiple(`
        create trigger reject_repair_cleanup
        before update of full_reindex_required on ingestion_run
        when old.id = 'older-repair' and new.full_reindex_required = 0
        begin
          select raise(abort, 'injected repair cleanup failure');
        end;
      `);
      const publish = () =>
        publishFullReindexForRun({
          runId: "run-1",
          runStartedAt: new Date(startedAt),
          database: drizzle(client),
          indexName: "vehicles",
          algolia: {
            getSettings: async () => ({
              userData: { [INDEX_GENERATION_KEY]: "run-1" },
            }),
            operationIndex: async () => ({ taskID: 1 }),
            waitForTask: async () => undefined,
          },
        });

      await expect(publish()).rejects.toThrow("repair cleanup failure");
      let rows = await client.execute(
        "select id, stage, full_reindex_required from ingestion_run order by id",
      );
      expect(JSON.stringify(rows.rows)).toBe(
        JSON.stringify([
          {
            id: "older-repair",
            stage: "reconcile_missing",
            full_reindex_required: 1,
          },
          {
            id: "run-1",
            stage: "full_reindex_publish",
            full_reindex_required: 1,
          },
        ]),
      );

      await client.execute("drop trigger reject_repair_cleanup");
      expect((await publish()).status).toBe("complete");
      rows = await client.execute(
        "select id, stage, full_reindex_required from ingestion_run order by id",
      );
      expect(JSON.stringify(rows.rows)).toBe(
        JSON.stringify([
          {
            id: "older-repair",
            stage: "reconcile_missing",
            full_reindex_required: 0,
          },
          {
            id: "run-1",
            stage: "match_alerts",
            full_reindex_required: 0,
          },
        ]),
      );
    } finally {
      client.close();
    }
  });
});
