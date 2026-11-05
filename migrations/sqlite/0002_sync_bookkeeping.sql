CREATE TABLE `applied_mutation` (
	`account_id` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`applied_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `rate_bucket` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_bucket_window_idx` ON `rate_bucket` (`window_start`);--> statement-breakpoint
CREATE TABLE `tombstone` (
	`table_name` text NOT NULL,
	`id` text NOT NULL,
	`account_id` text NOT NULL,
	`seq` integer NOT NULL,
	`deleted_at` integer NOT NULL,
	PRIMARY KEY(`table_name`, `id`)
);
--> statement-breakpoint
CREATE INDEX `tombstone_account_seq_idx` ON `tombstone` (`account_id`,`seq`);