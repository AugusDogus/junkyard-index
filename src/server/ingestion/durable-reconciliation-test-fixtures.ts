import { readFileSync } from "node:fs";

export const RECONCILIATION_TEST_SCHEMA = `
${readFileSync(new URL("../../../drizzle/0008_vehicle_observations.sql", import.meta.url), "utf8")}
  create table ingestion_run (
    id text primary key, source text not null, schedule_key text,
    workflow_run_id text, status text not null, stage text not null,
    active_slot integer, commit_started_at integer,
    execution_failures integer not null default 0, reconciliation_cursor text,
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
    validation_errors text, errors text,
    snapshot_chunks text not null default '[]', started_at integer not null,
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
    transmission text, created_at integer not null default 0,
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
${readFileSync(new URL("../../../drizzle/0016_yard_inventory.sql", import.meta.url), "utf8")}
${readFileSync(new URL("../../../drizzle/0017_observed_vehicle_arrival.sql", import.meta.url), "utf8")}
${readFileSync(new URL("../../../drizzle/0019_vehicle_departure.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "")}
${readFileSync(new URL("../../../drizzle/0021_yard_publication.sql", import.meta.url), "utf8")}
`;
