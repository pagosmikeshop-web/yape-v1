ALTER TABLE `users` ADD `is_owner` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `users_owner_role_idx` ON `users` (`owner_id`,`role`,`deleted_at`);