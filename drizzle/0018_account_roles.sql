CREATE TABLE IF NOT EXISTS `user_roles` (
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `role`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `user_roles_role_check` CHECK (`role` in ('admin', 'seller', 'client'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_roles_role_idx` ON `user_roles` (`role`, `user_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `user_roles` (`user_id`, `role`, `granted_by`, `created_at`)
SELECT `id`, `role`, NULL, `created_at` FROM `users` WHERE `deleted_at` IS NULL;
