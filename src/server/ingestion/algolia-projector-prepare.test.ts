import { expect, test } from "bun:test";

// Module mocks leak across the suite, so this runs in its own process.
const SCRIPT = `
  import { mock } from "bun:test";
  import { createClient } from "@libsql/client";
  import { drizzle } from "drizzle-orm/libsql";
  import { TEST_SCHEMA } from "./src/server/ingestion/durable-ingestion-test-fixtures.ts";

  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_SCHEMA);
  // The record-cap guard counts vehicles before it copies.
  await client.execute("create table vehicle (vin text primary key)");
  const calls = [];
  mock.module("~/lib/db", () => ({ db: drizzle(client), dbClient: client }));
  mock.module("~/lib/algolia", () => ({
    ALGOLIA_INDEX_NAME: "vehicles",
    getAlgoliaAdminClient: () => ({
      listIndices: async () => ({
        items: [
          { name: "vehicles", entries: 10, updatedAt: new Date().toISOString() },
          { name: "vehicles__rebuild_abandoned", entries: 10, updatedAt: new Date().toISOString() },
        ],
        nbPages: 1,
      }),
      deleteIndex: async ({ indexName }) => {
        calls.push("deleteIndex " + indexName);
        return { taskID: 1 };
      },
      operationIndex: async ({ operationIndexParams }) => {
        calls.push(operationIndexParams.operation + " " + operationIndexParams.destination);
        return { taskID: 2 };
      },
      clearObjects: async ({ indexName }) => {
        calls.push("clearObjects " + indexName);
        return { taskID: 3 };
      },
      getSettings: async () => ({}),
      setSettings: async () => ({ taskID: 4 }),
      waitForTask: async () => {},
    }),
  }));
  const { runDurableAlgoliaProjectionBatch } = await import(
    "./src/server/ingestion/algolia-projector.ts"
  );

  const now = Date.now();
  await client.execute({
    sql: \`insert into ingestion_run (id, source, status, stage, active_slot,
      execution_failures, started_at, last_progress_at)
      values ('rebuilding', 'pyp', 'running', 'full_reindex_prepare', 1, 0, ?, ?),
        ('abandoned', 'row52', 'abandoned', 'full_reindex_load', null, 0, ?, ?)\`,
    args: [now, now, now, now],
  });
  const result = await runDurableAlgoliaProjectionBatch("rebuilding");
  console.log(JSON.stringify({ status: result.status, calls }));
  // The ingestion runtime keeps the event loop alive.
  process.exit(0);
`;

test("a full rebuild deletes leftover rebuild copies before it copies the live index", () => {
  const result = Bun.spawnSync([process.execPath, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: { ...process.env, SKIP_ENV_VALIDATION: "1" },
  });
  expect({
    exitCode: result.exitCode,
    stderr: result.exitCode === 0 ? "" : result.stderr.toString(),
  }).toEqual({ exitCode: 0, stderr: "" });
  expect(
    JSON.parse(result.stdout.toString().trim().split("\n").at(-1) ?? "null"),
  ).toEqual({
    status: "paused",
    calls: [
      "deleteIndex vehicles__rebuild_abandoned",
      "copy vehicles__rebuild_rebuilding",
      "clearObjects vehicles__rebuild_rebuilding",
    ],
  });
});
