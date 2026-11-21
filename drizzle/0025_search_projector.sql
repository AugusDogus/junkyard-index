CREATE TABLE `search_dead_letter` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` integer NOT NULL,
	`vin` text NOT NULL,
	`environment` text NOT NULL,
	`index_name` text NOT NULL,
	`error_tag` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `search_dead_letter_vin_idx` ON `search_dead_letter` (`vin`);--> statement-breakpoint
CREATE TABLE `search_index_generation` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`index_name` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`temp_index_name` text,
	`snapshot_change_id` integer,
	`vin_cursor` text,
	`records_loaded` integer DEFAULT 0 NOT NULL,
	`move_task_id` integer,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`live_at` integer,
	`ended_at` integer,
	`temp_index_deleted_at` integer,
	`last_error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_index_generation_active_idx` ON `search_index_generation` (`environment`) WHERE status in ('requested', 'loading', 'moving');--> statement-breakpoint
CREATE UNIQUE INDEX `search_index_generation_live_idx` ON `search_index_generation` (`environment`) WHERE status = 'live';