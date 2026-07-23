CREATE TABLE `activations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`credits_charged` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activations_user_id_unique` ON `activations` (`user_id`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reason` text NOT NULL,
	`reference_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_reference_unique` ON `credit_ledger` (`reason`,`reference_id`);--> statement-breakpoint
CREATE TABLE `password_reset_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`price_credits` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`approved_at` text,
	`approved_by` text
);
--> statement-breakpoint
CREATE INDEX `password_reset_seller_idx` ON `password_reset_requests` (`seller_id`,`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_code` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	`owner_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`pin_hash` text,
	`pin_salt` text,
	`credits` integer DEFAULT 0 NOT NULL,
	`device_id` text,
	`device_public_key` text,
	`must_change_password` integer DEFAULT false NOT NULL,
	`must_set_pin` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`activated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_login_unique` ON `users` (`seller_code`,`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_device_unique` ON `users` (`device_id`);