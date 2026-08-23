import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestionRun, ingestionSourceRun, vehicleSnapshot } from "~/schema";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";

const TEST_SCHEMA = `
  create table ingestion_run (
    id text primary key, source text not null, schedule_key text,
    workflow_run_id text, status text not null, stage text not null,
    active_slot integer, reconciliation_cursor text,
    projector_cursor integer not null default 0,
    full_reindex_required integer not null default 0,
    full_reindex_cursor text, full_reindex_move_task_id integer,
    alert_match_cursor text,
    accepted_sources text, inventory_outcome text,
    publication_sequence integer, published_vehicle_count integer,
    published_yard_count integer, vehicles_upserted integer default 0,
    vehicles_deleted integer default 0, errors text, execution_errors text,
    started_at integer not null, last_progress_at integer not null,
    inventory_published_at integer, search_published_at integer,
    alert_matching_completed_at integer, released_at integer,
    completed_at integer
  );
  create table ingestion_source_run (
    id text primary key, run_id text not null, source text not null,
    status text not null, start_cursor text, next_cursor text,
    pages_processed integer not null default 0,
    vehicles_processed integer not null default 0,
    unique_vehicles integer not null default 0,
    duplicate_vehicles integer not null default 0,
    rejected_vehicles integer not null default 0,
    acceptance_status text not null default 'pending',
    validation_errors text, errors text, started_at integer not null,
    completed_at integer
  );
  create table vehicle_snapshot (
    run_id text not null, source text not null, vin text not null,
    year integer not null, make text not null, model text not null,
    color text, stock_number text, image_url text, available_date text,
    location_code text not null, location_name text not null,
    location_city text not null, state text not null, state_abbr text not null,
    lat real not null, lng real not null, section text, row text, space text,
    details_url text, parts_url text, prices_url text, engine text, trim text,
    transmission text, created_at integer not null,
    primary key (run_id, source, vin)
  );
  create table vehicle (
    vin text primary key, source text not null, year integer not null,
    make text not null, model text not null, color text, stock_number text,
    image_url text, available_date text, location_code text not null,
    location_name text not null, location_city text not null, state text not null,
    state_abbr text not null, lat real not null, lng real not null,
    section text, row text, space text, details_url text, parts_url text,
    prices_url text, engine text, trim text, transmission text,
    first_seen_at integer not null, last_seen_at integer not null,
    missing_since_at integer, missing_run_count integer
  );
  create table vehicle_change_v2 (
    id integer primary key autoincrement, run_id text not null, vin text not null,
    change_type text not null, payload text, payload_version integer not null,
    created_at integer not null, processed_at integer
  );
  create unique index vehicle_change_v2_run_vin_type_idx
    on vehicle_change_v2(run_id, vin, change_type)
    where processed_at is null;
`;

function snapshot(runId: string, source: "row52" | "pyp", color: string) {
  return {
    runId,
    source,
    vin: "VIN-1",
    year: 2018,
    make: "FORD",
    model: "FOCUS",
    color,
    stockNumber: "A1",
    imageUrl: null,
    availableDate: null,
    locationCode: "yard-1",
    locationName: "Yard 1",
    locationCity: "Tulsa",
    state: "Oklahoma",
    stateAbbr: "OK",
    lat: 36.1,
    lng: -95.9,
    section: null,
    row: null,
    space: null,
    detailsUrl: null,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
    createdAt: new Date("2026-08-22T07:00:00.000Z"),
  };
}

describe("bounded durable reconciliation", () => {
  test("does not reconcile an abandoned run", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const startedAt = new Date("2026-08-22T07:00:00.000Z");
      await drizzle(client)
        .insert(ingestionRun)
        .values({
          id: "run-abandoned",
          source: "all",
          status: "abandoned",
          stage: "reconcile_missing",
          activeSlot: null,
          acceptedSources: JSON.stringify(["pyp"]),
          startedAt,
          lastProgressAt: startedAt,
        });

      const result = await reconcileDurableIngestionRun({
        runId: "run-abandoned",
        database: drizzle(client),
        batchClient: client,
      });

      expect(result).toEqual({ status: "stopped" });
    } finally {
      client.close();
    }
  });

  test("preserves a failed publish stage for projector recovery on resume", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      await client.execute({
        sql: `
          insert into ingestion_run (
            id, source, status, stage, active_slot, accepted_sources,
            started_at, last_progress_at
          ) values (?, 'all', 'running', 'full_reindex_publish_failed', 1,
                    '[]', ?, ?)
        `,
        args: ["run-failed-publish", Date.now(), Date.now()],
      });

      const result = await reconcileDurableIngestionRun({
        runId: "run-failed-publish",
        database: drizzle(client),
        batchClient: client,
      });

      expect(result.status).toBe("complete");
      const row = await client.execute(
        "select stage from ingestion_run where id = 'run-failed-publish'",
      );
      expect(row.rows[0]?.stage).toBe("full_reindex_publish_failed");
    } finally {
      client.close();
    }
  });

  test("chooses the canonical winner, resumes by phase, and advances missing state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "reconciliation-test-"));
    const client = createClient({ url: `file:${join(directory, "test.db")}` });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const startedAt = new Date("2026-08-22T07:00:00.000Z");
      await database.insert(ingestionRun).values({
        id: "run-1",
        source: "all",
        status: "running",
        stage: "reconcile_upsert",
        activeSlot: 1,
        acceptedSources: JSON.stringify(["row52", "pyp"]),
        startedAt,
        lastProgressAt: startedAt,
      });
      await database.insert(ingestionSourceRun).values([
        {
          id: "run-1:row52",
          runId: "run-1",
          source: "row52",
          status: "success",
          acceptanceStatus: "accepted",
          uniqueVehicles: 1,
          startedAt,
        },
        {
          id: "run-1:pyp",
          runId: "run-1",
          source: "pyp",
          status: "success",
          acceptanceStatus: "accepted",
          uniqueVehicles: 1,
          startedAt,
        },
      ]);
      await database
        .insert(vehicleSnapshot)
        .values([
          snapshot("run-1", "pyp", "Blue"),
          snapshot("run-1", "row52", "Black"),
        ]);
      await client.execute({
        sql: `insert into vehicle (
          vin, source, year, make, model, location_code, location_name,
          location_city, state, state_abbr, lat, lng, first_seen_at,
          last_seen_at, missing_run_count
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "VIN-MISSING",
          "pyp",
          2010,
          "HONDA",
          "CIVIC",
          "yard-2",
          "Yard 2",
          "Tulsa",
          "Oklahoma",
          "OK",
          36.1,
          -95.9,
          startedAt.getTime(),
          startedAt.getTime(),
          0,
        ],
      });

      const upsert = await reconcileDurableIngestionRun({
        runId: "run-1",
        database,
        batchClient: client,
      });
      expect(upsert).toMatchObject({ status: "paused", phase: "missing" });

      const completed = await reconcileDurableIngestionRun({
        runId: "run-1",
        database,
        batchClient: client,
      });
      expect(completed.status).toBe("complete");
      const vehicles = await client.execute(
        "select vin, source, color, missing_run_count from vehicle order by vin",
      );
      expect(vehicles.rows).toHaveLength(2);
      expect(vehicles.rows[0]?.vin).toBe("VIN-1");
      expect(vehicles.rows[0]?.source).toBe("row52");
      expect(vehicles.rows[0]?.color).toBe("Black");
      expect(vehicles.rows[0]?.missing_run_count).toBe(0);
      expect(vehicles.rows[1]?.vin).toBe("VIN-MISSING");
      expect(vehicles.rows[1]?.source).toBe("pyp");
      expect(vehicles.rows[1]?.missing_run_count).toBe(1);
      const [run] = await database
        .select()
        .from(ingestionRun)
        .where(eq(ingestionRun.id, "run-1"));
      expect(run?.stage).toBe("project_changes");
      expect(run?.publicationSequence).toBe(1);
      expect(run?.publishedVehicleCount).toBe(2);
      const changes = await client.execute(
        "select vin, change_type from vehicle_change_v2 order by vin",
      );
      expect(changes.rows).toHaveLength(2);
      expect(changes.rows[0]?.vin).toBe("VIN-1");
      expect(changes.rows[0]?.change_type).toBe("upsert");
      expect(changes.rows[1]?.vin).toBe("VIN-MISSING");
      expect(changes.rows[1]?.change_type).toBe("missing");
    } finally {
      client.close();
      rmSync(directory, { recursive: true });
    }
  });
});
