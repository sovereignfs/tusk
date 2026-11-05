CREATE TABLE `account_settings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`created_at` integer NOT NULL
);
