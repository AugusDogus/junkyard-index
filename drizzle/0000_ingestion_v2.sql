-- Add the durable ingestion, publication, and alert delivery state.
-- This migration is expand-compatible with the previous application version.

alter table saved_search add column search_match_version integer not null default 1;
--> statement-breakpoint
alter table saved_search add column email_config_version integer not null default 1;
--> statement-breakpoint
alter table saved_search add column discord_config_version integer not null default 1;
--> statement-breakpoint
alter table saved_search add column email_start_sequence integer not null default 0;
--> statement-breakpoint
alter table saved_search add column discord_start_sequence integer not null default 0;
--> statement-breakpoint
alter table saved_search add column last_matched_publication_sequence integer not null default 0;
--> statement-breakpoint
alter table saved_search add column alert_quarantined_at integer;
--> statement-breakpoint
alter table saved_search add column alert_quarantine_reason text;
--> statement-breakpoint

alter table ingestion_run add column schedule_key text;
--> statement-breakpoint
alter table ingestion_run add column workflow_run_id text;
--> statement-breakpoint
alter table ingestion_run add column stage text not null default 'sources';
--> statement-breakpoint
alter table ingestion_run add column active_slot integer;
--> statement-breakpoint
alter table ingestion_run add column reconciliation_cursor text;
--> statement-breakpoint
alter table ingestion_run add column projector_cursor integer not null default 0;
--> statement-breakpoint
alter table ingestion_run add column full_reindex_required integer not null default 0;
--> statement-breakpoint
alter table ingestion_run add column full_reindex_cursor text;
--> statement-breakpoint
alter table ingestion_run add column full_reindex_move_task_id integer;
--> statement-breakpoint
alter table ingestion_run add column alert_match_cursor text;
--> statement-breakpoint
alter table ingestion_run add column accepted_sources text;
--> statement-breakpoint
alter table ingestion_run add column inventory_outcome text;
--> statement-breakpoint
alter table ingestion_run add column publication_sequence integer;
--> statement-breakpoint
alter table ingestion_run add column published_vehicle_count integer;
--> statement-breakpoint
alter table ingestion_run add column published_yard_count integer;
--> statement-breakpoint
alter table ingestion_run add column execution_errors text;
--> statement-breakpoint
alter table ingestion_run add column last_progress_at integer not null default 0;
--> statement-breakpoint
alter table ingestion_run add column inventory_published_at integer;
--> statement-breakpoint
alter table ingestion_run add column search_published_at integer;
--> statement-breakpoint
alter table ingestion_run add column alert_matching_completed_at integer;
--> statement-breakpoint
alter table ingestion_run add column released_at integer;
--> statement-breakpoint

create unique index ingestion_run_single_active_idx
  on ingestion_run(active_slot);
--> statement-breakpoint
create index ingestion_run_schedule_key_idx on ingestion_run(schedule_key);
--> statement-breakpoint
create index ingestion_run_search_published_at_idx
  on ingestion_run(search_published_at);
--> statement-breakpoint
create index ingestion_run_stage_idx on ingestion_run(stage);
--> statement-breakpoint

alter table ingestion_source_run add column unique_vehicles integer not null default 0;
--> statement-breakpoint
alter table ingestion_source_run add column duplicate_vehicles integer not null default 0;
--> statement-breakpoint
alter table ingestion_source_run add column rejected_vehicles integer not null default 0;
--> statement-breakpoint
alter table ingestion_source_run add column acceptance_status text not null default 'pending';
--> statement-breakpoint
alter table ingestion_source_run add column validation_errors text;
--> statement-breakpoint

create index vehicle_snapshot_run_vin_source_idx
  on vehicle_snapshot(run_id, vin, source);
--> statement-breakpoint

-- Leave the legacy delivery history untouched. New durable ingestion runs use
-- an empty change log with their own constraints and indexes.
create table vehicle_change_v2 (
  id integer primary key autoincrement,
  run_id text not null references ingestion_run(id) on delete cascade,
  vin text not null,
  change_type text not null,
  payload text,
  payload_version integer not null default 1,
  created_at integer not null default (cast(unixepoch('subsecond') * 1000 as integer)),
  processed_at integer
);
--> statement-breakpoint

create index vehicle_change_v2_run_id_idx on vehicle_change_v2(run_id);
--> statement-breakpoint
create unique index vehicle_change_v2_run_vin_type_idx
  on vehicle_change_v2(run_id, vin, change_type)
  where processed_at is null;
--> statement-breakpoint
create index vehicle_change_v2_vin_idx on vehicle_change_v2(vin);
--> statement-breakpoint
create index vehicle_change_v2_processed_at_idx
  on vehicle_change_v2(processed_at, id);
--> statement-breakpoint

create table search_notification_intent (
  id text primary key,
  run_id text not null references ingestion_run(id) on delete cascade,
  publication_sequence integer not null,
  saved_search_id text not null references saved_search(id) on delete cascade,
  user_id text not null references user(id) on delete cascade,
  channel text not null,
  search_match_version integer not null,
  channel_config_version integer not null,
  payload text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  claim_token text,
  claimed_at integer,
  next_attempt_at integer,
  last_error text,
  created_at integer not null default (cast(unixepoch('subsecond') * 1000 as integer)),
  delivered_at integer,
  cancelled_at integer
);
--> statement-breakpoint

create unique index search_notification_intent_dedupe_idx
  on search_notification_intent(saved_search_id, publication_sequence, channel);
--> statement-breakpoint
create index search_notification_intent_delivery_idx
  on search_notification_intent(status, claimed_at, id);
--> statement-breakpoint
create index search_notification_intent_run_idx
  on search_notification_intent(run_id);
