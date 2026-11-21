CREATE TABLE IF NOT EXISTS `search_index_schema` (
	`index_name` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vehicle_model_redirect` (
	`from_path` text PRIMARY KEY NOT NULL,
	`to_path` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vin_decode_cache` (
	`pattern` text PRIMARY KEY NOT NULL,
	`data` text,
	`retry_after` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `vehicle` ADD `source_make` text;--> statement-breakpoint
ALTER TABLE `vehicle` ADD `source_model` text;