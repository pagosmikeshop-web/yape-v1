CREATE TABLE `qr_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`holder_name` text NOT NULL,
	`phone_e164` text,
	`provider` text NOT NULL,
	`recipient_user_id` text,
	`qr_payload_ciphertext` text NOT NULL,
	`qr_payload_iv` text NOT NULL,
	`payload_hash` text NOT NULL,
	`encryption_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "qr_contacts_provider_check" CHECK("qr_contacts"."provider" in ('Mi Banco','Yape','Plin','BCP','BBVA','Interbank','Scotiabank','Bim','Banco Falabella','Banco Pichincha','Dale!','Izipay','Agora / Oh!','Tunki')),
	CONSTRAINT "qr_contacts_encryption_version_check" CHECK("qr_contacts"."encryption_version" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qr_contacts_user_payload_unique` ON `qr_contacts` (`user_id`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `qr_contacts_user_updated_idx` ON `qr_contacts` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `qr_contacts_recipient_idx` ON `qr_contacts` (`recipient_user_id`);
