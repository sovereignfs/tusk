ALTER TABLE `account_settings` ADD `inbox_seen_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `account_settings` ADD `notices_off` text DEFAULT '' NOT NULL;