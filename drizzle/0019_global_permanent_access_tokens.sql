CREATE TABLE `global_permanent_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`token_hint` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`redeemed_at` text,
	`redeemed_by_user_id` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `global_permanent_access_tokens_hash_unique` ON `global_permanent_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `global_permanent_access_tokens_created_idx` ON `global_permanent_access_tokens` (`created_at`);--> statement-breakpoint
CREATE INDEX `global_permanent_access_tokens_redeemed_idx` ON `global_permanent_access_tokens` (`redeemed_at`);
