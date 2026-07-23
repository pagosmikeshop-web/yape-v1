ALTER TABLE `account_movements` ADD `recipient_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `account_movements` ADD `saved_recipient_id` text REFERENCES saved_payment_recipients(id);--> statement-breakpoint
ALTER TABLE `account_movements` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `account_movements_user_idempotency_unique` ON `account_movements` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `account_movements_recipient_user_idx` ON `account_movements` (`recipient_user_id`);