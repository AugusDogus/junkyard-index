CREATE TABLE `yard_check` (
	`source` text NOT NULL,
	`location_code` text NOT NULL,
	`outcome` text NOT NULL,
	`reported_at` integer NOT NULL,
	`reported_run_id` text,
	`last_checked_at` integer,
	`last_checked_run_id` text,
	`last_changed_at` integer,
	`last_arrival_at` integer,
	`consecutive_unchecked_runs` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`source`, `location_code`),
	CONSTRAINT "yard_check_outcome_check" CHECK("yard_check"."outcome" in ('fetched', 'preserved', 'blocked', 'replayed', 'unreported')),
	CONSTRAINT "yard_check_checked_run_check" CHECK("yard_check"."last_checked_run_id" is null or "yard_check"."last_checked_at" is not null)
);
--> statement-breakpoint
-- Backfill every published yard. Its last check is inherited from its last
-- accepted publication (last_checked_run_id null), since no run has proven a
-- live fetch yet; from the next run only a "fetched" result advances it.
-- Changes and arrivals come from live and missing inventory: vehicle rows
-- only change last_seen_at when a run changes them.
INSERT INTO `yard_check` (`source`, `location_code`, `outcome`, `reported_at`, `last_checked_at`, `last_changed_at`, `last_arrival_at`)
SELECT `yard_inventory`.`source`, `yard_inventory`.`location_code`, 'unreported',
	coalesce(`yard_inventory`.`last_published_at`, `yard_inventory`.`updated_at`),
	`yard_inventory`.`last_published_at`, `history`.`last_changed_at`, `history`.`last_arrival_at`
FROM `yard_inventory`
LEFT JOIN (
	SELECT `source`, `location_code`,
		nullif(max(coalesce(max(`last_seen_at`), 0), coalesce(max(`missing_since_at`), 0)), 0) AS `last_changed_at`,
		max(`first_seen_at`) AS `last_arrival_at`
	FROM `vehicle` NOT INDEXED
	GROUP BY `source`, `location_code`
) `history` ON `history`.`source` = `yard_inventory`.`source`
	AND `history`.`location_code` = `yard_inventory`.`location_code`;
