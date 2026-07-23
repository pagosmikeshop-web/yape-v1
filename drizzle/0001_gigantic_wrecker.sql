CREATE TABLE `manager_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` text NOT NULL,
	`command` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_identities` (
	`telegram_user_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_identities_user_id_unique` ON `telegram_identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `telegram_identity_user_idx` ON `telegram_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`update_id` text PRIMARY KEY NOT NULL,
	`received_at` text NOT NULL
);
