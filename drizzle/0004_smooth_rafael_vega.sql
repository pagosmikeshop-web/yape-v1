CREATE TABLE `account_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`consumed_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_invitations_token_unique` ON `account_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `account_invitations_user_idx` ON `account_invitations` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_invitations_expiry_idx` ON `account_invitations` (`expires_at`);