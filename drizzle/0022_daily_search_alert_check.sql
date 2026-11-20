CREATE TABLE `search_alert_check` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`status` text NOT NULL,
	`checked_through` integer NOT NULL,
	`search_cursor` text,
	`started_at` integer NOT NULL,
	`last_progress_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_alert_check_day_idx` ON `search_alert_check` (`day`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_search_notification_intent` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`alert_check_id` text,
	`publication_sequence` integer NOT NULL,
	`saved_search_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`search_match_version` integer NOT NULL,
	`channel_config_version` integer NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`delivery_group_id` text,
	`claim_token` text,
	`claimed_at` integer,
	`next_attempt_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`delivered_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `ingestion_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`alert_check_id`) REFERENCES `search_alert_check`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`saved_search_id`) REFERENCES `saved_search`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "search_notification_intent_owner_check" CHECK((run_id is null) <> (alert_check_id is null))
);
--> statement-breakpoint
INSERT INTO `__new_search_notification_intent`("id", "run_id", "alert_check_id", "publication_sequence", "saved_search_id", "user_id", "channel", "search_match_version", "channel_config_version", "payload", "status", "attempts", "delivery_group_id", "claim_token", "claimed_at", "next_attempt_at", "last_error", "created_at", "delivered_at", "cancelled_at") SELECT "id", "run_id", NULL, "publication_sequence", "saved_search_id", "user_id", "channel", "search_match_version", "channel_config_version", "payload", "status", "attempts", "delivery_group_id", "claim_token", "claimed_at", "next_attempt_at", "last_error", "created_at", "delivered_at", "cancelled_at" FROM `search_notification_intent`;--> statement-breakpoint
DROP TABLE `search_notification_intent`;--> statement-breakpoint
ALTER TABLE `__new_search_notification_intent` RENAME TO `search_notification_intent`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `search_notification_intent_dedupe_idx` ON `search_notification_intent` (`saved_search_id`,`publication_sequence`,`channel`);--> statement-breakpoint
CREATE INDEX `search_notification_intent_delivery_idx` ON `search_notification_intent` (`status`,`claimed_at`,`id`);--> statement-breakpoint
CREATE INDEX `search_notification_intent_run_idx` ON `search_notification_intent` (`run_id`);--> statement-breakpoint
CREATE INDEX `search_notification_intent_alert_check_idx` ON `search_notification_intent` (`alert_check_id`);--> statement-breakpoint
CREATE INDEX `search_notification_intent_recipient_idx` ON `search_notification_intent` (`user_id`,`channel`,`status`);