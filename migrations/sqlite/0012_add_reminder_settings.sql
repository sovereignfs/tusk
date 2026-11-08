ALTER TABLE `account_settings` ADD `brief_on` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `account_settings` ADD `brief_at` text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `account_settings` ADD `reminders_on` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `account_settings` ADD `email_on` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `account_settings` ADD `sent_kinds` text DEFAULT '' NOT NULL;