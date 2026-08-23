import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import type { FetchedDurableSourceChunk } from "./durable-ingestion-types";
import type { DurableSourceCursor } from "./durable-source";
import type { CanonicalVehicle } from "./types";

function pypCursorFromBoundary(): DurableSourceCursor {
  return { source: "pyp", page: 2 };
}

function createTestClient() {
  const directory = mkdtempSync(join(tmpdir(), "durable-ingestion-test-"));
  const client = createClient({
    url: `file:${join(directory, "test.db")}`,
  });
  return {
    client,
    cleanup() {
      client.close();
      rmSync(directory, { recursive: true });
    },
  };
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

const TEST_SCHEMA = `
  create table ingestion_run (
    id text primary key, source text not null, status text not null,
    schedule_key text, workflow_run_id text, stage text not null default 'sources',
    active_slot integer, reconciliation_cursor text,
    projector_cursor integer not null default 0,
    full_reindex_required integer not null default 0,
    full_reindex_cursor text, full_reindex_move_task_id integer,
    alert_match_cursor text,
    accepted_sources text, inventory_outcome text,
    publication_sequence integer, published_vehicle_count integer,
    published_yard_count integer,
    vehicles_upserted integer default 0, vehicles_deleted integer default 0,
    errors text, execution_errors text, started_at integer not null,
    last_progress_at integer not null,
    inventory_published_at integer, search_published_at integer,
    alert_matching_completed_at integer, released_at integer,
    completed_at integer
  );
  create unique index ingestion_run_single_active_idx on ingestion_run(active_slot);
  create table ingestion_source_run (
    id text primary key, run_id text not null, source text not null,
    status text not null, start_cursor text, next_cursor text,
    pages_processed integer not null default 0,
    vehicles_processed integer not null default 0,
    unique_vehicles integer not null default 0,
    duplicate_vehicles integer not null default 0,
    rejected_vehicles integer not null default 0,
    acceptance_status text not null default 'pending',
    validation_errors text,
    errors text, started_at integer not null, completed_at integer,
    foreign key (run_id) references ingestion_run(id) on delete cascade
  );
  create table vehicle_snapshot (
    run_id text not null, source text not null, vin text not null,
    year integer not null, make text not null, model text not null,
    color text, stock_number text, image_url text, available_date text,
    location_code text not null, location_name text not null,
    location_city text not null default 'Unknown', state text not null,
    state_abbr text not null, lat real not null, lng real not null,
    section text, row text, space text, details_url text, parts_url text,
    prices_url text, engine text, trim text, transmission text,
    created_at integer not null default 0,
    primary key (run_id, source, vin),
    foreign key (run_id) references ingestion_run(id) on delete cascade
  );
  create table search_notification_intent (
    id text primary key, run_id text not null, status text not null,
    cancelled_at integer, claim_token text, last_error text
  );
`;

function makeVehicle(vin = "2MEFM75W4XX703938"): CanonicalVehicle {
  return {
    vin,
    source: "pyp",
    year: 1999,
    make: "Mercury",
    model: "Grand Marquis",
    color: "Red",
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
    locationCode: "yard-1",
    locationName: "Test Yard",
    locationCity: "Tulsa",
    state: "Oklahoma",
    stateAbbr: "OK",
    lat: 36.154,
    lng: -95.993,
    section: null,
    row: null,
    space: null,
    detailsUrl: null,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}

describe("durable ingestion repository", () => {
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
          requestedCursor: { source: "pyp", page: 1 },
        }),
      ).toBeNull();

      const fetched = {
        cursor: { source: "pyp" as const, page: 2 },
        status: "paused" as const,
        pagesProcessed: 1,
        vehiclesProcessed: 1,
        uniqueVehicles: 1,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles: [makeVehicle()],
      };
      const first = await repository.checkpointChunk({
        runId: "run-1",
        requestedCursor: { source: "pyp", page: 1 },
        fetched,
      });
      const replay = await repository.checkpointChunk({
        runId: "run-1",
        requestedCursor: { source: "pyp", page: 1 },
        fetched,
      });
      expect(first.count).toBe(1);
      expect(replay.count).toBe(1);
      expect(replay.pagesProcessed).toBe(1);

      await expect(
        repository.checkpointChunk({
          runId: "run-1",
          requestedCursor: pypCursorFromBoundary(),
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
          requestedCursor: { source: "pyp", page: 1 },
          fetched: {
            cursor: { source: "pyp", page: 2 },
            status: "paused",
            pagesProcessed: 1,
            vehiclesProcessed: 1,
            uniqueVehicles: 1,
            duplicateVehicles: 0,
            rejectedVehicles: 0,
            errors: [],
            vehicles: [makeVehicle(vin)],
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
});
