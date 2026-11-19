import { expect, test } from "bun:test";

// Runs reportDurableProviderStatus in its own process so module mocks (env,
// database, Better Stack) never leak into the rest of the suite.
test("a provider reports published once Turso has its accepted inventory, whether or not search caught up", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    import { createClient } from "@libsql/client";
    import { drizzle } from "drizzle-orm/libsql";
    import { TEST_SCHEMA } from "./src/server/ingestion/durable-ingestion-test-fixtures.ts";
    const client = createClient({ url: ":memory:" });
    await client.executeMultiple(TEST_SCHEMA);
    const runs = [
      // Released by the skip switch: inventory published, search never did.
      ["skipped", "success", "released", 1, null, '["pyp"]'],
      // Abandoned in a search stage after its inventory published.
      ["abandoned-after-publication", "abandoned", "project_changes", 1, null, '["pyp"]'],
      ["searched", "success", "released", 1, 2, '["pyp"]'],
      ["unpublished", "error", "sources", null, null, '[]'],
      ["rejected", "success", "released", 1, 2, '[]'],
    ];
    for (const [id, status, stage, inventory, search, accepted] of runs) {
      await client.execute({
        sql: "insert into ingestion_run (id, source, status, stage, started_at, last_progress_at, inventory_published_at, search_published_at, accepted_sources) values (?, 'pyp', ?, ?, 0, 0, ?, ?, ?)",
        args: [id, status, stage, inventory, search, accepted],
      });
    }
    mock.module("server-only", () => ({}));
    mock.module("~/lib/db", () => ({ db: drizzle(client), dbClient: client }));
    mock.module("~/lib/algolia", () => ({
      ALGOLIA_INDEX_NAME: "vehicles",
      getAlgoliaAdminClient: () => { throw new Error("Provider status must not call Algolia"); },
    }));
    mock.module("~/env", () => ({
      env: { BETTERSTACK_API_TOKEN: "token", BETTERSTACK_PROVIDERS: "", BLOB_READ_WRITE_TOKEN: "blob" },
    }));
    const reports = [];
    mock.module("~/server/ingestion/better-stack-providers", () => ({
      BetterStackProviders: {
        parse: () => ({}),
        report: async ({ state }) => { reports.push(state); },
        progress: async () => {},
      },
    }));
    process.env.VERCEL_ENV = "production";
    const { reportDurableProviderStatus } = await import("./src/server/ingestion/durable-ingestion.ts");
    for (const [id] of runs) await reportDurableProviderStatus(id);
    console.log(JSON.stringify(reports));
  `,
    ],
    { cwd: process.cwd() },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  expect(
    JSON.parse(result.stdout.toString().trim().split("\n").at(-1) ?? ""),
  ).toEqual(["published", "published", "published", "retrying", "retrying"]);
});
