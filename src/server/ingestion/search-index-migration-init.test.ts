import { expect, test } from "bun:test";

// Module mocks leak across the suite, so this runs in its own process.
const SCRIPT = `
  import { mock } from "bun:test";
  const calls = [];
  mock.module("~/lib/db", () => ({ db: {}, dbClient: {} }));
  mock.module("~/server/model-url-history", () => ({
    retainModelUrls: async () => 0,
  }));
  mock.module("~/lib/algolia", () => ({
    ALGOLIA_INDEX_NAME: "vehicles",
    getAlgoliaAdminClient: () => ({
      getSettings: async ({ indexName }) => {
        calls.push("getSettings " + indexName);
        throw Object.assign(new Error("Index does not exist"), { status: 404 });
      },
      setSettings: async ({ indexName }) => {
        calls.push("setSettings " + indexName);
        return { taskID: 1 };
      },
      deleteIndex: async ({ indexName }) => {
        calls.push("deleteIndex " + indexName);
        return { taskID: 2 };
      },
      waitForTask: async () => {},
    }),
  }));
  const { initializeSearchIndexMigration } = await import(
    "./src/server/ingestion/search-index-migration.ts"
  );
  const result = await initializeSearchIndexMigration();
  console.log(JSON.stringify({ status: result.status, calls }));
`;

test("a missing live index counts as schema version 0, so the settings plan creates it", () => {
  const result = Bun.spawnSync([process.execPath, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: { ...process.env, SKIP_ENV_VALIDATION: "1" },
  });
  expect({
    exitCode: result.exitCode,
    stderr: result.exitCode === 0 ? "" : result.stderr.toString(),
  }).toEqual({ exitCode: 0, stderr: "" });
  const output = JSON.parse(
    result.stdout.toString().trim().split("\n").at(-1) ?? "null",
  );
  expect(output.status).toBe("pending");
  expect(output.calls[0]).toBe("getSettings vehicles");
  expect(output.calls).toContain("setSettings vehicles");
});
