CREATE TABLE `client_crm_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_type` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_crm_activities_user_idx` ON `client_crm_activities` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `client_crm_activities_type_idx` ON `client_crm_activities` (`activity_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `client_crm_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`crm_status` text DEFAULT 'new' NOT NULL,
	`client_type` text DEFAULT 'individual' NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`last_activity_at` text,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_crm_profiles_status_idx` ON `client_crm_profiles` (`crm_status`,`category`);--> statement-breakpoint
CREATE INDEX `client_crm_profiles_activity_idx` ON `client_crm_profiles` (`last_activity_at`);--> statement-breakpoint
CREATE TABLE `rbac_permission_overrides` (
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`effect` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rbac_permission_overrides_unique` ON `rbac_permission_overrides` (`user_id`,`permission`);--> statement-breakpoint
CREATE INDEX `rbac_permission_overrides_user_idx` ON `rbac_permission_overrides` (`user_id`);