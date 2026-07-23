CREATE TABLE `saved_payment_recipients` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `phone_e164` text NOT NULL,
  `display_name` text DEFAULT 'Número nuevo' NOT NULL,
  `source` text DEFAULT 'manual' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_payment_recipients_user_phone_unique` ON `saved_payment_recipients` (`user_id`,`phone_e164`);
--> statement-breakpoint
CREATE INDEX `saved_payment_recipients_user_updated_idx` ON `saved_payment_recipients` (`user_id`,`updated_at`);
