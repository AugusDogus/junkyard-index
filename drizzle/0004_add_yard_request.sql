CREATE TABLE `yard_request` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`yard_name` text NOT NULL,
	`website` text,
	`requester_email` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `yard_request_userId_idx` ON `yard_request` (`user_id`);