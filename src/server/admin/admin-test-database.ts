import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

/** The columns of the tables admin reads touch, as schema.ts defines them. */
const ADMIN_TEST_SCHEMA = `
  create table ingestion_run (
    id text primary key, source text not null, status text not null,
    schedule_key text, stage text not null default 'sources',
    active_slot integer, full_reindex_required integer not null default 0,
    inventory_outcome text, publication_sequence integer,
    published_vehicle_count integer, errors text,
    started_at integer not null, last_progress_at integer not null,
    inventory_published_at integer, search_published_at integer,
    completed_at integer
  );
  create index ingestion_run_search_published_at_idx on ingestion_run(search_published_at);
  create table ingestion_source_run (
    id text primary key, run_id text not null references ingestion_run(id),
    source text not null, status text not null,
    start_cursor text, next_cursor text,
    pages_processed integer not null default 0,
    vehicles_processed integer not null default 0,
    unique_vehicles integer not null default 0,
    duplicate_vehicles integer not null default 0,
    rejected_vehicles integer not null default 0,
    acceptance_status text not null default 'pending',
    validation_errors text, errors text,
    snapshot_chunks text not null default '[]',
    started_at integer not null, completed_at integer
  );
  create table yard_inventory (
    source text not null, location_code text not null,
    location_name text not null, location_city text not null,
    state_abbr text not null, lat real not null, lng real not null,
    vehicle_count integer not null, inventory_url text,
    last_published_at integer, updated_at integer not null,
    primary key (source, location_code)
  );
  create table vehicle_change_v2 (
    id integer primary key autoincrement, run_id text not null,
    vin text not null, change_type text not null, payload text,
    payload_version integer not null default 1,
    created_at integer not null default 0, processed_at integer
  );
  create index vehicle_change_v2_processed_at_idx on vehicle_change_v2(processed_at, id);
  create table search_alert_check (
    id text primary key, day text not null unique, status text not null,
    checked_through integer not null, search_cursor text,
    started_at integer not null, last_progress_at integer not null,
    completed_at integer
  );
  create table search_notification_intent (
    id text primary key, run_id text, alert_check_id text,
    publication_sequence integer not null default 0,
    saved_search_id text not null default 'search',
    user_id text not null default 'user', channel text not null,
    search_match_version integer not null default 1,
    channel_config_version integer not null default 1,
    payload text not null default '{}', status text not null default 'pending',
    attempts integer not null default 0, last_error text,
    created_at integer not null default 0, delivered_at integer
  );
  create index search_notification_intent_alert_check_idx on search_notification_intent(alert_check_id);
  create table user (
    id text primary key, name text not null default 'user',
    email text not null unique, email_verified integer not null default 0,
    created_at integer not null
  );
  create table saved_search (
    id text primary key, user_id text not null default 'user',
    email_alerts_enabled integer not null default 0,
    discord_alerts_enabled integer not null default 0,
    created_at integer not null
  );
`;

/** An in-memory database with the tables the admin dashboard reads. */
export async function createAdminTestDatabase() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(ADMIN_TEST_SCHEMA);
  return { client, db: drizzle(client) };
}
