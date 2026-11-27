CREATE TABLE `departed_yard` (
	`source` text NOT NULL,
	`location_code` text NOT NULL,
	`location_name` text NOT NULL,
	`location_city` text NOT NULL,
	`state_abbr` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`inventory_url` text,
	`departed_at` integer NOT NULL,
	PRIMARY KEY(`source`, `location_code`)
);
