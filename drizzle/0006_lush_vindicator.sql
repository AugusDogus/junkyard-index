CREATE TABLE `row52_yard_exclusion` (
	`location_id` integer PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `row52_yard_exclusion` (`location_id`, `reason`)
VALUES (83, 'Former PICK-n-PULL Tallahassee yard acquired by GO Pull-It');
