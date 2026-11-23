-- Every statement is idempotent: the dev database already applied this
-- migration under its earlier name, 0029_source_control.
CREATE TABLE IF NOT EXISTS `admin_action_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`source` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `admin_action_log_source_idx` ON `admin_action_log` (`source`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `source_control` (
	`source` text PRIMARY KEY NOT NULL,
	`ingestion` text DEFAULT 'running' NOT NULL,
	`visibility` text DEFAULT 'shown' NOT NULL,
	`hidden_reason` text,
	`updated_by_user_id` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "source_control_ingestion_check" CHECK(ingestion in ('running', 'paused')),
	CONSTRAINT "source_control_visibility_check" CHECK(visibility in ('shown', 'hidden')),
	CONSTRAINT "source_control_hidden_reason_check" CHECK((visibility = 'hidden') = (hidden_reason is not null and trim(hidden_reason) != ''))
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `admin_action_log_no_update` BEFORE UPDATE ON `admin_action_log`
BEGIN
  SELECT RAISE(ABORT, 'admin_action_log is append-only: rows cannot be changed');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `admin_action_log_no_delete` BEFORE DELETE ON `admin_action_log`
BEGIN
  SELECT RAISE(ABORT, 'admin_action_log is append-only: rows cannot be deleted');
END;--> statement-breakpoint
-- Meeks was hidden by a code constant in src/lib/hidden-source.ts. This row
-- keeps it hidden with no gap: the migration runs before the deploy that
-- reads this table builds, while the previous deploy still hides it.
INSERT INTO `source_control` (`source`, `ingestion`, `visibility`, `hidden_reason`, `updated_by_user_id`, `updated_at`)
VALUES ('meeks', 'running', 'hidden', 'Since 2026-11-22 every meeksrecycling.com page serves an unrelated page that redirects visitors to another site.', NULL, cast(unixepoch('subsecond') * 1000 as integer))
ON CONFLICT (`source`) DO NOTHING;
