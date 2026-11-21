import { expect, test } from "bun:test";

// The real reconcile entry point (durable-ingestion.ts) while the publication
// mode cannot be read, on a deployment that reads flags. Module mocks leak
// across the suite, so this runs in its own process. The flags client,
// database and Algolia client are faked; nothing else is.
const SCRIPT = `
  import { mock } from "bun:test";
  import { createClient } from "@libsql/client";
  import { drizzle } from "drizzle-orm/libsql";
  import * as flags from "@vercel/flags-core";
  import { RECONCILIATION_TEST_SCHEMA } from "./src/server/ingestion/durable-reconciliation-test-fixtures.ts";

  const evaluated = [];
  mock.module("@vercel/flags-core", () => ({
    ...flags,
    flagsClient: {
      evaluate: async (key) => {
        evaluated.push(key);
        return {
          value: key === "ingestion-publication-mode" ? "inline" : false,
          variantId: null,
          reason: flags.Reason.ERROR,
          errorMessage: "datafile read failed",
        };
      },
    },
  }));
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
  mock.module("~/lib/db", () => ({ db: drizzle(client), dbClient: client }));
  const algoliaCalls = [];
  mock.module("~/lib/algolia", () => ({
    ALGOLIA_INDEX_NAME: "vehicles",
    getAlgoliaAdminClient: () =>
      new Proxy(
        {},
        {
          get: (_, operation) => async () => {
            algoliaCalls.push(String(operation));
            return { taskID: 1 };
          },
        },
      ),
  }));
  const { reconcileDurableIngestion } = await import(
    "./src/server/ingestion/durable-ingestion.ts"
  );

  // A run holding the commit mid-reconciliation, which owes a rebuild.
  await client.execute(\`insert into ingestion_run (
      id, source, status, stage, active_slot, commit_started_at, ready_at,
      execution_failures, full_reindex_required, accepted_sources,
      started_at, last_progress_at
    ) values ('run', 'pyp', 'running', 'reconcile_upsert', 1, 1000, 900,
      2, 1, '["pyp"]', 0, 1000)\`);
  const read = async () =>
    ({
      ...(
        await client.execute(
          "select status, stage, active_slot, execution_failures, full_reindex_required, reconciliation_cursor, last_progress_at, publication_sequence from ingestion_run where id = 'run'",
        )
      ).rows[0],
    });
  const before = await read();
  let results;
  let error = null;
  try {
    results = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      results.push(await reconcileDurableIngestion("run"));
    }
  } catch (caught) {
    error = caught?._tag ?? String(caught);
  }
  const changes = (
    await client.execute("select count(*) as n from vehicle_change_v2")
  ).rows[0]?.n;
  console.log(
    JSON.stringify({
      results,
      error,
      before,
      after: await read(),
      changes,
      algoliaCalls,
      modeRead: evaluated.includes("ingestion-publication-mode"),
    }),
  );
`;

test("an unreadable publication mode returns mode_unavailable from every reconcile attempt and leaves the run untouched", () => {
  const result = Bun.spawnSync([process.execPath, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SKIP_ENV_VALIDATION: "1",
      // A deployment that reads flags, so an evaluation error is an outage
      // rather than an unconfigured process.
      FLAGS: "test",
    },
  });
  expect({
    exitCode: result.exitCode,
    stderr: result.exitCode === 0 ? "" : result.stderr.toString(),
  }).toEqual({ exitCode: 0, stderr: "" });
  const outcome = JSON.parse(
    result.stdout.toString().trim().split("\n").at(-1) ?? "null",
  );
  expect(outcome.error).toBeNull();
  expect(outcome.modeRead).toBe(true);
  expect(outcome.results).toEqual([
    { status: "mode_unavailable" },
    { status: "mode_unavailable" },
    { status: "mode_unavailable" },
    { status: "mode_unavailable" },
  ]);
  // Not released, not skipped, not a failure: the run is exactly as it was.
  expect(outcome.after).toEqual(outcome.before);
  expect(outcome.after).toMatchObject({
    status: "running",
    stage: "reconcile_upsert",
    active_slot: 1,
    execution_failures: 2,
    full_reindex_required: 1,
  });
  expect(outcome.changes).toBe(0);
  expect(outcome.algoliaCalls).toEqual([]);
});
