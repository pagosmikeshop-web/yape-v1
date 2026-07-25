PRAGMA foreign_keys = ON;--> statement-breakpoint
INSERT OR IGNORE INTO `users` (
  `id`, `seller_code`, `username`, `display_name`, `email`, `role`, `is_owner`,
  `owner_id`, `status`, `password_hash`, `password_salt`, `pin_hash`, `pin_salt`,
  `credits`, `device_id`, `device_public_key`, `fingerprint_id_hash`,
  `telegram_user_id`, `referral_code`, `referred_by_user_id`, `access_expires_at`,
  `must_change_password`, `must_set_pin`, `created_at`, `updated_at`,
  `activated_at`, `deleted_at`
) VALUES (
  'system-telegram-trial', 'SYSTEM', 'telegram-trial', 'Sistema Telegram', '',
  'seller', 0, NULL, 'disabled', 'disabled', 'disabled', NULL, NULL, 0,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP
);--> statement-breakpoint
DROP INDEX IF EXISTS `users_fingerprint_unique`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `users_fingerprint_idx`
  ON `users` (`fingerprint_id_hash`)
  WHERE `fingerprint_id_hash` IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `telegram_registration_challenges` (
  `id` text PRIMARY KEY NOT NULL,
  `code_hash` text NOT NULL,
  `telegram_user_id` text NOT NULL,
  `fingerprint_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `verified_at` text,
  `consumed_at` text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `telegram_registration_challenges_code_unique`
  ON `telegram_registration_challenges` (`code_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `telegram_registration_challenges_lookup_idx`
  ON `telegram_registration_challenges` (`telegram_user_id`, `fingerprint_hash`, `expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `telegram_registration_challenges_expiry_idx`
  ON `telegram_registration_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `account_feature_entitlements` (
  `user_id` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('sms','auto')),
  `enabled` integer NOT NULL DEFAULT 1 CHECK (`enabled` IN (0,1)),
  `validated_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`user_id`, `kind`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_feature_entitlements_user_idx`
  ON `account_feature_entitlements` (`user_id`, `kind`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `account_movements_daily_limit`
BEFORE INSERT ON `account_movements`
FOR EACH ROW
WHEN (
  SELECT COALESCE(SUM(`amount_cents`), 0)
  FROM `account_movements`
  WHERE `user_id` = NEW.`user_id`
    AND date(`created_at`, '-5 hours') = date(NEW.`created_at`, '-5 hours')
) + NEW.`amount_cents` > 200000
BEGIN
  SELECT RAISE(ABORT, 'DAILY_LIMIT_EXCEEDED');
END;
