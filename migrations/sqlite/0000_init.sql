CREATE TABLE `account_settings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`pruned_through` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `applied_mutation` (
	`account_id` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`applied_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `desk_card` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`list_id` text NOT NULL,
	`position` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`due_date` text,
	`due_time` text,
	`completed_at` integer,
	`fields` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `desk_card_owner_seq_idx` ON `desk_card` (`owner_id`,`seq`);--> statement-breakpoint
CREATE TABLE `desk_check` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`card_id` text NOT NULL,
	`position` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `desk_check_owner_seq_idx` ON `desk_check` (`owner_id`,`seq`);--> statement-breakpoint
CREATE TABLE `desk_list` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`position` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `desk_list_owner_seq_idx` ON `desk_list` (`owner_id`,`seq`);--> statement-breakpoint
CREATE TABLE `desk_series` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`list_id` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `desk_series_owner_seq_idx` ON `desk_series` (`owner_id`,`seq`);--> statement-breakpoint
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