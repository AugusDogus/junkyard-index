import { expect, test } from "bun:test";

// Module mocks leak across the suite, so each scenario runs in its own
// process. The flags client, database and Algolia client are faked; the
// publication mode flag and the projection batch are the real code.
const SCRIPT = `
  import { mock } from "bun:test";
  import { createClient } from "@libsql/client";
  import { drizzle } from "drizzle-orm/libsql";
  import * as flags from "@vercel/flags-core";
  import { TEST_SCHEMA } from "./src/server/ingestion/durable-ingestion-test-fixtures.ts";

  const reading = process.env.MODE_READING;
  mock.module("@vercel/flags-core", () => ({
    ...flags,
    flagsClient: {
      evaluate: async (key) =>
        key !== "ingestion-publication-mode"
          ? { value: false, variantId: "off", reason: flags.Reason.FALLTHROUGH }
          : reading === "unavailable"
            ? { value: "inline", variantId: null, reason: flags.Reason.ERROR, errorMessage: "datafile read failed" }
            : { value: reading, variantId: reading, reason: flags.Reason.FALLTHROUGH },
    },
  }));
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_SCHEMA);
  const calls = [];
  mock.module("~/lib/db", () => ({ db: drizzle(client), dbClient: client }));
  mock.module("~/lib/algolia", () => ({
    ALGOLIA_INDEX_NAME: "vehicles",
    getAlgoliaAdminClient: () =>
      new Proxy(
        {},
        {
          get: (_, operation) => async (params) => {
            calls.push(String(operation));
            if (operation === "getSettings") {
              return { userData: { junkyardIndexGeneration: "run" } };
            }
            if (operation === "listIndices") return { items: [], nbPages: 1 };
            return { taskID: 1 };
          },
        },
      ),
  }));
  const { runDurableAlgoliaProjectionBatch } = await import(
    "./src/server/ingestion/algolia-projector.ts"
  );
  await client.execute({
    sql: \`insert into ingestion_run (id, source, status, stage, active_slot,
      full_reindex_required, execution_failures, started_at, last_progress_at)
      values ('run', 'pyp', 'running', ?, 1, 1, 0, 0, 0)\`,
    args: [process.env.STAGE],
  });
  let outcome;
  try {
    // Several batches in a row, as a run retrying through an outage would.
    const results = [];
    for (let attempt = 0; attempt < Number(process.env.ATTEMPTS ?? "1"); attempt += 1) {
      results.push(await runDurableAlgoliaProjectionBatch("run"));
    }
    outcome = { result: results.at(-1), results: results.length };
  } catch (error) {
    outcome = { error: error._tag ?? String(error) };
  }
  const run = (
    await client.execute(
      "select status, stage, active_slot, full_reindex_required, execution_failures from ingestion_run where id = 'run'",
    )
  ).rows[0];
  console.log(JSON.stringify({ ...outcome, calls, run: { ...run } }));
`;

function scenario(reading: string, stage: string, attempts = 1) {
  const result = Bun.spawnSync([process.execPath, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SKIP_ENV_VALIDATION: "1",
      // A deployment that reads flags, so an evaluation error is a real
      // outage rather than an unconfigured process.
      FLAGS: "test",
      MODE_READING: reading,
      STAGE: stage,
      ATTEMPTS: String(attempts),
    },
  });
  expect({
    exitCode: result.exitCode,
    stderr: result.exitCode === 0 ? "" : result.stderr.toString(),
  }).toEqual({ exitCode: 0, stderr: "" });
  return JSON.parse(
    result.stdout.toString().trim().split("\n").at(-1) ?? "null",
  );
}

test("decoupled, a run loading a rebuild hands off to the projector without calling Algolia", () => {
  expect(scenario("decoupled", "full_reindex_load")).toEqual({
    result: { status: "complete", releasedTo: "search_projector" },
    results: 1,
    calls: [],
    run: {
      status: "success",
      stage: "released",
      active_slot: null,
      full_reindex_required: 1,
      execution_failures: 0,
    },
  });
});

test("an unreadable mode waits without releasing, discarding, writing or counting a failure, however long it lasts", () => {
  expect(scenario("unavailable", "full_reindex_load", 6)).toEqual({
    result: { status: "mode_unavailable" },
    results: 6,
    calls: [],
    run: {
      status: "running",
      stage: "full_reindex_load",
      active_slot: 1,
      full_reindex_required: 1,
      execution_failures: 0,
    },
  });
});

test("decoupled, a run moving an index still finishes its move inline", () => {
  const outcome = scenario("decoupled", "full_reindex_move_pending");
  expect(outcome.result).toMatchObject({ status: "complete" });
  expect(outcome.result.searchPublishedAt).toBeString();
  // It confirmed its generation on the live index and removed its copy.
  expect(outcome.calls).toEqual(["getSettings", "deleteIndex", "waitForTask"]);
  expect(outcome.run).toEqual({
    status: "success",
    stage: "released",
    active_slot: null,
    full_reindex_required: 0,
    execution_failures: 0,
  });
});
