CREATE TABLE `vehicle_observation` (
	`run_id` text NOT NULL,
	`source` text NOT NULL,
	`vin` text NOT NULL,
	PRIMARY KEY(`run_id`, `source`, `vin`),
	FOREIGN KEY (`run_id`) REFERENCES `ingestion_run`(`id`) ON UPDATE no action ON DELETE cascade
);
