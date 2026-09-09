CREATE TABLE `yard` (
	`source` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`operator` text,
	`address` text,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`postal_code` text,
	`lat` real,
	`lng` real,
	`website_url` text,
	`phone` text,
	`email` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`source`, `code`)
);
