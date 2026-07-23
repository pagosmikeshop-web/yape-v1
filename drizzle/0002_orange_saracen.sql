CREATE TABLE `payment_directory` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`phone_e164` text NOT NULL,
	`discoverable` integer DEFAULT true NOT NULL,
	`verified_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_directory_user_unique` ON `payment_directory` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_directory_phone_unique` ON `payment_directory` (`phone_e164`);--> statement-breakpoint
CREATE TABLE `recipient_lookup_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recipient_lookup_requester_idx` ON `recipient_lookup_attempts` (`requester_user_id`,`created_at`);
