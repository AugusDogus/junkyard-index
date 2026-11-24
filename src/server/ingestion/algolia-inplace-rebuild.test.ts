import type { Client } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { vehicle } from "~/schema";
import {
  cappedAlgolia,
  type BrowseCursorMode,
} from "./algolia-capped-fake-test-fixtures";
import {
  InPlaceRebuild,
  type InPlaceRebuildStepResult,
  type InPlaceStage,
} from "./algolia-inplace-rebuild";
import { mapDbVehicleToAlgolia } from "./algolia-projector-helpers";
import { RecordCapacity } from "./algolia-record-capacity";
import {
  INDEX,
  createProjectorDatabase,
  vehicleRow,
} from "./search-projector-test-fixtures";

const RUN = "run-1";

function vins(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index).padStart(5, "0")}`,
  );
}

function inPlaceStage(value: unknown): InPlaceStage {
  if (
    value === "full_reindex_inplace_load" ||
    value === "full_reindex_inplace_sweep"
  ) {
    return value;
  }
  throw new Error(`Run ${RUN} is not rebuilding in place: ${String(value)}`);
}

async function setup(params: {
  turso: readonly string[];
  live: readonly string[];
  limit: number;
  browsePageSize?: number;
  cursorMode?: BrowseCursorMode;
  failOnce?: { operation: string; call: number };
}) {
  const { client, database } = await createProjectorDatabase();
  for (let start = 0; start < params.turso.length; start += 200) {
    await database
      .insert(vehicle)
      .values(
        params.turso.slice(start, start + 200).map((vin) => vehicleRow(vin)),
      );
  }
  await client.execute({
    sql: `insert into ingestion_run (
      id, source, status, stage, active_slot, full_reindex_required,
      started_at, last_progress_at, commit_started_at
    ) values (?, 'pyp', 'running', 'full_reindex_inplace_load', 1, 1, 1000, 1000, 2000)`,
    args: [RUN],
  });
  // An unprocessed change the rebuild covers, and an earlier run's repair.
  await client.execute(`insert into ingestion_run (
      id, source, status, stage, active_slot, full_reindex_required,
      started_at, last_progress_at, released_at
    ) values ('earlier', 'pyp', 'abandoned', 'full_reindex_load', null, 1, 500, 500, 600)`);
  await client.execute(`insert into vehicle_change_v2 (
      run_id, vin, change_type, payload_version, created_at
    ) values ('${RUN}', '${params.turso[0] ?? "none"}', 'upsert', 1, 0)`);
  const algolia = cappedAlgolia({
    limit: params.limit,
    browsePageSize: params.browsePageSize,
    cursorMode: params.cursorMode,
    failOnce: params.failOnce,
  });
  algolia.seed(INDEX, params.live, ["vehicles_year_desc"]);
  const context = {
    runId: RUN,
    runStartedAt: new Date(1000),
    database,
    algolia: algolia.client,
    indexName: INDEX,
    project: async (rows: Array<typeof vehicle.$inferSelect>) =>
      rows.map(mapDbVehicleToAlgolia),
  };
  return { client, database, algolia, context };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function runRow(client: Client) {
  const result = await client.execute({
    sql: "select stage, status, active_slot, full_reindex_required, full_reindex_cursor from ingestion_run where id = ?",
    args: [RUN],
  });
  const row = result.rows[0];
  if (!row) throw new Error(`Run ${RUN} is missing.`);
  return {
    stage: String(row.stage),
    status: String(row.status),
    activeSlot: row.active_slot,
    fullReindexRequired: Number(row.full_reindex_required),
    cursor:
      row.full_reindex_cursor === null ? null : String(row.full_reindex_cursor),
  };
}

/** Steps the rebuild until it leaves `paused`, as the workflow loop does. */
async function drive(
  { client, context }: Setup,
  maxSteps = 50,
): Promise<{ result: InPlaceRebuildStepResult; stages: string[] }> {
  const stages: string[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const run = await runRow(client);
    const result = await InPlaceRebuild.step(context, {
      stage: inPlaceStage(run.stage),
      fullReindexCursor: run.cursor,
    });
    if (result.status !== "paused") return { result, stages };
    stages.push(result.stage);
  }
  throw new Error(`In-place rebuild did not finish in ${maxSteps} steps.`);
}

describe("in-place full reindex", () => {
  test("converges the live index to exactly the Turso set under a cap a copy would pass", async () => {
    const turso = vins("VIN", 620);
    const stale = vins("GONE", 250);
    const live = [...turso.slice(0, 300), ...stale];
    const setupResult = await setup({
      turso,
      live,
      limit: 900,
      browsePageSize: 100,
    });
    const { client, algolia } = setupResult;
    try {
      // A copy would need 550 + 620 records; in place peaks at 870.
      const listing = await algolia.client.listIndices({
        page: 0,
        hitsPerPage: 100,
      });
      expect(
        RecordCapacity.forCopy({
          listing: listing.items,
          exclude: [],
          vehicles: turso.length,
          limit: 900,
        }).kind,
      ).toBe("over_cap");

      const { result, stages } = await drive(setupResult);

      expect(result.status).toBe("complete");
      expect(
        stages.filter((stage) => stage === "full_reindex_inplace_load"),
      ).toHaveLength(1);
      expect(algolia.objectIDs(INDEX)).toEqual(turso);
      // Every record was rewritten from Turso, none left from before.
      const records = [...(algolia.indices.get(INDEX)?.records.values() ?? [])];
      expect(records.every((record) => record.stale === undefined)).toBe(true);
      expect(records.every((record) => record.make === "Honda")).toBe(true);
      // Settings and replicas stay as they were.
      expect(algolia.indices.get(INDEX)?.replicas).toEqual([
        "virtual(vehicles_year_desc)",
      ]);
      expect(algolia.indices.has("vehicles_year_desc")).toBe(true);
      expect(
        algolia.calls.filter((call) => call.startsWith("operationIndex")),
      ).toEqual([]);

      expect(await runRow(client)).toMatchObject({
        stage: "released",
        status: "success",
        activeSlot: null,
        fullReindexRequired: 0,
      });
      const inherited = await client.execute(
        "select full_reindex_required from ingestion_run where id = 'earlier'",
      );
      expect(Number(inherited.rows[0]?.full_reindex_required)).toBe(0);
      const changes = await client.execute(
        "select count(*) as pending from vehicle_change_v2 where processed_at is null",
      );
      expect(Number(changes.rows[0]?.pending)).toBe(0);
    } finally {
      client.close();
    }
  });

  test("sweeps again when deletions shift the browse cursor past stale records", async () => {
    const setupResult = await setup({
      turso: ["B", "D"],
      live: ["A", "B", "C", "D"],
      limit: 10,
      browsePageSize: 2,
      cursorMode: "shifting",
    });
    const { client, algolia } = setupResult;
    try {
      const { result } = await drive(setupResult);

      expect(result.status).toBe("complete");
      expect(algolia.objectIDs(INDEX)).toEqual(["B", "D"]);
      // The first pass skipped C; the recount started a second pass.
      expect(
        algolia.calls.filter((call) => call === `browse ${INDEX} start`),
      ).toHaveLength(4);
    } finally {
      client.close();
    }
  });

  test("resumes a sweep mid-pass without rereading earlier pages", async () => {
    const turso = vins("VIN", 120);
    const stale = vins("ZZZ", 30);
    const setupResult = await setup({
      turso,
      live: [...turso.slice(0, 50), ...stale],
      limit: 200,
      browsePageSize: 40,
      // Pages 1 to 3 hold only Turso VINs; page 4 holds stale ones.
      failOnce: { operation: "deleteObjects", call: 1 },
    });
    const { client, algolia } = setupResult;
    try {
      await drive(setupResult).catch((error: unknown) => {
        expect(String(error)).toContain("Internal error");
      });
      const failedAt = await runRow(client);
      expect(failedAt.stage).toBe("full_reindex_inplace_sweep");
      expect(failedAt.cursor).toBe(
        JSON.stringify({ pass: 1, browse: "VIN00119" }),
      );

      const { result } = await drive(setupResult);

      expect(result.status).toBe("complete");
      expect(algolia.objectIDs(INDEX)).toEqual(turso);
      const browses = algolia.calls.filter((call) => call.startsWith("browse"));
      // Three pages, the failed fourth, its retry, then the recount probe.
      expect(browses).toEqual([
        `browse ${INDEX} start`,
        `browse ${INDEX} VIN00039`,
        `browse ${INDEX} VIN00079`,
        `browse ${INDEX} VIN00119`,
        `browse ${INDEX} VIN00119`,
        `browse ${INDEX} start`,
      ]);
    } finally {
      client.close();
    }
  });

  test("resumes a load from its VIN cursor after a failed save", async () => {
    const turso = vins("VIN", 1_200);
    const setupResult = await setup({
      turso,
      live: turso.slice(0, 100),
      limit: 2_000,
      failOnce: { operation: "saveObjects", call: 2 },
    });
    const { client, algolia } = setupResult;
    try {
      await drive(setupResult).catch((error: unknown) => {
        expect(String(error)).toContain("Internal error");
      });
      expect(await runRow(client)).toMatchObject({
        stage: "full_reindex_inplace_load",
        cursor: "VIN00499",
      });

      const { result } = await drive(setupResult);

      expect(result.status).toBe("complete");
      expect(algolia.objectIDs(INDEX)).toEqual(turso);
      // Three batches, plus the one retried.
      expect(
        algolia.calls.filter((call) => call === `saveObjects ${INDEX}`),
      ).toHaveLength(4);
    } finally {
      client.close();
    }
  });

  test("deletes the run's own partial copy before loading, so its records are free", async () => {
    const turso = vins("VIN", 10);
    // 5 live records plus a 10-record copy left behind: the 5 new vehicles
    // fit under 16 only once the copy is gone.
    const setupResult = await setup({
      turso,
      live: turso.slice(0, 5),
      limit: 16,
    });
    const { client, algolia } = setupResult;
    try {
      algolia.seed(`${INDEX}__rebuild_${RUN}`, vins("COPY", 10));

      const { result } = await drive(setupResult);

      expect(result.status).toBe("complete");
      expect(algolia.indices.has(`${INDEX}__rebuild_${RUN}`)).toBe(false);
      expect(algolia.objectIDs(INDEX)).toEqual(turso);
    } finally {
      client.close();
    }
  });

  test("does not publish when the index ends with fewer records than vehicles", async () => {
    const turso = vins("VIN", 3);
    const setupResult = await setup({ turso, live: [], limit: 10 });
    const { client, algolia } = setupResult;
    // A vehicle whose save never lands.
    const context = {
      ...setupResult.context,
      project: async (rows: Array<typeof vehicle.$inferSelect>) =>
        rows.filter((row) => row.vin !== "VIN00001").map(mapDbVehicleToAlgolia),
    };
    try {
      const failure = await drive({ ...setupResult, context }).then(
        () => null,
        (error: unknown) => String(error),
      );

      expect(failure).toContain(
        "finished its sweep with 2 records in vehicles for 3 Turso vehicles",
      );
      expect(algolia.objectIDs(INDEX)).toEqual(["VIN00000", "VIN00002"]);
      expect(await runRow(client)).toMatchObject({
        stage: "full_reindex_inplace_sweep",
        status: "running",
        fullReindexRequired: 1,
      });
      const changes = await client.execute(
        "select count(*) as pending from vehicle_change_v2 where processed_at is null",
      );
      expect(Number(changes.rows[0]?.pending)).toBe(1);
    } finally {
      client.close();
    }
  });

  test("a step for a run that no longer holds the stage writes no cursor", async () => {
    const setupResult = await setup({
      turso: vins("VIN", 3),
      live: [],
      limit: 10,
    });
    const { client, context } = setupResult;
    try {
      await client.execute({
        sql: "update ingestion_run set status = 'abandoned', active_slot = null where id = ?",
        args: [RUN],
      });
      expect(
        await InPlaceRebuild.step(context, {
          stage: "full_reindex_inplace_load",
          fullReindexCursor: null,
        }),
      ).toEqual({ status: "stopped" });
      expect((await runRow(client)).cursor).toBeNull();
    } finally {
      client.close();
    }
  });
});

describe("RecordCapacity", () => {
  const listing = [
    { name: "vehicles", entries: 519_082, virtual: false },
    { name: "vehicles_year_desc", entries: 519_082, virtual: true },
    { name: "vehicles__rebuild_run", entries: 481_000, virtual: false },
  ];

  test("counts non-virtual indices, skips the copy, and keeps a margin", () => {
    expect(
      RecordCapacity.forCopy({
        listing,
        exclude: ["vehicles__rebuild_run"],
        vehicles: 519_152,
        limit: 1_000_000,
      }),
    ).toEqual({
      kind: "over_cap",
      entries: 519_082,
      vehicles: 519_152,
      needed: 1_038_234,
      limit: 1_000_000,
      usable: 980_000,
    });
    expect(
      RecordCapacity.forCopy({
        listing,
        exclude: ["vehicles__rebuild_run"],
        vehicles: 460_918,
        limit: 1_000_000,
      }).kind,
    ).toBe("fits");
    expect(
      RecordCapacity.forCopy({
        listing,
        exclude: ["vehicles__rebuild_run"],
        vehicles: 460_919,
        limit: 1_000_000,
      }).kind,
    ).toBe("over_cap");
  });

  test("routes only record quota refusals, not operation quotas", () => {
    expect(
      RecordCapacity.isRecordQuota(
        "Record quota exceeded, change plan or delete records.",
      ),
    ).toBe(true);
    expect(
      RecordCapacity.isRecordQuota("You have exceeded your Record quota"),
    ).toBe(true);
    expect(RecordCapacity.isRecordQuota("Operations quota exceeded")).toBe(
      false,
    );
  });

  test("describes an in-place shortfall with the live index, vehicles and other indices", () => {
    expect(
      RecordCapacity.describeInPlace({
        listing,
        indexName: "vehicles",
        vehicles: 519_152,
        limit: 1_000_000,
      }),
    ).toBe(
      "The live index vehicles holds 519082 records, Turso has 519152 vehicles, other indices hold 481000 (vehicles__rebuild_run: 481000), and the cap is 1000000.",
    );
  });

  test("reads ALGOLIA_RECORD_LIMIT, defaulting to the free plan's cap", () => {
    expect(RecordCapacity.limit(undefined)).toBe(1_000_000);
    expect(RecordCapacity.limit("")).toBe(1_000_000);
    expect(RecordCapacity.limit("10000000")).toBe(10_000_000);
    expect(() => RecordCapacity.limit("lots")).toThrow(
      "ALGOLIA_RECORD_LIMIT must be a positive integer",
    );
  });
});
