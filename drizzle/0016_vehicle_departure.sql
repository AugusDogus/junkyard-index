CREATE TABLE `vehicle_departure` (
	`vin` text NOT NULL,
	`source` text NOT NULL,
	`location_code` text NOT NULL,
	`year` integer NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`available_date` text,
	`first_seen_at` integer NOT NULL,
	`departed_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	PRIMARY KEY(`vin`, `departed_at`)
);
--> statement-breakpoint
CREATE INDEX `vehicle_departure_yard_idx` ON `vehicle_departure` (`source`,`location_code`,`departed_at`);--> statement-breakpoint
CREATE INDEX `vehicle_departure_departed_at_idx` ON `vehicle_departure` (`departed_at`);