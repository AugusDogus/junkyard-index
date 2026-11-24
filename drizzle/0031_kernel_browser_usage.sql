CREATE TABLE `kernel_browser_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`mode` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	CONSTRAINT "kernel_browser_usage_mode_check" CHECK(mode in ('headless', 'headful')),
	CONSTRAINT "kernel_browser_usage_ended_check" CHECK(ended_at is null or ended_at >= started_at)
);
--> statement-breakpoint
CREATE INDEX `kernel_browser_usage_source_idx` ON `kernel_browser_usage` (`source`,`started_at`);