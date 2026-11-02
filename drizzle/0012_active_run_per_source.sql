DROP INDEX `ingestion_run_single_active_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `ingestion_run_active_source_idx` ON `ingestion_run` (`source`,`active_slot`);