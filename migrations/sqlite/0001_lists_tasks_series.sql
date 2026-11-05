CREATE TABLE `list` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`position` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `list_owner_seq_idx` ON `list` (`owner_id`,`seq`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`list_id` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `series_owner_seq_idx` ON `series` (`owner_id`,`seq`);--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`list_id` text NOT NULL,
	`parent_id` text,
	`position` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`reminder_sent_at` integer,
	`due_date` text,
	`due_time` text,
	`completed_at` integer,
	`fields` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_owner_seq_idx` ON `task` (`owner_id`,`seq`);