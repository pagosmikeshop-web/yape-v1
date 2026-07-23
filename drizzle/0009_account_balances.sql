CREATE TABLE `account_balances` (
  `user_id` text PRIMARY KEY NOT NULL,
  `balance_cents` integer DEFAULT 3913 NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "account_balances_non_negative_check" CHECK (`balance_cents` >= 0),
  CONSTRAINT "account_balances_maximum_check" CHECK (`balance_cents` <= 99999999999)
);
