-- Forward repair for databases that already journaled 0000 before the v2
-- change log was split from legacy delivery history.
create table if not exists vehicle_change_v2 (
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

create index if not exists vehicle_change_v2_run_id_idx
  on vehicle_change_v2(run_id);
--> statement-breakpoint
create unique index if not exists vehicle_change_v2_run_vin_type_idx
  on vehicle_change_v2(run_id, vin, change_type)
  where processed_at is null;
--> statement-breakpoint
create index if not exists vehicle_change_v2_vin_idx
  on vehicle_change_v2(vin);
--> statement-breakpoint
create index if not exists vehicle_change_v2_processed_at_idx
  on vehicle_change_v2(processed_at, id);
