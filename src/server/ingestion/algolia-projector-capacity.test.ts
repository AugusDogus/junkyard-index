import { describe, expect, test } from "bun:test";

// Module mocks leak across the suite, so each case runs in its own process
// against a fake Algolia app that refuses records past ALGOLIA_RECORD_LIMIT.
const SCRIPT = `
  import { mock } from "bun:test";
  import { createClient } from "@libsql/client";
  import { drizzle } from "drizzle-orm/libsql";
  import { vehicle } from "~/schema";
  import { SEARCH_PROJECTOR_TEST_SCHEMA, vehicleRow } from "./src/server/ingestion/search-projector-test-fixtures.ts";
  import { cappedAlgolia } from "./src/server/ingestion/algolia-capped-fake-test-fixtures.ts";
  import { mapDbVehicleToAlgolia } from "./src/server/ingestion/algolia-projector-helpers.ts";

  const scenario = process.env.CAPACITY_SCENARIO;
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SEARCH_PROJECTOR_TEST_SCHEMA);
  const database = drizzle(client);
  const algolia = cappedAlgolia({
    limit: Number(process.env.ALGOLIA_RECORD_LIMIT),
    underreportEntries: scenario === "quota",
  });
  mock.module("~/lib/db", () => ({ db: database, dbClient: client }));
  mock.module("~/lib/algolia", () => ({
    ALGOLIA_INDEX_NAME: "vehicles",
    getAlgoliaAdminClient: () => algolia.client,
  }));
  mock.module(process.cwd() + "/src/server/ingestion/vehicle-search-projection.ts", () => ({
    projectSearchVehicles: async (_database, rows) => rows.map(mapDbVehicleToAlgolia),
  }));
  const { runDurableAlgoliaProjectionBatch } = await import(
    "./src/server/ingestion/algolia-projector.ts"
  );

  const turso = Array.from({ length: 18 }, (_, i) => "VIN" + String(i).padStart(5, "0"));
  await database.insert(vehicle).values(turso.map((vin) => vehicleRow(vin)));
  const stale = Array.from({ length: 10 }, (_, i) => "GONE" + String(i).padStart(5, "0"));
  // 25 live records: a copy needs 25 + 18, over the cap of 40.
  algolia.seed("vehicles", [...turso.slice(0, 15), ...stale], ["vehicles_year_desc"]);

  const stage = scenario === "incremental" ? "project_changes" : "full_reindex_prepare";
  await client.execute({
    sql: \`insert into ingestion_run (id, source, status, stage, active_slot,
      full_reindex_required, started_at, last_progress_at, commit_started_at)
      values ('run', 'pyp', 'running', ?, 1, ?, 1000, 1000, 2000)\`,
    args: [stage, scenario === "incremental" ? 0 : 1],
  });
  if (scenario === "incremental") {
    await client.execute(\`insert into vehicle_change_v2
      (run_id, vin, change_type, payload_version, created_at)
      values ('run', 'VIN00017', 'upsert', 1, 0), ('run', 'GONE00000', 'delete', 1, 0)\`);
  }

  const results = [];
  let result;
  for (let step = 0; step < 40; step += 1) {
    result = await runDurableAlgoliaProjectionBatch("run");
    results.push(result.status === "paused" ? result.stage : result.status);
    if (result.status !== "paused") break;
  }
  const [run] = (await client.execute(
    "select stage, status, full_reindex_required, execution_failures from ingestion_run where id = 'run'",
  )).rows;
  console.log(JSON.stringify({
    results,
    objectIDs: algolia.objectIDs("vehicles"),
    indices: [...algolia.indices.keys()].sort(),
    copies: algolia.calls.filter((call) => call.startsWith("operationIndex")),
    browses: algolia.calls.filter((call) => call.startsWith("browse")).length,
    lists: algolia.calls.filter((call) => call.startsWith("listIndices")).length,
    run: { stage: run.stage, status: run.status, fullReindexRequired: run.full_reindex_required },
  }));
  // The ingestion runtime keeps the event loop alive.
  process.exit(0);
`;

function runScenario(scenario: "guard" | "quota" | "incremental") {
  const result = Bun.spawnSync([process.execPath, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SKIP_ENV_VALIDATION: "1",
      ALGOLIA_RECORD_LIMIT: "40",
      CAPACITY_SCENARIO: scenario,
    },
  });
  expect({
    exitCode: result.exitCode,
    stderr: result.exitCode === 0 ? "" : result.stderr.toString(),
  }).toEqual({ exitCode: 0, stderr: "" });
  const output: unknown = JSON.parse(
    result.stdout.toString().trim().split("\n").at(-1) ?? "null",
  );
  return output;
}

const TURSO = Array.from(
  { length: 18 },
  (_, index) => `VIN${String(index).padStart(5, "0")}`,
);

describe("full reindex over the Algolia record cap", () => {
  test("the capacity guard rebuilds in place instead of copying", () => {
    expect(runScenario("guard")).toEqual({
      results: [
        "full_reindex_inplace_load",
        "full_reindex_inplace_sweep",
        "complete",
      ],
      objectIDs: TURSO,
      indices: ["vehicles", "vehicles_year_desc"],
      copies: [],
      browses: 2,
      lists: 2,
      run: { stage: "released", status: "success", fullReindexRequired: 0 },
    });
  });

  test("a copy Algolia refuses over quota moves in place instead of looping", () => {
    expect(runScenario("quota")).toEqual({
      results: [
        "full_reindex_load",
        "full_reindex_inplace_load",
        "full_reindex_inplace_sweep",
        "complete",
      ],
      objectIDs: TURSO,
      indices: ["vehicles", "vehicles_year_desc"],
      // One copy, never retried.
      copies: ["operationIndex copy vehicles__rebuild_run"],
      browses: 2,
      lists: 3,
      run: { stage: "released", status: "success", fullReindexRequired: 0 },
    });
  });

  test("daily incremental projection is unchanged", () => {
    expect(runScenario("incremental")).toEqual({
      results: ["project_changes", "complete"],
      objectIDs: [
        ...TURSO.slice(0, 15),
        "VIN00017",
        ...Array.from(
          { length: 9 },
          (_, index) => `GONE${String(index + 1).padStart(5, "0")}`,
        ),
      ].sort(),
      indices: ["vehicles", "vehicles_year_desc"],
      copies: [],
      browses: 0,
      lists: 0,
      run: { stage: "released", status: "success", fullReindexRequired: 0 },
    });
  });
});
