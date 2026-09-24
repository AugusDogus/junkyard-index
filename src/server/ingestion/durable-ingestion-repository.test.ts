import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import type { FetchedDurableSourceChunk } from "./durable-ingestion-types";
import type { DurableSourceCursor } from "./durable-source";
import type { PypStoreCursor } from "./durable-cursor";
import type { Yard } from "~/lib/yard";
import {
  createTestClient,
  TEST_SCHEMA,
  makeVehicle,
} from "./durable-ingestion-test-fixtures";

const initialPypCursor: PypStoreCursor = {
  source: "pyp",
  storeCodes: null,
  storeIndex: 0,
  page: 0,
};

function pypCursorFromBoundary(page = 1): PypStoreCursor {
  return {
    source: "pyp",
    storeCodes: Array.from({ length: 20 }, (_, index) => String(1200 + index)),
    storeIndex: 0,
    page,
  };
}

function pypCursorAtSourceBoundary(): DurableSourceCursor {
  return pypCursorFromBoundary();
}

function mismatchedFetchFromBoundary(
  fetched: FetchedDurableSourceChunk<"pyp">,
): FetchedDurableSourceChunk {
  return {
    ...fetched,
    cursor: {
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    },
  };
}

describe("durable ingestion repository", () => {
  test("checkpoints presence evidence atomically, ignores stale replays, and cleans up only released runs", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
      );
      await repository.initialize("run-observed");
      const fetched: FetchedDurableSourceChunk<"pullnsave"> = {
        cursor: { source: "pullnsave", page: 2 },
        status: "paused",
        pagesProcessed: 1,
        vehiclesProcessed: 0,
        uniqueVehicles: 0,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles: [],
        yards: [],
        observedVins: ["vin-present", "VIN-PRESENT"],
      };
      const checkpoint = {
        runId: "run-observed",
        requestedCursor: { source: "pullnsave", page: 1 } as const,
        fetched,
      };
      await repository.checkpointChunk(checkpoint);
      await repository.checkpointChunk({
        ...checkpoint,
        fetched: { ...fetched, observedVins: ["VIN-STALE-REPLAY"] },
      });
      expect(
        (await client.execute("select vin from vehicle_observation")).rows.map(
          (row) => row.vin,
        ),
      ).toEqual(["VIN-PRESENT"]);
      await repository.cleanupStaleSnapshots();
      await repository.cleanupBatch("run-observed");
      expect(
        (
          await client.execute(
            "select count(*) as count from vehicle_observation",
          )
        ).rows[0]?.count,
      ).toBe(1);

      await expect(
        repository.checkpointChunk({
          runId: "run-observed",
          requestedCursor: fetched.cursor,
          fetched: {
            ...fetched,
            cursor: { source: "pullnsave", page: 3 },
            observedVins: [""],
          },
        }),
      ).rejects.toThrow("invalid observed VIN");
      await client.execute(
        "update ingestion_run set active_slot = null, status = 'success' where id = 'run-observed'",
      );
      await repository.cleanupBatch("run-observed");
      expect(
        (
          await client.execute(
            "select count(*) as count from vehicle_observation",
          )
        ).rows[0]?.count,
      ).toBe(0);
    } finally {
      testDatabase.cleanup();
    }
  });
  test("makes the first v2 ingestion a full reindex without mutating legacy runs", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      await client.execute(`
        insert into ingestion_run (
          id, source, status, stage, started_at, last_progress_at, completed_at
        ) values (
          'legacy-success', 'all', 'success', 'sources', 1000, 0, 2000
        )
      `);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
      );

      const wakeup = await repository.prepareWakeup(
        new Date("2026-08-22T07:00:00.000Z"),
      );
      expect(wakeup.status).toBe("start");
      if (wakeup.status !== "start") throw new Error("Expected a new run");
      expect((await repository.getRun(wakeup.runId)).fullReindexRequired).toBe(
        true,
      );

      const legacyRun = await client.execute(
        `select status, stage, full_reindex_required, started_at,
                last_progress_at, completed_at, publication_sequence
         from ingestion_run where id = 'legacy-success'`,
      );
      expect(legacyRun.rows[0]).toMatchObject({
        status: "success",
        stage: "sources",
        full_reindex_required: 0,
        started_at: 1000,
        last_progress_at: 0,
        completed_at: 2000,
        publication_sequence: null,
      });
    } finally {
      testDatabase.cleanup();
    }
  });

  test("checkpoints once on replay and preserves a failed execution for resumption", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
      );

      expect(await repository.initialize("run-1")).toEqual({
        status: "started",
        runId: "run-1",
      });
      expect(await repository.initialize("run-1")).toEqual({
        status: "started",
        runId: "run-1",
      });
      expect(
        await repository.getCheckpoint({
          runId: "run-1",
          requestedCursor: initialPypCursor,
        }),
      ).toBeNull();

      const fetched = {
        cursor: pypCursorFromBoundary(),
        status: "paused" as const,
        pagesProcessed: 1,
        vehiclesProcessed: 1,
        uniqueVehicles: 1,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles: [makeVehicle()],
        yards: [],
      };
      const first = await repository.checkpointChunk({
        runId: "run-1",
        requestedCursor: initialPypCursor,
        fetched,
      });
      const replay = await repository.checkpointChunk({
        runId: "run-1",
        requestedCursor: initialPypCursor,
        fetched,
      });
      expect(first.count).toBe(1);
      expect(replay.count).toBe(1);
      expect(replay.pagesProcessed).toBe(1);

      await expect(
        repository.checkpointChunk({
          runId: "run-1",
          requestedCursor: pypCursorAtSourceBoundary(),
          fetched: mismatchedFetchFromBoundary(fetched),
        }),
      ).rejects.toThrow("Cannot checkpoint row52 cursor for pyp source run");

      await repository.markRunFailed("run-1", "reconciliation failed");
      const sourceRuns = await repository.getSourceRuns("run-1");
      expect(sourceRuns.every((row) => row.status === "running")).toBe(true);
      const run = await repository.getRun("run-1");
      expect(run.status).toBe("running");
      expect(run.executionErrors).toContain("reconciliation failed");

      const snapshots = await client.execute(
        "select count(*) as count from vehicle_snapshot",
      );
      expect(snapshots.rows[0]?.count).toBe(1);
    } finally {
      testDatabase.cleanup();
    }
  });

  test("commits exactly one attempt when two checkpoints race", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
      );
      await repository.initialize("run-race");

      const checkpoint = (vin: string) =>
        repository.checkpointChunk({
          runId: "run-race",
          requestedCursor: initialPypCursor,
          fetched: {
            cursor: pypCursorFromBoundary(),
            status: "paused",
            pagesProcessed: 1,
            vehiclesProcessed: 1,
            uniqueVehicles: 1,
            duplicateVehicles: 0,
            rejectedVehicles: 0,
            errors: [],
            vehicles: [makeVehicle(vin)],
            yards: [{ ...testYard, name: vin }],
          },
        });

      const [first, second] = await Promise.all([
        checkpoint("VIN-RACE-A"),
        checkpoint("VIN-RACE-B"),
      ]);
      expect(first.count).toBe(1);
      expect(second.count).toBe(1);
      expect(first.pagesProcessed).toBe(1);
      expect(second.pagesProcessed).toBe(1);

      const snapshots = await client.execute(
        "select vin from vehicle_snapshot where run_id = 'run-race'",
      );
      expect(snapshots.rows).toHaveLength(1);
      const snapshotVin = snapshots.rows[0]?.vin;
      expect(typeof snapshotVin).toBe("string");
      if (typeof snapshotVin !== "string") {
        throw new Error("Expected one snapshot VIN after checkpoint race");
      }
      expect(["VIN-RACE-A", "VIN-RACE-B"]).toContain(snapshotVin);
      const yards = await client.execute("select name from yard");
      expect(yards.rows.map((yard) => yard.name)).toEqual([snapshotVin]);
    } finally {
      testDatabase.cleanup();
    }
  });

  test("resumes orphaned runs and requires forced repair after reconciliation starts", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
      );
      const first = await repository.prepareWakeup(
        new Date("2026-08-22T07:00:00.000Z"),
      );
      expect(first.status).toBe("start");
      if (first.status !== "start") throw new Error("Expected a new run");
      expect(
        await repository.prepareWakeup(new Date("2026-08-22T08:00:00.000Z")),
      ).toEqual({ status: "resume", runId: first.runId });

      await client.execute({
        sql: "update ingestion_run set stage = 'reconcile_missing' where id = ?",
        args: [first.runId],
      });
      await expect(repository.abandon(first.runId, false)).rejects.toThrow(
        "force is required",
      );
      await repository.abandon(first.runId, true);
      const abandoned = await repository.getRun(first.runId);
      expect(abandoned.status).toBe("abandoned");
      expect(abandoned.fullReindexRequired).toBe(true);

      const repair = await repository.prepareWakeup(
        new Date("2026-08-22T09:00:00.000Z"),
      );
      expect(repair.status).toBe("start");
      if (repair.status !== "start") throw new Error("Expected a repair run");
      expect((await repository.getRun(repair.runId)).fullReindexRequired).toBe(
        true,
      );
      await client.execute({
        sql: "update ingestion_run set stage = 'full_reindex_move_pending' where id = ?",
        args: [repair.runId],
      });
      await expect(repository.abandon(repair.runId, true)).rejects.toThrow(
        "has an unconfirmed Algolia index move",
      );
      await client.execute({
        sql: "update ingestion_run set stage = 'sources' where id = ?",
        args: [repair.runId],
      });
      await client.execute({
        sql: `insert into search_notification_intent (id, run_id, status)
              values ('repair-intent', ?, 'pending')`,
        args: [repair.runId],
      });
      await repository.abandon(repair.runId, false);
      expect((await repository.getRun(repair.runId)).fullReindexRequired).toBe(
        true,
      );
      const intent = await client.execute({
        sql: `select status, last_error
              from search_notification_intent where id = 'repair-intent'`,
        args: [],
      });
      expect(JSON.stringify(intent.rows[0])).toBe(
        JSON.stringify({
          status: "cancelled",
          last_error: "owning_ingestion_run_abandoned",
        }),
      );
    } finally {
      testDatabase.cleanup();
    }
  });

  test("retries a degraded daily publication and stops after a healthy retry", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
      );
      const now = new Date("2026-08-22T09:00:00.000Z");
      const first = await repository.prepareWakeup(now);
      expect(first.status).toBe("start");
      if (first.status !== "start") throw new Error("Expected first run");
      await client.execute({
        sql: `
          update ingestion_run
          set status = 'success', stage = 'released', active_slot = null,
              full_reindex_required = 0, publication_sequence = 1,
              inventory_outcome = 'published_degraded',
              search_published_at = ?, completed_at = ?
          where id = ?
        `,
        args: [now.getTime(), now.getTime(), first.runId],
      });

      const retry = await repository.prepareWakeup(now);
      expect(retry.status).toBe("start");
      if (retry.status !== "start") throw new Error("Expected degraded retry");
      await client.execute({
        sql: `
          update ingestion_run
          set status = 'success', stage = 'released', active_slot = null,
              full_reindex_required = 0, publication_sequence = 2,
              inventory_outcome = 'published',
              search_published_at = ?, completed_at = ?
          where id = ?
        `,
        args: [now.getTime(), now.getTime(), retry.runId],
      });

      expect(await repository.prepareWakeup(now)).toEqual({
        status: "not_due",
        publishedRunId: retry.runId,
      });
    } finally {
      testDatabase.cleanup();
    }
  });

  test("moves a failed full-index publish out of its critical section", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
      );
      const wakeup = await repository.prepareWakeup(
        new Date("2026-08-22T07:00:00.000Z"),
      );
      if (wakeup.status !== "start") throw new Error("Expected a new run");
      await client.execute({
        sql: "update ingestion_run set stage = 'full_reindex_publish' where id = ?",
        args: [wakeup.runId],
      });

      await repository.markRunFailed(wakeup.runId, "Algolia unavailable");

      expect((await repository.getRun(wakeup.runId)).stage).toBe(
        "full_reindex_publish_failed",
      );
      await repository.abandon(wakeup.runId, true);
      expect((await repository.getRun(wakeup.runId)).status).toBe("abandoned");
    } finally {
      testDatabase.cleanup();
    }
  });

  test("cleans snapshots and bounded delivery history without deleting pending work", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
      );
      await repository.initialize("run-cleanup");
      await client.execute({
        sql: `
          update ingestion_run
          set status = 'success', stage = 'released', active_slot = null
          where id = 'run-cleanup'
        `,
        args: [],
      });
      await client.execute({
        sql: `
          insert into vehicle_snapshot (
            run_id, source, vin, year, make, model, location_code,
            location_name, state, state_abbr, lat, lng
          ) values (
            'run-cleanup', 'pyp', 'VIN-SNAPSHOT', 2000, 'Make', 'Model',
            'yard', 'Yard', 'State', 'ST', 0, 0
          )
        `,
        args: [],
      });
      await client.executeMultiple(`
        insert into vehicle_change_v2 (run_id, vin, change_type, processed_at)
        values ('run-cleanup', 'VIN-PROCESSED', 'upsert', 1);
        insert into vehicle_change_v2 (run_id, vin, change_type, processed_at)
        values ('run-cleanup', 'VIN-PENDING', 'upsert', null);
        insert into search_notification_intent (id, run_id, status, created_at)
        values ('old-delivered', 'run-cleanup', 'delivered', 1);
        insert into search_notification_intent (id, run_id, status, created_at)
        values ('recent-delivered', 'run-cleanup', 'delivered', 1700000000000);
        insert into search_notification_intent (id, run_id, status, created_at)
        values ('old-pending', 'run-cleanup', 'pending', 1);
      `);

      expect(
        await repository.cleanupBatch(
          "run-cleanup",
          new Date("2023-11-20T00:00:00.000Z"),
        ),
      ).toEqual({ deleted: 3, done: true });

      const snapshots = await client.execute(
        "select vin from vehicle_snapshot order by vin",
      );
      expect(snapshots.rows).toHaveLength(0);
      const changes = await client.execute(
        "select vin from vehicle_change_v2 order by vin",
      );
      expect(changes.rows.map((row) => row.vin)).toEqual(["VIN-PENDING"]);
      const intents = await client.execute(
        "select id from search_notification_intent order by id",
      );
      expect(intents.rows.map((row) => row.id)).toEqual([
        "old-pending",
        "recent-delivered",
      ]);
    } finally {
      testDatabase.cleanup();
    }
  });
});

const testYard: Yard = {
  source: "pyp",
  code: "1229",
  name: "Pick Your Part - Sun Valley",
  operator: "LKQ Pick Your Part",
  address: "11201 Pendleton St.",
  city: "Sun Valley",
  state: "CA",
  postalCode: "91352",
  lat: 34.2284,
  lng: -118.3929,
  websiteUrl: "https://www.pyp.com/inventory/sun-valley-1229/",
  phone: "800-962-2277",
  email: null,
};

function yardChunk(yards: Yard[]): FetchedDurableSourceChunk<"pyp"> {
  return {
    cursor: pypCursorFromBoundary(),
    status: "paused",
    pagesProcessed: 1,
    vehiclesProcessed: 0,
    uniqueVehicles: 0,
    duplicateVehicles: 0,
    rejectedVehicles: 0,
    errors: [],
    vehicles: [],
    yards,
  };
}

test("yard checkpoints upsert metadata without vehicles and ignore stale replay", async () => {
  const database = createTestClient();
  try {
    await database.client.executeMultiple(TEST_SCHEMA);
    const repository = createDurableIngestionRepository(
      drizzle(database.client),
      database.client,
    );
    await repository.initialize("yard-run");
    const request = {
      runId: "yard-run",
      requestedCursor: initialPypCursor,
      fetched: yardChunk([testYard]),
    };
    await repository.checkpointChunk(request);
    const stored = await database.client.execute("select * from yard");
    expect(stored.rows[0]).toMatchObject({
      source: "pyp",
      code: "1229",
      phone: testYard.phone,
      website_url: testYard.websiteUrl,
    });
    await repository.checkpointChunk({
      ...request,
      requestedCursor: pypCursorFromBoundary(),
      fetched: {
        ...yardChunk([
          { ...testYard, phone: "800-555-1234", websiteUrl: null },
        ]),
        cursor: pypCursorFromBoundary(2),
      },
    });
    await repository.checkpointChunk(request);
    const updated = await database.client.execute(
      "select phone, website_url from yard",
    );
    expect(updated.rows).toHaveLength(1);
    expect(updated.rows[0]).toMatchObject({
      phone: "800-555-1234",
      website_url: null,
    });
    await repository.checkpointChunk({
      runId: "yard-run",
      requestedCursor: {
        source: "row52",
        afterLocationId: 0,
        locationIds: [],
        skip: 0,
      },
      fetched: {
        ...yardChunk([
          { ...testYard, source: "row52", name: "Independent yard" },
        ]),
        cursor: {
          source: "row52",
          afterLocationId: 1229,
          locationIds: [],
          skip: 0,
        },
      },
    });
    expect(
      (await database.client.execute("select count(*) as count from yard"))
        .rows[0]?.count,
    ).toBe(2);
  } finally {
    database.cleanup();
  }
});

test("yard checkpoints reject mismatched sources and roll back when vehicle writes fail", async () => {
  const database = createTestClient();
  try {
    await database.client.executeMultiple(TEST_SCHEMA);
    const repository = createDurableIngestionRepository(
      drizzle(database.client),
      database.client,
    );
    await repository.initialize("yard-failure");
    const request = {
      runId: "yard-failure",
      requestedCursor: initialPypCursor,
      fetched: yardChunk([{ ...testYard, source: "row52" }]),
    };
    await expect(repository.checkpointChunk(request)).rejects.toThrow(
      "source does not match",
    );
    await database.client.executeMultiple(
      "create trigger reject_snapshot before insert on vehicle_snapshot begin select raise(abort, 'snapshot rejected'); end;",
    );
    await expect(
      repository.checkpointChunk({
        ...request,
        fetched: { ...yardChunk([testYard]), vehicles: [makeVehicle()] },
      }),
    ).rejects.toThrow("snapshot rejected");
    expect(
      (await database.client.execute("select count(*) as count from yard"))
        .rows[0]?.count,
    ).toBe(0);
    expect(
      await repository.getCheckpoint({
        runId: request.runId,
        requestedCursor: request.requestedCursor,
      }),
    ).toBeNull();
  } finally {
    database.cleanup();
  }
});
