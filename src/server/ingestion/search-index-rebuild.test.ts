import { describe, expect, test } from "bun:test";
import { vehicle } from "~/schema";
import { SearchIndexGenerations } from "./search-index-generation";
import { SEARCH_RECORD_CAP } from "./search-index-rebuild";
import { SearchProjector } from "./search-projector";
import {
  INDEX,
  algoliaFailure,
  createProjectorDatabase,
  fakeWriter,
  insertRunWithChanges,
  projectedThrough,
  projectorContext,
  vehicleRow,
} from "./search-projector-test-fixtures";

const NOW = new Date("2026-11-20T12:00:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

async function setup(behavior?: Parameters<typeof fakeWriter>[0]) {
  const { client, database } = await createProjectorDatabase();
  const fake = fakeWriter(behavior);
  const clock = { now: NOW };
  const context = projectorContext({
    client,
    database,
    writer: fake.writer,
    clock,
  });
  return { client, database, clock, context, ...fake };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function generations(client: Setup["client"]) {
  return (
    await client.execute(
      "select id, status, reason, temp_index_name, snapshot_change_id, vin_cursor, records_loaded, temp_index_deleted_at is not null as temp_deleted from search_index_generation order by requested_at, id",
    )
  ).rows.map((row) => ({
    id: String(row.id),
    status: row.status,
    reason: row.reason,
    tempIndexName: row.temp_index_name,
    snapshotChangeId: row.snapshot_change_id,
    vinCursor: row.vin_cursor,
    recordsLoaded: row.records_loaded,
    tempDeleted: row.temp_deleted,
  }));
}

async function insertVehicles(database: Setup["database"], count: number) {
  const vins = Array.from(
    { length: count },
    (_, index) => `VIN${String(index).padStart(5, "0")}`,
  );
  for (let start = 0; start < vins.length; start += 500) {
    await database
      .insert(vehicle)
      .values(vins.slice(start, start + 500).map((vin) => vehicleRow(vin)));
  }
  return vins;
}

describe("search index rebuild", () => {
  test("bootstraps the index from Turso, resumes a failed load, moves it live and replays later changes", async () => {
    let failLoads = 0;
    const setupResult = await setup({
      save: (records) => {
        if (
          failLoads > 0 &&
          records.some((record) => record.objectID === "VIN01000")
        ) {
          failLoads -= 1;
          return algoliaFailure("Transient");
        }
        return null;
      },
      extraListings: [
        // A standard replica of the live index is never swept.
        {
          name: "vehicles_year_desc",
          entries: 0,
          primary: INDEX,
          replicas: [],
          virtual: false,
        },
      ],
    });
    const { client, database, clock, context, calls, indices } = setupResult;
    try {
      // The live index the inline era built, and leftovers of abandoned
      // inline rebuilds and of an older generation.
      indices.set(INDEX, {
        records: new Map(),
        generation: "inline-run",
        schemaVersion: 11,
      });
      for (const leftover of [
        "vehicles__rebuild_abandoned",
        "vehicles__generation_stale",
      ]) {
        indices.set(leftover, {
          records: new Map(),
          generation: null,
          schemaVersion: 0,
        });
      }
      const vins = await insertVehicles(database, 2_500);
      // Skipped-era changes, all covered by the rebuild's snapshot.
      const skipped = await insertRunWithChanges(
        client,
        {
          id: "skipped",
          status: "success",
          stage: "released",
          activeSlot: null,
          fullReindexRequired: true,
        },
        [
          ["VIN00001", "upsert"],
          ["VIN00002", "upsert"],
        ],
      );

      // No live generation: the first step requests the bootstrap rebuild.
      const requested = await SearchProjector.step(context);
      expect(requested).toMatchObject({
        status: "rebuild_requested",
        reason: "bootstrap",
      });
      const generationId =
        requested.status === "rebuild_requested" ? requested.generationId : "";
      const tempIndex = `vehicles__generation_${generationId}`;

      expect(await SearchProjector.step(context)).toEqual({
        status: "rebuild_prepared",
        generationId,
        snapshotChangeId: skipped[1] ?? -1,
        sweptIndices: 2,
      });
      expect(indices.has("vehicles__rebuild_abandoned")).toBe(false);
      expect(indices.has("vehicles__generation_stale")).toBe(false);
      expect(indices.get(tempIndex)?.generation).toBe(generationId);
      // Prepared from the live index's settings, with no records.
      expect(calls).toContainEqual({
        op: "prepare",
        from: INDEX,
        to: tempIndex,
        generation: generationId,
      });

      // A change committed while the copy loads, after the snapshot.
      await database.insert(vehicle).values(vehicleRow("ZZLATE"));
      const late = await insertRunWithChanges(
        client,
        { id: "late", status: "success", stage: "released", activeSlot: null },
        [["ZZLATE", "upsert"]],
      );

      // The second load batch fails: the step fails and the cursor stays.
      failLoads = 1;
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "failed",
        tag: "Transient",
      });
      expect((await generations(client))[0]).toMatchObject({
        status: "loading",
        vinCursor: "VIN00999",
        recordsLoaded: 1_000,
      });

      // After the backoff it resumes from the cursor, not from zero.
      calls.length = 0;
      clock.now = new Date(NOW.getTime() + 2 * MINUTE);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_loading",
        generationId,
        loaded: true,
      });
      const saved = calls.flatMap((call) =>
        call.op === "save" ? call.objectIDs : [],
      );
      expect(saved[0]).toBe("VIN01000");
      expect(indices.get(tempIndex)?.records.size).toBe(vins.length + 1);

      // The move replaces the live index and the cursor jumps to the
      // snapshot; the live index keeps its schema version.
      expect(await SearchProjector.step(context)).toEqual({
        status: "rebuild_live",
        generationId,
        snapshotChangeId: skipped[1] ?? -1,
      });
      expect(indices.has(tempIndex)).toBe(false);
      expect(indices.get(INDEX)).toMatchObject({
        generation: generationId,
        schemaVersion: 11,
      });
      expect(await projectedThrough(client)).toBe(skipped[1] ?? -1);

      // Replay starts after the snapshot, and the skipped runs are settled.
      calls.length = 0;
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
        projectedThrough: late[0] ?? -1,
        changes: 1,
      });
      expect(calls[0]).toEqual({
        op: "save",
        indexName: INDEX,
        objectIDs: ["ZZLATE"],
      });
      const flags = await client.execute(
        "select id, full_reindex_required from ingestion_run order by id",
      );
      expect(
        flags.rows.map((row) => [row.id, row.full_reindex_required]),
      ).toEqual([
        ["late", 0],
        ["skipped", 0],
      ]);
      expect((await generations(client))[0]).toMatchObject({
        status: "live",
        tempDeleted: 1,
      });
    } finally {
      client.close();
    }
  });

  test("waits instead of copying when the copy would pass the record cap", async () => {
    const { client, database, calls, context, indices } = await setup({
      extraListings: [
        {
          name: "vehicles_distance",
          entries: SEARCH_RECORD_CAP - 10,
          primary: null,
          replicas: [],
          virtual: false,
        },
      ],
    });
    try {
      indices.set(INDEX, {
        records: new Map(),
        generation: null,
        schemaVersion: 11,
      });
      await insertVehicles(database, 20);
      await SearchProjector.step(context);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "record_cap",
        entries: SEARCH_RECORD_CAP - 10,
        vehicles: 20,
        cap: SEARCH_RECORD_CAP,
        retryAt: new Date(NOW.getTime() + 15 * MINUTE).toISOString(),
      });
      expect(calls.map((call) => call.op)).not.toContain("prepare");
      expect((await generations(client))[0]).toMatchObject({
        status: "requested",
      });
      // It waits apart from the circuit, which stays closed.
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_waiting",
        reason: "record_cap",
        retryAt: new Date(NOW.getTime() + 15 * MINUTE).toISOString(),
      });
      const circuit = await client.execute(
        "select failure_count from ingestion_projector_checkpoint where name = 'search-projector'",
      );
      expect(circuit.rows[0]?.failure_count ?? 0).toBe(0);
    } finally {
      client.close();
    }
  });

  test("discards a generation whose copy vanished and requests another for the same reason", async () => {
    const { client, database, clock, context, indices } = await setup();
    try {
      indices.set(INDEX, {
        records: new Map(),
        generation: null,
        schemaVersion: 11,
      });
      await insertVehicles(database, 10);
      await SearchProjector.step(context);
      await SearchProjector.step(context);
      const [loading] = await generations(client);
      clock.now = new Date(NOW.getTime() + MINUTE);
      // Someone deleted the copy while it loaded.
      indices.delete(String(loading?.tempIndexName));
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_discarded",
        generationId: loading?.id,
      });
      const [discarded, retried] = await generations(client);
      expect(discarded).toMatchObject({ status: "discarded" });
      expect(retried).toMatchObject({
        status: "requested",
        reason: "bootstrap",
      });
      // The retry's prepare marks the old copy's cleanup done.
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_prepared",
        generationId: retried?.id,
      });
      expect((await generations(client))[0]).toMatchObject({
        status: "discarded",
        tempDeleted: 1,
      });
    } finally {
      client.close();
    }
  });

  test("never discards a moving generation whose move it cannot confirm", async () => {
    const { client, database, context, indices } = await setup();
    try {
      indices.set(INDEX, {
        records: new Map(),
        generation: null,
        schemaVersion: 11,
      });
      await insertVehicles(database, 10);
      await SearchProjector.step(context);
      await SearchProjector.step(context);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_loading",
        loaded: true,
      });
      const [moving] = await generations(client);
      // The copy disappears before the move, with no move task recorded.
      indices.delete(String(moving?.tempIndexName));
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "move_unconfirmed",
        generationId: moving?.id,
      });
      expect((await generations(client))[0]).toMatchObject({
        status: "moving",
      });
    } finally {
      client.close();
    }
  });

  test("a drift check requests at most one rebuild a week and pages when drift persists", async () => {
    const { client, database, clock, context, indices } = await setup();
    try {
      await insertVehicles(database, 1_000);
      // The live index lost records the projector never saw deleted.
      indices.set(INDEX, {
        records: new Map(),
        generation: "live-1",
        schemaVersion: 11,
      });
      await client.execute(
        "insert into search_index_generation (id, environment, index_name, status, reason, requested_at, live_at, updated_at) values ('live-1', 'production', 'vehicles', 'live', 'bootstrap', 0, 0, 0)",
      );
      const first = await SearchProjector.step(context);
      expect(first).toMatchObject({
        status: "drift_checked",
        entries: 0,
        vehicles: 1_000,
        drifted: true,
        consecutiveDrifts: 1,
      });
      const requested =
        first.status === "drift_checked" ? first.rebuildRequested : null;
      expect(requested).not.toBeNull();
      // Suppose that rebuild ran and went live, yet drift persists.
      await client.execute({
        sql: "update search_index_generation set status = 'superseded', ended_at = 0 where id = ?",
        args: [requested ?? ""],
      });
      clock.now = new Date(NOW.getTime() + DAY);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "drift_checked",
        drifted: true,
        consecutiveDrifts: 2,
        rebuildRequested: null,
      });
      // The same day's check runs once.
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "current",
      });
      clock.now = new Date(NOW.getTime() + 8 * DAY);
      const later = await SearchProjector.step(context);
      expect(later).toMatchObject({ drifted: true, consecutiveDrifts: 3 });
      expect(
        later.status === "drift_checked" ? later.rebuildRequested : null,
      ).not.toBeNull();
    } finally {
      client.close();
    }
  });
});

describe("search index rebuild edges", () => {
  async function liveSetup(behavior?: Parameters<typeof fakeWriter>[0]) {
    const setupResult = await setup(behavior);
    setupResult.indices.set(INDEX, {
      records: new Map(),
      generation: "live-1",
      schemaVersion: 11,
    });
    await setupResult.client.execute(
      "insert into search_index_generation (id, environment, index_name, status, reason, requested_at, live_at, updated_at) values ('live-1', 'production', 'vehicles', 'live', 'bootstrap', 0, 0, 0)",
    );
    return setupResult;
  }

  test("a rebuild held back by the record cap never stops the live index's updates", async () => {
    const { client, database, clock, context, calls } = await liveSetup({
      extraListings: [
        {
          name: "vehicles_distance",
          entries: SEARCH_RECORD_CAP,
          primary: null,
          replicas: [],
          virtual: false,
        },
      ],
    });
    try {
      await insertVehicles(database, 5);
      await SearchIndexGenerations.request(database, {
        environment: "production",
        indexName: INDEX,
        reason: "operator",
        now: NOW,
      });
      // Caught up: the requested rebuild is tried, and waits.
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "record_cap",
      });
      // A new arrival still reaches the live index.
      await database.insert(vehicle).values(vehicleRow("NEW"));
      const [id] = await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [["NEW", "upsert"]],
      );
      calls.length = 0;
      clock.now = new Date(NOW.getTime() + MINUTE);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
        projectedThrough: id ?? -1,
      });
      expect(calls[0]).toEqual({
        op: "save",
        indexName: INDEX,
        objectIDs: ["NEW"],
      });
      // Caught up again, it reports the wait without listing indices.
      calls.length = 0;
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_waiting",
        reason: "record_cap",
      });
      expect(calls).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("a copy Algolia refuses over quota is deleted and waits on the record cap instead of retrying", async () => {
    const { client, database, clock, context, calls, indices } =
      await liveSetup({
        fail: (op, indexName) =>
          op === "save" && indexName.startsWith(`${INDEX}__generation_`)
            ? algoliaFailure(
                "QuotaExceeded",
                "You have exceeded your Record quota",
                indexName,
              )
            : null,
      });
    try {
      await insertVehicles(database, 5);
      await SearchIndexGenerations.request(database, {
        environment: "production",
        indexName: INDEX,
        reason: "operator",
        now: NOW,
      });
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_prepared",
      });
      const loading = (await generations(client)).find(
        (generation) => generation.status === "loading",
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "record_cap",
        generationId: loading?.id,
        vehicles: 5,
        cap: SEARCH_RECORD_CAP,
        retryAt: new Date(NOW.getTime() + 15 * MINUTE).toISOString(),
      });
      // The copy's records are freed, and one rebuild stays requested.
      expect(
        [...indices.keys()].filter((name) => name.includes("__generation_")),
      ).toEqual([]);
      expect(
        (await generations(client))
          .map((generation) => String(generation.status))
          .sort(),
      ).toEqual(["discarded", "live", "requested"]);
      // The circuit stays closed and new arrivals reach the live index.
      await database.insert(vehicle).values(vehicleRow("NEW"));
      await insertRunWithChanges(
        client,
        { id: "run", status: "success", stage: "released", activeSlot: null },
        [["NEW", "upsert"]],
      );
      calls.length = 0;
      clock.now = new Date(NOW.getTime() + MINUTE);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "projected",
      });
      expect(calls[0]).toEqual({
        op: "save",
        indexName: INDEX,
        objectIDs: ["NEW"],
      });
    } finally {
      client.close();
    }
  });

  test("waits for a live index to copy settings from instead of building one with defaults", async () => {
    const { client, database, calls, context, indices } = await setup();
    try {
      await insertVehicles(database, 5);
      await SearchProjector.step(context);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "missing_live_index",
      });
      expect([...indices.keys()]).toEqual([]);
      expect(calls.map((call) => call.op)).not.toContain("save");
      expect((await generations(client))[0]).toMatchObject({
        status: "requested",
      });
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_waiting",
        reason: "missing_live_index",
      });
    } finally {
      client.close();
    }
  });

  test("skips the drift check while a run is still reconciling", async () => {
    const { client, database, context } = await liveSetup();
    try {
      // Vehicles committed by a run that is still reconciling: the index
      // cannot have them yet.
      await insertVehicles(database, 500);
      await insertRunWithChanges(
        client,
        {
          id: "reconciling",
          status: "running",
          stage: "reconcile_upsert",
          activeSlot: 1,
        },
        [["VIN00000", "upsert"]],
      );
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "current",
      });
      const drift = await client.execute(
        "select count(*) as n from ingestion_projector_checkpoint where name = 'search-projector:drift'",
      );
      expect(drift.rows[0]?.n).toBe(0);
    } finally {
      client.close();
    }
  });

  test("sweeps leftovers but never a replica, a virtual replica or the generation's own copy", async () => {
    const { client, database, context, calls, indices } = await setup({
      extraListings: [
        {
          name: "vehicles__generation_sorted",
          entries: 0,
          primary: INDEX,
          replicas: [],
          virtual: false,
        },
        {
          name: INDEX,
          entries: 0,
          primary: null,
          replicas: ["virtual(vehicles__rebuild_v)"],
          virtual: false,
        },
        {
          name: "vehicles__rebuild_v",
          entries: SEARCH_RECORD_CAP,
          primary: null,
          replicas: [],
          virtual: true,
        },
      ],
    });
    try {
      indices.set("vehicles__rebuild_gone", {
        records: new Map(),
        generation: null,
        schemaVersion: 0,
      });
      await insertVehicles(database, 5);
      const requested = await SearchProjector.step(context);
      const generationId =
        requested.status === "rebuild_requested" ? requested.generationId : "";
      // An earlier prepare attempt left this generation's own copy.
      indices.set(`vehicles__generation_${generationId}`, {
        records: new Map(),
        generation: generationId,
        schemaVersion: 0,
      });
      indices.set(INDEX, {
        records: new Map(),
        generation: null,
        schemaVersion: 11,
      });
      // The virtual replica's entries do not count toward the cap.
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_prepared",
        sweptIndices: 1,
      });
      expect(
        calls.flatMap((call) =>
          call.op === "deleteIndex" ? [call.indexName] : [],
        ),
      ).toEqual(["vehicles__rebuild_gone"]);
    } finally {
      client.close();
    }
  });

  test("discards a load that aged out or whose copy carries another generation", async () => {
    for (const cause of ["age", "marker"] as const) {
      const { client, database, clock, context, indices } = await liveSetup();
      try {
        await insertVehicles(database, 5);
        await SearchIndexGenerations.request(database, {
          environment: "production",
          indexName: INDEX,
          reason: "operator",
          now: NOW,
        });
        await SearchProjector.step(context);
        const [, loading] = await generations(client);
        expect(loading).toMatchObject({ status: "loading" });
        if (cause === "age") {
          clock.now = new Date(NOW.getTime() + DAY + MINUTE);
        } else {
          clock.now = new Date(NOW.getTime() + MINUTE);
          const copy = indices.get(String(loading?.tempIndexName));
          if (copy) copy.generation = "someone-else";
        }
        expect(await SearchProjector.step(context)).toMatchObject({
          status: "rebuild_discarded",
          reason:
            cause === "age"
              ? "still loading after 24 hours"
              : expect.stringContaining("carries generation someone-else"),
        });
        expect((await generations(client)).at(-1)).toMatchObject({
          status: "requested",
          reason: "operator",
        });
      } finally {
        client.close();
      }
    }
  });

  test("dead-letters vehicles the backend rejects while loading", async () => {
    const { client, database, context } = await liveSetup({
      save: (records) =>
        records.some((record) => record.objectID === "VIN00003")
          ? algoliaFailure("InvalidRequest", "Record is too big")
          : null,
    });
    try {
      await insertVehicles(database, 5);
      await SearchIndexGenerations.request(database, {
        environment: "production",
        indexName: INDEX,
        reason: "operator",
        now: NOW,
      });
      const prepared = await SearchProjector.step(context);
      expect(prepared).toMatchObject({ status: "rebuild_prepared" });
      const snapshot =
        prepared.status === "rebuild_prepared" ? prepared.snapshotChangeId : -1;
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_loading",
        recordsLoaded: 4,
        deadLettered: 1,
        loaded: true,
      });
      const [, loaded] = await generations(client);
      expect(loaded).toMatchObject({ status: "moving", recordsLoaded: 4 });
      const letters = await client.execute(
        "select change_id, vin, index_name, error_tag from search_dead_letter",
      );
      expect(
        letters.rows.map((row) => [
          row.change_id,
          row.vin,
          row.index_name,
          row.error_tag,
        ]),
      ).toEqual([
        [snapshot, "VIN00003", loaded?.tempIndexName, "InvalidRequest"],
      ]);
    } finally {
      client.close();
    }
  });

  test("a move already issued is waited for, verified and made live", async () => {
    const waits: { onWait: (() => void) | null } = { onWait: null };
    const { client, database, context, calls, indices } = await liveSetup({
      onWait: () => waits.onWait?.(),
    });
    try {
      await insertVehicles(database, 5);
      await SearchIndexGenerations.request(database, {
        environment: "production",
        indexName: INDEX,
        reason: "operator",
        now: NOW,
      });
      await SearchProjector.step(context);
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_loading",
        loaded: true,
      });
      const [, moving] = await generations(client);
      // The move landed, but the step died before recording its task.
      const copy = indices.get(String(moving?.tempIndexName));
      if (copy) indices.set(INDEX, copy);
      indices.delete(String(moving?.tempIndexName));
      calls.length = 0;
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_live",
        generationId: moving?.id,
      });
      expect(calls.map((call) => call.op)).not.toContain("move");

      // A recorded move task is waited for before the marker is checked.
      await SearchIndexGenerations.request(database, {
        environment: "production",
        indexName: INDEX,
        reason: "operator",
        now: new Date(NOW.getTime() + MINUTE),
      });
      // Replays changes and checks drift first, then prepares and loads.
      while ((await generations(client)).at(-1)?.status !== "moving") {
        await SearchProjector.step(context);
      }
      const second = (await generations(client)).at(-1);
      expect(second).toMatchObject({ status: "moving" });
      await client.execute({
        sql: "update search_index_generation set move_task_id = 77 where id = ?",
        args: [second?.id ?? ""],
      });
      // The recorded move lands while the step waits for its task.
      waits.onWait = () => {
        const secondCopy = indices.get(String(second?.tempIndexName));
        if (secondCopy) indices.set(INDEX, secondCopy);
        indices.delete(String(second?.tempIndexName));
      };
      calls.length = 0;
      expect(await SearchProjector.step(context)).toMatchObject({
        status: "rebuild_live",
        generationId: second?.id,
      });
      expect(calls.map((call) => call.op)).toEqual([
        "metadata",
        "wait",
        "metadata",
      ]);
    } finally {
      client.close();
    }
  });
});

describe("search index generations", () => {
  test("one generation in flight and one live, and only for the environment that owns the database", async () => {
    const { client, database } = await createProjectorDatabase();
    try {
      const request = (environment: string) =>
        SearchIndexGenerations.request(database, {
          environment,
          indexName: INDEX,
          reason: "operator",
          now: NOW,
        });
      expect(await request("production")).toMatchObject({
        status: "requested",
      });
      expect(await request("production")).toEqual({ status: "in_flight" });
      // A preview pointed at this database must not stop production.
      expect(await request("preview")).toEqual({
        status: "foreign",
        environment: "production",
      });
      await client.execute(
        "insert into search_index_generation (id, environment, index_name, status, reason, requested_at, live_at, updated_at) values ('live-1', 'production', 'vehicles', 'live', 'bootstrap', 0, 0, 0)",
      );
      await expect(
        client.execute(
          "insert into search_index_generation (id, environment, index_name, status, reason, requested_at, live_at, updated_at) values ('live-2', 'production', 'vehicles', 'live', 'bootstrap', 0, 0, 0)",
        ),
      ).rejects.toThrow();
    } finally {
      client.close();
    }
  });

  test("refuses to act on a malformed generation row", async () => {
    const { client, database } = await createProjectorDatabase();
    try {
      await client.execute(
        "insert into search_index_generation (id, environment, index_name, status, reason, requested_at, updated_at) values ('broken', 'production', 'vehicles', 'loading', 'bootstrap', 0, 0)",
      );
      await expect(
        SearchIndexGenerations.forEnvironment(database, "production"),
      ).rejects.toThrow("is loading without temp_index_name");
    } finally {
      client.close();
    }
  });
});
