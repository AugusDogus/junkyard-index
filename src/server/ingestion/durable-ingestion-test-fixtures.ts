import { createClient } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalVehicle } from "./types";

export function createTestClient() {
  const directory = mkdtempSync(join(tmpdir(), "durable-ingestion-test-"));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  return {
    client,
    cleanup() {
      client.close();
      rmSync(directory, { recursive: true });
    },
  };
}

export const TEST_SCHEMA = `
${readFileSync(new URL("../../../drizzle/0007_yard_metadata.sql", import.meta.url), "utf8")}
${readFileSync(new URL("../../../drizzle/0008_vehicle_observations.sql", import.meta.url), "utf8")}
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
    cancelled_at integer, claim_token text, last_error text,
    created_at integer not null default 0
  );
  create table vehicle_change_v2 (
    id integer primary key autoincrement, run_id text not null,
    vin text not null, change_type text not null, processed_at integer
  );
  create index vehicle_change_v2_processed_at_idx
    on vehicle_change_v2(processed_at, id);
`;

export function makeVehicle(vin = "2MEFM75W4XX703938"): CanonicalVehicle {
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
