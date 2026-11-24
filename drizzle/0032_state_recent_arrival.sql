CREATE TABLE `state_recent_arrival` (
	`source` text NOT NULL,
	`state_abbr` text NOT NULL,
	`available_date` text,
	`observed_arrival_at` integer,
	`vehicle_count` integer NOT NULL
);
--> statement-breakpoint
-- Backfill from live inventory, as ingestion refreshes it
-- (stateRecentArrivalRefreshStatements): arrivals from the last 8 days.
INSERT INTO `state_recent_arrival` (`source`, `state_abbr`, `available_date`, `observed_arrival_at`, `vehicle_count`)
SELECT `source`, `state_abbr`, `available_date`, `observed_arrival_at`, count(*)
FROM `vehicle` NOT INDEXED
WHERE `missing_since_at` IS NULL
	AND (`observed_arrival_at` >= (unixepoch('now') - 8 * 86400) * 1000
		OR (`available_date` IS NOT NULL
			AND coalesce(unixepoch(`available_date`, 'subsec') * 1000 >= (unixepoch('now') - 8 * 86400) * 1000, 1)))
GROUP BY `source`, `state_abbr`, `available_date`, `observed_arrival_at`;
