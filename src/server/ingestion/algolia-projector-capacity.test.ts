import { describe, expect, test } from "bun:test";
import { z } from "zod";

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

  const scenario = JSON.parse(process.env.CAPACITY_SCENARIO);
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SEARCH_PROJECTOR_TEST_SCHEMA);
  const database = drizzle(client);
  const algolia = cappedAlgolia({
    limit: Number(process.env.ALGOLIA_RECORD_LIMIT),
    underreportEntries: scenario.underreportEntries,
    failOnce: scenario.failOnce,
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

  const turso = Array.from({ length: scenario.vehicles }, (_, i) => "VIN" + String(i).padStart(5, "0"));
  for (let start = 0; start < turso.length; start += 200) {
    await database.insert(vehicle).values(turso.slice(start, start + 200).map((vin) => vehicleRow(vin)));
  }
  const stale = Array.from({ length: scenario.stale }, (_, i) => "GONE" + String(i).padStart(5, "0"));
  algolia.seed("vehicles", [...turso.slice(0, scenario.liveVehicles), ...stale], ["vehicles_year_desc"]);

  const stage = scenario.incremental ? "project_changes" : "full_reindex_prepare";
  await client.execute({
    sql: \`insert into ingestion_run (id, source, status, stage, active_slot,
      full_reindex_required, started_at, last_progress_at, commit_started_at)
      values ('run', 'pyp', 'running', ?, 1, ?, 1000, 1000, 2000)\`,
    args: [stage, scenario.incremental ? 0 : 1],
  });
  if (scenario.incremental) {
    await client.execute(\`insert into vehicle_change_v2
      (run_id, vin, change_type, payload_version, created_at)
      values ('run', 'VIN00017', 'upsert', 1, 0), ('run', 'GONE00000', 'delete', 1, 0)\`);
  }

  // Steps as the workflow does, retrying a step that throws.
  const results = [];
  const errors = [];
  for (let step = 0; step < 40; step += 1) {
    let result;
    try {
      result = await runDurableAlgoliaProjectionBatch("run");
    } catch (error) {
      results.push("threw");
      errors.push(error instanceof Error ? error.message : String(error));
      if (errors.length >= scenario.maxErrors) break;
      continue;
    }
    results.push(result.status === "paused" ? result.stage : result.status);
    if (result.status !== "paused") break;
  }
  const [run] = (await client.execute(
    "select stage, status, full_reindex_required, full_reindex_cursor from ingestion_run where id = 'run'",
  )).rows;
  console.log(JSON.stringify({
    results,
    errors,
    objectIDs: algolia.objectIDs("vehicles"),
    indices: [...algolia.indices.keys()].sort(),
    stored: algolia.stored(),
    copies: algolia.calls.filter((call) => call.startsWith("operationIndex")),
    browses: algolia.calls.filter((call) => call.startsWith("browse")).length,
    lists: algolia.calls.filter((call) => call.startsWith("listIndices")).length,
    run: {
      stage: run.stage,
      status: run.status,
      fullReindexRequired: run.full_reindex_required,
      cursor: run.full_reindex_cursor,
    },
  }));
  // The ingestion runtime keeps the event loop alive.
  process.exit(0);
`;

type Scenario = {
  /** Turso vehicles, VIN00000 upward. */
  vehicles: number;
  /** The first this many vehicles are already in the live index. */
  liveVehicles: number;
  /** Live records Turso no longer has. */
  stale: number;
  limit: number;
  /** listIndices reports 0 entries, so the guard lets the copy start. */
  underreportEntries: boolean;
  failOnce?: { operation: string; call: number };
  incremental?: boolean;
  /** Stop after this many thrown steps. */
  maxErrors?: number;
};

const outcomeSchema = z.object({
  results: z.array(z.string()),
  errors: z.array(z.string()),
  objectIDs: z.array(z.string()),
  indices: z.array(z.string()),
  stored: z.number(),
  copies: z.array(z.string()),
  browses: z.number(),
  lists: z.number(),
  run: z.object({
    stage: z.string(),
    status: z.string(),
    fullReindexRequired: z.number(),
    cursor: z.string().nullable(),
  }),
});

type Outcome = z.infer<typeof outcomeSchema>;

function runScenario(scenario: Scenario): Outcome {
  const result = Bun.spawnSync([process.execPath, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SKIP_ENV_VALIDATION: "1",
      ALGOLIA_RECORD_LIMIT: String(scenario.limit),
      CAPACITY_SCENARIO: JSON.stringify({ maxErrors: 1, ...scenario }),
    },
  });
  expect({
    exitCode: result.exitCode,
    stderr: result.exitCode === 0 ? "" : result.stderr.toString(),
  }).toEqual({ exitCode: 0, stderr: "" });
  const output: unknown = JSON.parse(
    result.stdout.toString().trim().split("\n").at(-1) ?? "null",
  );
  return outcomeSchema.parse(output);
}

function vins(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `VIN${String(index).padStart(5, "0")}`,
  );
}

const TURSO = vins(18);

// 25 live records (15 vehicles, 10 stale): a copy needs 25 + 18, over 40.
const SMALL = {
  vehicles: 18,
  liveVehicles: 15,
  stale: 10,
  limit: 40,
} as const;

// 510 live records (500 vehicles, 10 stale) under a cap of 1,010: the copy's
// first 500-vehicle batch fits exactly and its second is refused, so the
// refused copy holds 500 records the in-place load needs.
const LARGE = {
  vehicles: 600,
  liveVehicles: 500,
  stale: 10,
  limit: 1_010,
  underreportEntries: true,
} as const;

describe("full reindex over the Algolia record cap", () => {
  test("the capacity guard rebuilds in place instead of copying", () => {
    expect(runScenario({ ...SMALL, underreportEntries: false })).toEqual({
      results: [
        "full_reindex_inplace_load",
        "full_reindex_inplace_sweep",
        "complete",
      ],
      errors: [],
      objectIDs: TURSO,
      indices: ["vehicles", "vehicles_year_desc"],
      stored: 18,
      copies: [],
      browses: 2,
      lists: 2,
      run: {
        stage: "released",
        status: "success",
        fullReindexRequired: 0,
        cursor: null,
      },
    });
  });

  test("a copy Algolia refuses over quota moves in place instead of looping", () => {
    expect(runScenario({ ...SMALL, underreportEntries: true })).toEqual({
      results: [
        "full_reindex_load",
        "full_reindex_inplace_load",
        "full_reindex_inplace_sweep",
        "complete",
      ],
      errors: [],
      objectIDs: TURSO,
      indices: ["vehicles", "vehicles_year_desc"],
      stored: 18,
      // One copy, never retried.
      copies: ["operationIndex copy vehicles__rebuild_run"],
      browses: 2,
      lists: 3,
      run: {
        stage: "released",
        status: "success",
        fullReindexRequired: 0,
        cursor: null,
      },
    });
  });

  test("a copy refused in its second batch is deleted before the in-place load needs its records", () => {
    const outcome = runScenario(LARGE);
    expect(outcome.results).toEqual([
      "full_reindex_load",
      "full_reindex_load",
      "full_reindex_inplace_load",
      "full_reindex_inplace_load",
      "full_reindex_inplace_sweep",
      "complete",
    ]);
    expect(outcome.objectIDs).toEqual(vins(600));
    expect(outcome.indices).toEqual(["vehicles", "vehicles_year_desc"]);
    expect(outcome.stored).toBe(600);
    expect(outcome.copies).toEqual([
      "operationIndex copy vehicles__rebuild_run",
    ]);
    expect(outcome.run).toEqual({
      stage: "released",
      status: "success",
      fullReindexRequired: 0,
      cursor: null,
    });
  });

  test("a failed delete of the refused copy keeps the copy path until the delete succeeds", () => {
    const outcome = runScenario({
      ...LARGE,
      failOnce: { operation: "deleteIndex", call: 1 },
      maxErrors: 3,
    });
    expect(outcome.results).toEqual([
      "full_reindex_load",
      "full_reindex_load",
      "threw",
      "full_reindex_inplace_load",
      "full_reindex_inplace_load",
      "full_reindex_inplace_sweep",
      "complete",
    ]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.objectIDs).toEqual(vins(600));
    expect(outcome.indices).toEqual(["vehicles", "vehicles_year_desc"]);
    expect(outcome.stored).toBe(600);
    expect(outcome.run.stage).toBe("released");
  });

  test("an in-place load refused over quota fails with the counts and keeps its cursor", () => {
    // 40 live records (15 vehicles, 25 stale) at a cap of 40: the 3 vehicles
    // new to the index have no room even in place.
    const outcome = runScenario({
      ...SMALL,
      stale: 25,
      underreportEntries: false,
      maxErrors: 2,
    });
    expect(outcome.results).toEqual([
      "full_reindex_inplace_load",
      "threw",
      "threw",
    ]);
    expect(outcome.copies).toEqual([]);
    expect(outcome.run).toEqual({
      stage: "full_reindex_inplace_load",
      status: "running",
      fullReindexRequired: 1,
      cursor: null,
    });
    expect(outcome.errors[0]).toContain(
      "In-place search rebuild run at full_reindex_inplace_load was refused by Algolia over the record quota",
    );
    expect(outcome.errors[0]).toContain(
      "The live index vehicles holds 40 records, Turso has 18 vehicles, no other index holds records, and the cap is 40.",
    );
    expect(outcome.errors[0]).toContain("Live search and Turso are intact");
  });

  test("daily incremental projection is unchanged", () => {
    expect(
      runScenario({
        ...SMALL,
        underreportEntries: false,
        incremental: true,
      }),
    ).toEqual({
      results: ["project_changes", "complete"],
      errors: [],
      objectIDs: [
        ...TURSO.slice(0, 15),
        "VIN00017",
        ...Array.from(
          { length: 9 },
          (_, index) => `GONE${String(index + 1).padStart(5, "0")}`,
        ),
      ].sort(),
      indices: ["vehicles", "vehicles_year_desc"],
      stored: 25,
      copies: [],
      browses: 0,
      lists: 0,
      run: {
        stage: "released",
        status: "success",
        fullReindexRequired: 0,
        cursor: null,
      },
    });
  });
});
