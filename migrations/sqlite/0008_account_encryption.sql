ALTER TABLE `account_settings` ADD `encryption` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `account_settings` ADD `recipient` text;--> statement-breakpoint
ALTER TABLE `account_settings` ADD `key_offered_at` integer;