CREATE TABLE `permanent_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`token_hint` text NOT NULL,
	`seller_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`redeemed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permanent_access_tokens_hash_unique` ON `permanent_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `permanent_access_tokens_seller_idx` ON `permanent_access_tokens` (`seller_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `permanent_access_tokens_user_idx` ON `permanent_access_tokens` (`user_id`,`created_at`);