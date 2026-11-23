import { expect, test } from "bun:test";

const MODULE = new URL("./actions.ts", import.meta.url).pathname;

/**
 * Calls stopIngestionRun in a child process with the admin gate, database
 * reads, abandon and workflow mocked, so the mocks stay out of other test
 * files. Resolves what the action returned or threw, and every call it made.
 */
async function stopAs(admin: boolean, input: unknown) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      const calls = [];
      mock.module("server-only", () => ({}));
      mock.module("~/lib/db", () => ({ db: {} }));
      mock.module("~/server/admin/require-admin", () => ({
        requireAdmin: async () => {
          if (!${admin}) throw new Error("notFound");
          return { userId: "owner" };
        },
      }));
      mock.module("~/server/admin/source-run-repository", () => ({
        SourceRunRepository: {
          stopTarget: async (_db, runId) => {
            calls.push(["read", runId]);
            return { runId, source: "pyp", status: "running", stage: "reconcile_upsert" };
          },
        },
      }));
      mock.module("~/server/source-control/source-control-repository", () => ({
        SourceControlRepository: {
          logStop: async (_db, entry) => calls.push(["logStop", entry.runId, entry.userId]),
          logRun: async () => calls.push(["logRun"]),
        },
      }));
      mock.module("workflow/api", () => ({
        getRun: (id) => ({ cancel: async () => calls.push(["cancel", id]) }),
      }));
      mock.module("~/server/ingestion/manual-ingestion-run-runtime", () => ({
        startManualIngestionRun: async () => calls.push(["startRun"]),
      }));
      mock.module("~/server/ingestion/durable-ingestion", () => ({
        abandonDurableIngestion: async ({ runId, force, cancelWorkflow }) => {
          calls.push(["abandon", runId, force]);
          await cancelWorkflow("wrun-1");
          return {
            status: "abandoned",
            abandoned: { runId, workflowRunId: "wrun-1" },
            workflowCancellation: "cancelled",
            rebuildCleanup: "done",
          };
        },
      }));
      const { stopIngestionRun } = await import(${JSON.stringify(MODULE)});
      let outcome;
      try {
        outcome = await stopIngestionRun(${JSON.stringify(input)});
      } catch (error) {
        outcome = { thrown: error.message };
      }
      process.stdout.write(JSON.stringify({ outcome, calls }));
    `,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SKIP_ENV_VALIDATION: "1" },
    },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(output);
}

test("a non-admin gets the 404 and nothing is read or stopped", async () => {
  expect(
    await stopAs(false, { kind: "stop", runId: "run-1", force: true }),
  ).toEqual({ outcome: { thrown: "notFound" }, calls: [] });
});

test("an admin stops the run through abandon, cancelling its workflow, and it is logged", async () => {
  const { outcome, calls } = await stopAs(true, {
    kind: "stop",
    runId: "run-1",
    force: true,
  });
  expect(outcome.status).toBe("done");
  expect(calls).toEqual([
    ["read", "run-1"],
    ["abandon", "run-1", true],
    ["cancel", "wrun-1"],
    ["logStop", "run-1", "owner"],
  ]);
});
