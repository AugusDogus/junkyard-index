import { expect, test } from "bun:test";

// Module mocks leak across the suite, so this runs in its own process.
// DELETE_INDEX picks how Algolia answers deleteIndex: "ok", "blocked" (403,
// as on Nov 19) or "unavailable" (503).
const SCRIPT = `
  import { mock } from "bun:test";
  import { createClient } from "@libsql/client";
  import { drizzle } from "drizzle-orm/libsql";
  import { TEST_SCHEMA } from "./src/server/ingestion/durable-ingestion-test-fixtures.ts";

  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_SCHEMA);
  const deleteIndexCalls = [];
  mock.module("server-only", () => ({}));
  mock.module("~/lib/db", () => ({ db: drizzle(client), dbClient: client }));
  mock.module("~/lib/algolia", () => ({
    ALGOLIA_INDEX_NAME: "vehicles",
    getAlgoliaAdminClient: () => ({
      deleteIndex: async ({ indexName }) => {
        deleteIndexCalls.push(indexName);
        if (process.env.DELETE_INDEX === "ok") return { taskID: 1 };
        throw process.env.DELETE_INDEX === "blocked"
          ? Object.assign(new Error("Application is blocked"), {
              name: "ApiError",
              status: 403,
            })
          : Object.assign(new Error("Service Unavailable"), {
              name: "ApiError",
              status: 503,
            });
      },
      waitForTask: async () => {},
    }),
  }));
  const { abandonDurableIngestion, persistDurableIngestionFailure } =
    await import("./src/server/ingestion/durable-ingestion.ts");

  const now = Date.now();
  await client.execute({
    sql: \`insert into ingestion_run (id, source, workflow_run_id, status, stage,
      active_slot, execution_failures, started_at, last_progress_at)
      values ('run-abandon', 'pyp', 'wf-1', 'running', 'full_reindex_load', 1, 0, ?, ?)\`,
    args: [now, now],
  });
  const abandonment = await abandonDurableIngestion({
    runId: "run-abandon",
    force: true,
    cancelWorkflow: async () => {},
  });
  // A second abandon finds the run ended: no cancel, no cleanup.
  const cancelled = [];
  const again = await abandonDurableIngestion({
    runId: "run-abandon",
    force: true,
    cancelWorkflow: async (workflowRunId) => {
      cancelled.push(workflowRunId);
    },
  });

  // A Workflow that already finished answers the cancel with a conflict:
  // the abandon succeeds without telling anyone to cancel it by hand.
  const { EntityConflictError } = await import("workflow/internal/errors");
  await client.execute({
    sql: \`insert into ingestion_run (id, source, workflow_run_id, status, stage,
      active_slot, execution_failures, started_at, last_progress_at)
      values ('run-finished', 'row52', 'wf-2', 'running', 'full_reindex_load', 1, 0, ?, ?)\`,
    args: [now, now],
  });
  // Rebuild cleanup logs its own Algolia failures; keep only Workflow ones.
  const logged = [];
  const consoleError = console.error;
  console.error = (...args) => {
    if (String(args[0]).includes("Workflow")) logged.push(String(args[0]));
    else consoleError(...args);
  };
  const finished = await abandonDurableIngestion({
    runId: "run-finished",
    force: true,
    cancelWorkflow: async (workflowRunId) => {
      throw new EntityConflictError(
        \`Cannot cancel run \${workflowRunId}: already finished with status failed\`,
      );
    },
  });
  console.error = consoleError;

  // The fifth failure abandons the run.
  await client.execute({
    sql: \`insert into ingestion_run (id, source, status, stage, active_slot,
      execution_failures, started_at, last_progress_at)
      values ('run-fail', 'row52', 'running', 'full_reindex_load', 1, 4, ?, ?)\`,
    args: [now, now],
  });
  await persistDurableIngestionFailure("run-fail", "Algolia publication failed");

  const runs = await client.execute(
    "select id, status from ingestion_run order by id",
  );
  console.log(JSON.stringify({
    abandonment,
    again,
    cancelled,
    finished: { workflowCancellation: finished.workflowCancellation, logged },
    deleteIndexCalls,
    runs: runs.rows.map((row) => [row.id, row.status]),
  }));
`;

function run(deleteIndex: "ok" | "blocked" | "unavailable") {
  const result = Bun.spawnSync([process.execPath, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SKIP_ENV_VALIDATION: "1",
      DELETE_INDEX: deleteIndex,
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

test.each([
  ["ok", "done"],
  ["blocked", "deferred"],
  ["unavailable", "deferred"],
] as const)(
  "abandoning or failing a run records it in Turso and deletes its rebuild copy best effort (deleteIndex %s)",
  (deleteIndex, rebuildCleanup) => {
    expect(run(deleteIndex)).toEqual({
      abandonment: {
        status: "abandoned",
        abandoned: { runId: "run-abandon", workflowRunId: "wf-1" },
        workflowCancellation: "cancelled",
        rebuildCleanup,
      },
      again: {
        status: "already_ended",
        runId: "run-abandon",
        runStatus: "abandoned",
      },
      cancelled: [],
      finished: { workflowCancellation: "already_finished", logged: [] },
      deleteIndexCalls: [
        "vehicles__rebuild_run-abandon",
        "vehicles__rebuild_run-finished",
        "vehicles__rebuild_run-fail",
      ],
      runs: [
        ["run-abandon", "abandoned"],
        ["run-fail", "abandoned"],
        ["run-finished", "abandoned"],
      ],
    });
  },
);
