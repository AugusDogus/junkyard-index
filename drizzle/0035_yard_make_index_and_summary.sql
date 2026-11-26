CREATE TABLE `yard_summary` (
	`source` text NOT NULL,
	`location_code` text NOT NULL,
	`built_for` integer NOT NULL,
	`data` text NOT NULL,
	`content_hash` text NOT NULL,
	`content_changed_at` integer NOT NULL,
	PRIMARY KEY(`source`, `location_code`)
);
--> statement-breakpoint
CREATE INDEX `vehicle_yard_make_live_idx` ON `vehicle` (`source`,`location_code`,`make`,`model`) WHERE missing_since_at is null;