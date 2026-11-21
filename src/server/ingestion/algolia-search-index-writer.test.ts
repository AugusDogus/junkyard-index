import { expect, test } from "bun:test";

// The real Algolia writer over a recording admin client. Module mocks leak
// across the suite, so this runs in its own process.
const SCRIPT = `
  import { mock } from "bun:test";
  import { Effect } from "effect";
  const sourceExists = process.env.SOURCE_EXISTS === "1";
  const calls = [];
  mock.module("~/lib/db", () => ({ db: {}, dbClient: {} }));
  mock.module("~/lib/algolia", () => ({
    ALGOLIA_INDEX_NAME: "vehicles",
    getAlgoliaAdminClient: () => ({
      getSettings: async ({ indexName }) => {
        calls.push("getSettings " + indexName);
        if (indexName === "vehicles" && !sourceExists) {
          throw Object.assign(new Error("Index does not exist"), { status: 404 });
        }
        return { userData: { searchSchemaVersion: 11 } };
      },
      // Like Algolia: copying a missing index succeeds and creates an empty
      // default-settings index.
      operationIndex: async ({ indexName, operationIndexParams }) => {
        calls.push(operationIndexParams.operation + " " + indexName + " " + operationIndexParams.destination);
        return { taskID: 1 };
      },
      clearObjects: async ({ indexName }) => {
        calls.push("clearObjects " + indexName);
        return { taskID: 2 };
      },
      setSettings: async ({ indexName }) => {
        calls.push("setSettings " + indexName);
        return { taskID: 3 };
      },
      waitForTask: async () => {},
    }),
  }));
  const { AlgoliaSearchIndexWriter } = await import(
    "./src/server/ingestion/algolia-search-index-writer.ts"
  );
  const result = await Effect.runPromise(
    AlgoliaSearchIndexWriter.prepareIndex({
      from: "vehicles",
      to: "vehicles__generation_g1",
      generation: "g1",
    }),
  );
  console.log(JSON.stringify({ result, calls }));
`;

function prepare(sourceExists: boolean) {
  const result = Bun.spawnSync([process.execPath, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SKIP_ENV_VALIDATION: "1",
      SOURCE_EXISTS: sourceExists ? "1" : "0",
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

test("a missing live index is reported, never copied into a default-settings index", () => {
  expect(prepare(false)).toEqual({
    result: "missing_source",
    calls: ["getSettings vehicles"],
  });
});

test("an existing live index is copied without records, cleared and stamped", () => {
  expect(prepare(true)).toEqual({
    result: "copied",
    calls: [
      "getSettings vehicles",
      "copy vehicles vehicles__generation_g1",
      "clearObjects vehicles__generation_g1",
      "getSettings vehicles__generation_g1",
      "setSettings vehicles__generation_g1",
    ],
  });
});
