-- Apply once before deploying the resumable ingestion workflow.
-- This migration is additive except for deduplicating historical change rows
-- that describe the same run, VIN, and change type.

alter table saved_search add column search_match_version integer not null default 1;
alter table saved_search add column email_config_version integer not null default 1;
alter table saved_search add column discord_config_version integer not null default 1;
alter table saved_search add column email_start_sequence integer not null default 0;
alter table saved_search add column discord_start_sequence integer not null default 0;
alter table saved_search add column last_matched_publication_sequence integer not null default 0;
alter table saved_search add column alert_quarantined_at integer;
alter table saved_search add column alert_quarantine_reason text;

alter table ingestion_run add column schedule_key text;
alter table ingestion_run add column workflow_run_id text;
alter table ingestion_run add column stage text not null default 'sources';
alter table ingestion_run add column active_slot integer;
alter table ingestion_run add column reconciliation_cursor text;
alter table ingestion_run add column projector_cursor integer not null default 0;
alter table ingestion_run add column full_reindex_required integer not null default 0;
alter table ingestion_run add column full_reindex_cursor text;
alter table ingestion_run add column full_reindex_move_task_id integer;
alter table ingestion_run add column alert_match_cursor text;
alter table ingestion_run add column accepted_sources text;
alter table ingestion_run add column inventory_outcome text;
alter table ingestion_run add column publication_sequence integer;
alter table ingestion_run add column published_vehicle_count integer;
alter table ingestion_run add column published_yard_count integer;
alter table ingestion_run add column execution_errors text;
alter table ingestion_run add column last_progress_at integer not null default 0;
alter table ingestion_run add column inventory_published_at integer;
alter table ingestion_run add column search_published_at integer;
alter table ingestion_run add column alert_matching_completed_at integer;
alter table ingestion_run add column released_at integer;

update ingestion_run
set last_progress_at = started_at
where last_progress_at = 0;

update ingestion_run
set stage = 'released',
    schedule_key = strftime('%Y-%m-%d', completed_at / 1000, 'unixepoch'),
    active_slot = null,
    full_reindex_required = 1,
    inventory_outcome = case
      when errors is null then 'published'
      else 'published_degraded'
    end,
    publication_sequence = 1,
    published_vehicle_count = (select count(*) from vehicle),
    published_yard_count = (select count(distinct location_code) from vehicle),
    inventory_published_at = completed_at,
    search_published_at = completed_at,
    alert_matching_completed_at = completed_at,
    released_at = completed_at
where id = (
  select id
  from ingestion_run
  where status = 'success' and completed_at is not null
  order by completed_at desc
  limit 1
);

update ingestion_run
set active_slot = 1
where id = (
  select id
  from ingestion_run
  where status = 'running'
  order by started_at desc
  limit 1
);

create unique index ingestion_run_single_active_idx
  on ingestion_run(active_slot);
create index ingestion_run_schedule_key_idx on ingestion_run(schedule_key);
create index ingestion_run_search_published_at_idx
  on ingestion_run(search_published_at);
create index ingestion_run_stage_idx on ingestion_run(stage);

alter table ingestion_source_run add column unique_vehicles integer not null default 0;
alter table ingestion_source_run add column duplicate_vehicles integer not null default 0;
alter table ingestion_source_run add column rejected_vehicles integer not null default 0;
alter table ingestion_source_run add column acceptance_status text not null default 'pending';
alter table ingestion_source_run add column validation_errors text;

create index vehicle_snapshot_run_vin_source_idx
  on vehicle_snapshot(run_id, vin, source);

delete from vehicle_change
where id not in (
  select max(id)
  from vehicle_change
  group by run_id, vin, change_type
);

create unique index vehicle_change_run_vin_type_idx
  on vehicle_change(run_id, vin, change_type);

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

create unique index search_notification_intent_dedupe_idx
  on search_notification_intent(saved_search_id, publication_sequence, channel);
create index search_notification_intent_delivery_idx
  on search_notification_intent(status, claimed_at, id);
create index search_notification_intent_run_idx
  on search_notification_intent(run_id);
