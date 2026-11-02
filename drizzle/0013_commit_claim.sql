ALTER TABLE `ingestion_run` ADD `commit_started_at` integer;--> statement-breakpoint
ALTER TABLE `ingestion_run` ADD `execution_failures` integer DEFAULT 0 NOT NULL;