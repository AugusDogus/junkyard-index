ALTER TABLE `ingestion_run` ADD `ready_at` integer;--> statement-breakpoint
CREATE INDEX `ingestion_run_commit_queue_idx` ON `ingestion_run` (`active_slot`,`commit_started_at`,`ready_at`);--> statement-breakpoint
-- Runs already waiting for the commit were validated by earlier code, which
-- wrote nothing on later busy claims: last_progress_at is their validation time.
UPDATE `ingestion_run` SET `ready_at` = `last_progress_at`
WHERE `active_slot` = 1 AND `commit_started_at` IS NULL AND `stage` <> 'sources';
