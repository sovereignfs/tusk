CREATE TABLE `credential` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`purpose` text NOT NULL,
	`sealed` text NOT NULL,
	`key_fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credential_account_idx` ON `credential` (`account_id`);--> statement-breakpoint
CREATE INDEX `credential_key_idx` ON `credential` (`key_fingerprint`);