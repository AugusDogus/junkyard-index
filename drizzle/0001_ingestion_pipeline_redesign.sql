CREATE TABLE IF NOT EXISTS "ingestion_source_run" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"start_cursor" text,
	"next_cursor" text,
	"pages_processed" integer DEFAULT 0 NOT NULL,
	"vehicles_processed" integer DEFAULT 0 NOT NULL,
	"errors" text,
	"started_at" integer NOT NULL,
	"completed_at" integer,
	FOREIGN KEY ("run_id") REFERENCES "ingestion_run"("id") ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_source_run_run_id_idx" ON "ingestion_source_run" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_source_run_source_idx" ON "ingestion_source_run" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_source_run_status_idx" ON "ingestion_source_run" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vehicle_snapshot" (
	"run_id" text NOT NULL,
	"source" text NOT NULL,
	"vin" text NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"color" text,
	"stock_number" text,
	"image_url" text,
	"available_date" text,
	"location_code" text NOT NULL,
	"location_name" text NOT NULL,
	"state" text NOT NULL,
	"state_abbr" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"section" text,
	"row" text,
	"space" text,
	"details_url" text,
	"parts_url" text,
	"prices_url" text,
	"engine" text,
	"trim" text,
	"transmission" text,
	"created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY("run_id", "source", "vin"),
	FOREIGN KEY ("run_id") REFERENCES "ingestion_run"("id") ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_snapshot_run_source_idx" ON "vehicle_snapshot" ("run_id", "source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_snapshot_vin_idx" ON "vehicle_snapshot" ("vin");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vehicle_change" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"run_id" text NOT NULL,
	"vin" text NOT NULL,
	"change_type" text NOT NULL,
	"payload" text,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	"processed_at" integer,
	FOREIGN KEY ("run_id") REFERENCES "ingestion_run"("id") ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_change_run_id_idx" ON "vehicle_change" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_change_vin_idx" ON "vehicle_change" ("vin");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_change_processed_at_idx" ON "vehicle_change" ("processed_at", "id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingestion_projector_checkpoint" (
	"name" text PRIMARY KEY NOT NULL,
	"last_processed_change_id" integer DEFAULT 0 NOT NULL,
	"updated_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
