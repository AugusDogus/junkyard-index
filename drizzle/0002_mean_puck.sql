CREATE TABLE `billing_operation` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`token` text,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_operation_state_check" CHECK((
        ("billing_operation"."state" in ('checkout_open', 'checkout_completed') and "billing_operation"."token" is null)
        or ("billing_operation"."state" in ('checkout_claimed', 'checkout_completed_claimed', 'deleting')
          and "billing_operation"."token" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE `user` ADD `terms_accepted_at` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `terms_version` text;