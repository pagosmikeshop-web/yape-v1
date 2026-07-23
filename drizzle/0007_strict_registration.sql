ALTER TABLE `users` ADD `fingerprint_id_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `telegram_user_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `referral_code` text;--> statement-breakpoint
ALTER TABLE `users` ADD `referred_by_user_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `access_expires_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_fingerprint_unique` ON `users` (`fingerprint_id_hash`) WHERE `fingerprint_id_hash` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_user_unique` ON `users` (`telegram_user_id`) WHERE `telegram_user_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_referral_code_unique` ON `users` (`referral_code`) WHERE `referral_code` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `telegram_group_members` (
  `telegram_user_id` text PRIMARY KEY NOT NULL,
  `chat_id` text NOT NULL,
  `username` text,
  `display_name` text,
  `first_seen_at` text NOT NULL,
  `last_seen_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `telegram_group_members_chat_idx` ON `telegram_group_members` (`chat_id`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `referral_redemptions` (
  `id` text PRIMARY KEY NOT NULL,
  `referrer_user_id` text NOT NULL,
  `redeemer_telegram_user_id` text NOT NULL,
  `redeemed_by_user_id` text,
  `month_key` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`referrer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`redeemed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `referral_redemptions_unique` ON `referral_redemptions` (`referrer_user_id`,`redeemer_telegram_user_id`,`month_key`);--> statement-breakpoint
CREATE INDEX `referral_redemptions_referrer_month_idx` ON `referral_redemptions` (`referrer_user_id`,`month_key`);
