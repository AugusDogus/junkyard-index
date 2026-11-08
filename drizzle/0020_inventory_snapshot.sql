CREATE TABLE IF NOT EXISTS `inventory_snapshot` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
