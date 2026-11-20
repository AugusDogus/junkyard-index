-- Production created this table with drizzle-kit push; no earlier migration
-- does, so a database built from migrations alone gets its original shape here.
CREATE TABLE IF NOT EXISTS `ingestion_projector_checkpoint` (
	`name` text PRIMARY KEY NOT NULL,
	`last_processed_change_id` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ingestion_projector_checkpoint` ADD `kind` text DEFAULT 'publication' NOT NULL;--> statement-breakpoint
ALTER TABLE `ingestion_projector_checkpoint` ADD `job_cursor` text;--> statement-breakpoint
ALTER TABLE `ingestion_projector_checkpoint` ADD `job_day` text;--> statement-breakpoint
ALTER TABLE `ingestion_projector_checkpoint` ADD `blocked_until` integer;--> statement-breakpoint
ALTER TABLE `ingestion_projector_checkpoint` ADD `failure_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ingestion_projector_checkpoint` ADD `last_error_tag` text;--> statement-breakpoint
ALTER TABLE `ingestion_projector_checkpoint` ADD `last_success_at` integer;--> statement-breakpoint
-- Existing rows only advance on success, so their last update is their last success.
UPDATE `ingestion_projector_checkpoint` SET `last_success_at` = `updated_at`;--> statement-breakpoint
-- Dead rows: the retired per-change Algolia projector and superseded homepage snapshot versions.
DELETE FROM `ingestion_projector_checkpoint`
WHERE `name` IN ('vehicle_algolia', 'inventory-snapshot:v1', 'inventory-snapshot:v2');
