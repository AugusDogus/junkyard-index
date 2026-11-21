import { describe, expect, test } from "bun:test";
import { vehicle } from "~/schema";
import { InvalidRequest } from "./algolia-error";
import { SearchProjector } from "./search-projector";
import {
  INDEX,
  algoliaFailure,
  createProjectorDatabase,
  fakeWriter,
  insertLiveGeneration,
  insertRunWithChanges,
  projectedThrough,
  projectorContext,
  vehicleRow,
} from "./search-projector-test-fixtures";

const NOW = new Date("2026-11-20T12:00:00Z");

/** A 403 that refuses the operation for this key, whatever the records. */
function refusedKey() {
  return new InvalidRequest({
    operation: "saveObjects",
    indexName: INDEX,
    status: 403,
    detail: "Method not allowed with this API key",
    message: "Algolia saveObjects failed (InvalidRequest, HTTP 403)",
    cause: null,
  });
}
const MINUTE = 60_000;

async function setup(writerBehavior?: Parameters<typeof fakeWriter>[0]) {
  const { client, database } = await createProjectorDatabase();
  const { writer, calls } = fakeWriter(writerBehavior);
  const clock = { now: NOW };
  const context = projectorContext({ client, database, writer, clock });
  return { client, database, calls, clock, context };
}

async function runRows(client: Awaited<ReturnType<typeof setup>>["client"]) {
  return (
    await client.execute(
      "select id, status, stage, active_slot, full_reindex_required, last_progress_at from ingestion_run order by id",
    )
  ).rows.map((row) => ({ ...row }));
}

describe("search projector", () => {
  test("projects published changes up to the horizon and leaves a reconciling run's changes", async () => {
    const { client, database, calls, context } = await setup();
    try {
      await insertLiveGeneration(client);
      await database
        .insert(vehicle)
        .values([vehicleRow("VIN1"), vehicleRow("VIN2"), vehicleRow("VIN4")]);
      const published = await insertRunWithChanges(
        client,
        {
          id: "published",
          status: "success",
          stage: "released",
          activeSlot: null,
        },
        [
          ["VIN1", "upsert"],
          ["VIN2", "missing"],
          ["VIN3", "delete"],
        ],
      );
      // Still reconciling: its changes are past the horizon.
      await insertRunWithChanges(
        client,
        {
          id: "reconciling",
          status: "running",
          stage: "reconcile_missing",
          activeSlot: 1,
        },
        [["VIN4", "upsert"]],
      );

      expect(await SearchProjector.step(context)).toEqual({
        status: "projected",
        from: 0,
        projectedThrough: published[2] ?? -1,
        horizon: published[2] ?? -1,
        changes: 3,
        upserted: 2,
        deleted: 1,
        deadLettered: 0,
        caughtUp: true,
      });
      expect(calls).toEqual([
        { op: "save", indexName: INDEX, objectIDs: ["VIN1", "VIN2"] },
        { op: "delete", indexName: INDEX, objectIDs: ["VIN3"] },
        { op: "wait", indexName: INDEX, taskId: 2 },
      ]);
      expect(await projectedThrough(client)).toBe(published[2] ?? -1);

      // The run releases; the next step publishes its change.
      await client.execute(
        "update ingestion_run set status = 'success', stage = 'released', active_slot = null where id = 'reconciling'",
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
        changes: 1,
        upserted: 1,
        caughtUp: true,
      });
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "current",
      });
    } finally {
      client.close();
    }
  });

  test("projects each vehicle's latest change and deletes a vehicle whose row is gone", async () => {
    const { client, database, calls, context } = await setup();
    try {
      await insertLiveGeneration(client);
      await database.insert(vehicle).values(vehicleRow("RELISTED"));
      await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [
          ["RELISTED", "delete"],
          ["GONE", "upsert"],
          ["RELISTED", "upsert"],
          ["GONE", "missing"],
        ],
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
        changes: 4,
        upserted: 1,
        deleted: 1,
      });
      expect(calls.slice(0, 2)).toEqual([
        { op: "save", indexName: INDEX, objectIDs: ["RELISTED"] },
        { op: "delete", indexName: INDEX, objectIDs: ["GONE"] },
      ]);
    } finally {
      client.close();
    }
  });

  test("opens its circuit on a blocked backend without touching ingestion runs, then probes before writing again", async () => {
    let blocked = true;
    let probeBlocked = true;
    const { client, database, calls, clock, context } = await setup({
      save: () => (blocked ? algoliaFailure("SearchBackendBlocked") : null),
      metadata: () =>
        probeBlocked
          ? algoliaFailure("SearchBackendBlocked")
          : { generation: "live-1", schemaVersion: 11 },
    });
    try {
      await insertLiveGeneration(client);
      await database.insert(vehicle).values(vehicleRow("VIN1"));
      await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [["VIN1", "upsert"]],
      );
      const runsBefore = await runRows(client);

      expect(await SearchProjector.step(context)).toMatchObject({
        status: "failed",
        tag: "SearchBackendBlocked",
        failureCount: 1,
        opened: true,
        retryAt: new Date(NOW.getTime() + 15 * MINUTE).toISOString(),
      });
      expect(await projectedThrough(client)).toBe(0);
      expect(await runRows(client)).toEqual(runsBefore);

      // Open: nothing is sent until the retry time.
      calls.length = 0;
      clock.now = new Date(NOW.getTime() + 10 * MINUTE);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "circuit_open",
        tag: "SearchBackendBlocked",
      });
      expect(calls).toEqual([]);

      // Half-open: a failed probe keeps it open, backing off longer.
      clock.now = new Date(NOW.getTime() + 16 * MINUTE);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "failed",
        failureCount: 2,
        opened: false,
        retryAt: new Date(NOW.getTime() + 46 * MINUTE).toISOString(),
      });
      expect(calls).toEqual([{ op: "metadata", indexName: INDEX }]);

      // The block lifts: the probe passes and the change is written.
      blocked = false;
      probeBlocked = false;
      calls.length = 0;
      clock.now = new Date(NOW.getTime() + 47 * MINUTE);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
        changes: 1,
      });
      expect(calls.map((call) => call.op)).toEqual([
        "metadata",
        "save",
        "delete",
        "wait",
      ]);
      expect(await runRows(client)).toEqual(runsBefore);
      const checkpoint = await client.execute(
        "select failure_count, last_error_tag, blocked_until from ingestion_projector_checkpoint",
      );
      expect({ ...checkpoint.rows[0] }).toEqual({
        failure_count: 0,
        last_error_tag: null,
        blocked_until: null,
      });
    } finally {
      client.close();
    }
  });

  test("backs off briefly after a transient failure and retries without a probe", async () => {
    let failing = true;
    const { client, database, calls, clock, context } = await setup({
      save: () => (failing ? algoliaFailure("Transient") : null),
    });
    try {
      await insertLiveGeneration(client);
      await database.insert(vehicle).values(vehicleRow("VIN1"));
      await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [["VIN1", "upsert"]],
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "failed",
        tag: "Transient",
        retryAt: new Date(NOW.getTime() + MINUTE).toISOString(),
      });
      failing = false;
      calls.length = 0;
      clock.now = new Date(NOW.getTime() + 2 * MINUTE);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
      });
      expect(calls.map((call) => call.op)).not.toContain("metadata");
    } finally {
      client.close();
    }
  });

  test("dead-letters the records the backend rejects and projects the rest", async () => {
    const { client, database, calls, context } = await setup({
      save: (records) =>
        records.some((record) => record.objectID === "BAD")
          ? algoliaFailure("InvalidRequest", "Record is too big")
          : null,
    });
    try {
      await insertLiveGeneration(client);
      await database
        .insert(vehicle)
        .values([vehicleRow("BAD"), vehicleRow("GOOD1"), vehicleRow("GOOD2")]);
      const ids = await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [
          ["GOOD1", "upsert"],
          ["BAD", "upsert"],
          ["GOOD2", "upsert"],
        ],
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
        changes: 3,
        upserted: 2,
        deadLettered: 1,
      });
      const saved = calls
        .filter((call) => call.op === "save")
        .flatMap((call) => (call.op === "save" ? call.objectIDs : []));
      expect(saved).toContain("GOOD1");
      expect(saved).toContain("GOOD2");
      const letters = await client.execute(
        "select change_id, vin, environment, index_name, error_tag, detail from search_dead_letter",
      );
      expect(
        letters.rows.map((row) => ({
          change_id: row.change_id,
          vin: row.vin,
          environment: row.environment,
          index_name: row.index_name,
          error_tag: row.error_tag,
          detail: row.detail,
        })),
      ).toEqual([
        {
          change_id: ids[1] ?? -1,
          vin: "BAD",
          environment: "production",
          index_name: INDEX,
          error_tag: "InvalidRequest",
          detail:
            "Algolia saveObjects failed (InvalidRequest): Record is too big",
        },
      ]);
      expect(await projectedThrough(client)).toBe(ids[2] ?? -1);
    } finally {
      client.close();
    }
  });

  test("a vehicle its projection rejects stops the step without moving the cursor", async () => {
    const { client, database, calls, context } = await setup();
    try {
      await insertLiveGeneration(client);
      await database
        .insert(vehicle)
        .values([
          vehicleRow("UNKNOWN", { source: "retired-feed" }),
          vehicleRow("OK"),
        ]);
      await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [
          ["UNKNOWN", "upsert"],
          ["OK", "upsert"],
        ],
      );
      await expect(SearchProjector.step(context)).rejects.toThrow(
        "unsupported ingestion source",
      );
      expect(await projectedThrough(client)).toBe(0);
      expect(calls).toEqual([]);
      const letters = await client.execute(
        "select count(*) as n from search_dead_letter",
      );
      expect(letters.rows[0]?.n).toBe(0);
    } finally {
      client.close();
    }
  });

  test("fails the batch when the backend refuses the key, however few records it holds", async () => {
    const { client, database, calls, context } = await setup({
      save: () => refusedKey(),
    });
    try {
      await insertLiveGeneration(client);
      await database.insert(vehicle).values(vehicleRow("VIN1"));
      await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [["VIN1", "upsert"]],
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "failed",
        tag: "InvalidRequest",
        retryAt: new Date(NOW.getTime() + 15 * MINUTE).toISOString(),
      });
      // One request: a refused key is not bisected into dead letters.
      expect(calls.filter((call) => call.op === "save")).toHaveLength(1);
      expect(await projectedThrough(client)).toBe(0);
      const letters = await client.execute(
        "select count(*) as n from search_dead_letter",
      );
      expect(letters.rows[0]?.n).toBe(0);
    } finally {
      client.close();
    }
  });

  test("dead-letters every record the backend rejects, however many, and keeps the rest", async () => {
    const { client, database, context } = await setup({
      save: (records) =>
        records.some((record) => record.objectID.startsWith("BIG"))
          ? algoliaFailure("InvalidRequest", "Record is too big")
          : null,
    });
    try {
      await insertLiveGeneration(client);
      const big = Array.from({ length: 30 }, (_, index) => `BIG${index}`);
      await database
        .insert(vehicle)
        .values([...big, "SMALL"].map((vin) => vehicleRow(vin)));
      const ids = await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [...big, "SMALL"].map((vin) => [vin, "upsert"] as const),
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
        upserted: 1,
        deadLettered: 30,
      });
      expect(await projectedThrough(client)).toBe(ids.at(-1) ?? -1);
    } finally {
      client.close();
    }
  });

  test("a passing probe does not reset the backoff until a write lands", async () => {
    const { client, database, clock, context } = await setup({
      save: () => algoliaFailure("QuotaExceeded"),
      metadata: () => ({ generation: "live-1", schemaVersion: 11 }),
    });
    try {
      await insertLiveGeneration(client);
      await database.insert(vehicle).values(vehicleRow("VIN1"));
      await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [["VIN1", "upsert"]],
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        failureCount: 1,
        opened: true,
        retryAt: new Date(NOW.getTime() + 15 * MINUTE).toISOString(),
      });
      clock.now = new Date(NOW.getTime() + 16 * MINUTE);
      // Reads pass, writes stay refused: the backoff keeps doubling.
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "failed",
        failureCount: 2,
        opened: false,
        retryAt: new Date(NOW.getTime() + 46 * MINUTE).toISOString(),
      });
    } finally {
      client.close();
    }
  });

  test("writes nothing while a run still publishes search inline", async () => {
    const { client, calls, context } = await setup();
    try {
      await insertLiveGeneration(client);
      await insertRunWithChanges(
        client,
        {
          id: "inline",
          status: "running",
          stage: "full_reindex_move_pending",
          activeSlot: 1,
        },
        [["VIN1", "upsert"]],
      );
      expect(await SearchProjector.step(context)).toEqual({
        status: "inline_writer_active",
        runIds: ["inline"],
      });
      expect(calls).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("needs a live generation of its own environment", async () => {
    const { client, calls, context } = await setup();
    try {
      expect(await SearchProjector.step(context)).toEqual({
        status: "rebuild_required",
      });
      await insertLiveGeneration(client, "preview");
      expect(await SearchProjector.step(context)).toEqual({
        status: "environment_mismatch",
        generationEnvironment: "preview",
      });
      expect(calls).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("moves past changes deleted below the horizon", async () => {
    const { client, calls, context } = await setup();
    try {
      await insertLiveGeneration(client);
      const deleted = await insertRunWithChanges(
        client,
        {
          id: "inline",
          status: "success",
          stage: "released",
          activeSlot: null,
        },
        [
          ["VIN1", "upsert"],
          ["VIN2", "upsert"],
        ],
      );
      // An inline publication projected and deleted its changes; a later run
      // is still reconciling, so the horizon stays just below its first.
      await client.execute("delete from vehicle_change_v2");
      await insertRunWithChanges(
        client,
        {
          id: "reconciling",
          status: "running",
          stage: "reconcile_upsert",
          activeSlot: 1,
        },
        [["VIN3", "upsert"]],
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
        projectedThrough: deleted[1] ?? -1,
        changes: 0,
        caughtUp: true,
      });
      expect(calls).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("stops when another projector advanced the checkpoint first", async () => {
    const { client, database, context } = await setup();
    try {
      await insertLiveGeneration(client);
      await database.insert(vehicle).values(vehicleRow("VIN1"));
      const [id] = await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [["VIN1", "upsert"]],
      );
      const racing = {
        ...context,
        project: async (rows: Parameters<typeof context.project>[0]) => {
          await client.execute({
            sql: "update ingestion_projector_checkpoint set last_processed_change_id = ?",
            args: [id ?? -1],
          });
          return context.project(rows);
        },
      };
      expect(await SearchProjector.step(racing)).toEqual({ status: "stopped" });
    } finally {
      client.close();
    }
  });

  test("reports when it is due without calling the backend", async () => {
    const { client, database, calls, context } = await setup({
      save: () => algoliaFailure("Transient"),
    });
    try {
      const due = () =>
        SearchProjector.due(database, "production", context.now());
      expect(await due()).toEqual({ status: "rebuild_required" });
      await insertLiveGeneration(client);
      expect(await due()).toEqual({
        status: "current",
        projectedThrough: 0,
        horizon: 0,
      });
      await database.insert(vehicle).values(vehicleRow("VIN1"));
      const [id] = await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [["VIN1", "upsert"]],
      );
      expect(await due()).toEqual({
        status: "due",
        projectedThrough: 0,
        horizon: id ?? -1,
        probe: false,
      });
      await SearchProjector.step(context);
      expect(await due()).toMatchObject({
        status: "circuit_open",
        tag: "Transient",
      });
      expect(calls.filter((call) => call.op === "metadata")).toEqual([]);
    } finally {
      client.close();
    }
  });
});
