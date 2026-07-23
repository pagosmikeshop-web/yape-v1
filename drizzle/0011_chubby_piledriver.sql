CREATE TABLE `account_history_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`cleared_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_reference` text NOT NULL,
	`destination` text DEFAULT 'Yape' NOT NULL,
	`amount_cents` integer NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`security_code` text NOT NULL,
	`operation_number` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_movements_positive_amount_check" CHECK("account_movements"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_movements_operation_unique` ON `account_movements` (`operation_number`);--> statement-breakpoint
CREATE INDEX `account_movements_user_created_idx` ON `account_movements` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `account_movements_deduct_balance`
BEFORE INSERT ON `account_movements`
FOR EACH ROW
BEGIN
  UPDATE `account_balances`
  SET `balance_cents` = `balance_cents` - NEW.`amount_cents`,
      `updated_at` = NEW.`created_at`
  WHERE `user_id` = NEW.`user_id`
    AND `is_configured` = 1
    AND `balance_cents` >= NEW.`amount_cents`;
  SELECT CASE WHEN changes() = 0 THEN RAISE(ABORT, 'INSUFFICIENT_BALANCE') END;
END;
