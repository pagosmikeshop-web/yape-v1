CREATE TABLE `auth_rate_limits` (
	`bucket` text NOT NULL,
	`subject_hash` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_rate_limits_subject_unique` ON `auth_rate_limits` (`bucket`,`subject_hash`);--> statement-breakpoint
CREATE INDEX `auth_rate_limits_updated_idx` ON `auth_rate_limits` (`updated_at`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`subject_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`consumed_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_idx` ON `password_reset_tokens` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_expiry_idx` ON `password_reset_tokens` (`expires_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `pin_verified_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `unlocked_until` text;