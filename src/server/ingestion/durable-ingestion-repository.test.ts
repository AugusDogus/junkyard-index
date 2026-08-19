import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import type { FetchedDurableSourceChunk } from "./durable-ingestion-types";
import type { DurableSourceCursor } from "./durable-source";
import type { CanonicalVehicle } from "./types";

function pypCursorFromBoundary(): DurableSourceCursor {
  return { source: "pyp", page: 2 };
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
    vehicles_upserted integer default 0, vehicles_deleted integer default 0,
    errors text, started_at integer not null, completed_at integer
  );
  create table ingestion_source_run (
    id text primary key, run_id text not null, source text not null,
    status text not null, start_cursor text, next_cursor text,
    pages_processed integer not null default 0,
    vehicles_processed integer not null default 0,
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
`;

function makeVehicle(): CanonicalVehicle {
  return {
    vin: "2MEFM75W4XX703938",
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
  test("checkpoints once on replay and terminalizes children on run failure", async () => {
    const client = createClient({ url: "file::memory:?cache=shared" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(drizzle(client));

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
      expect(sourceRuns.every((row) => row.status !== "running")).toBe(true);
      expect(sourceRuns.find((row) => row.source === "pyp")?.status).toBe(
        "partial",
      );
      expect(
        sourceRuns
          .filter((row) => row.source !== "pyp")
          .every((row) => row.status === "error"),
      ).toBe(true);
      expect(
        sourceRuns.every((row) =>
          row.errors?.includes("reconciliation failed"),
        ),
      ).toBe(true);

      const snapshots = await client.execute(
        "select count(*) as count from vehicle_snapshot",
      );
      expect(snapshots.rows[0]?.count).toBe(0);
    } finally {
      client.close();
    }
  });
});
