CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`card_id` text,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_board_idx` ON `activity` (`board_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_card_idx` ON `activity` (`card_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `board` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`description` text,
	`visibility` text NOT NULL,
	`archived_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `board_workspace_idx` ON `board` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `board_list` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`position` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `board_list_board_idx` ON `board_list` (`board_id`,`position`);--> statement-breakpoint
CREATE TABLE `board_member` (
	`board_id` text NOT NULL,
	`account_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`board_id`, `account_id`)
);
--> statement-breakpoint
CREATE INDEX `board_member_account_idx` ON `board_member` (`account_id`);--> statement-breakpoint
CREATE TABLE `card` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`list_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_date` text,
	`due_time` text,
	`position` text NOT NULL,
	`archived_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `card_list_idx` ON `card` (`list_id`,`position`);--> statement-breakpoint
CREATE INDEX `card_board_idx` ON `card` (`board_id`);--> statement-breakpoint
CREATE TABLE `card_assignee` (
	`card_id` text NOT NULL,
	`account_id` text NOT NULL,
	`board_id` text NOT NULL,
	`assigned_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `account_id`)
);
--> statement-breakpoint
CREATE INDEX `card_assignee_account_idx` ON `card_assignee` (`account_id`);--> statement-breakpoint
CREATE TABLE `card_label` (
	`card_id` text NOT NULL,
	`label_id` text NOT NULL,
	`board_id` text NOT NULL,
	PRIMARY KEY(`card_id`, `label_id`)
);
--> statement-breakpoint
CREATE TABLE `checklist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`board_id` text NOT NULL,
	`title` text NOT NULL,
	`completed_at` integer,
	`position` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `checklist_item_card_idx` ON `checklist_item` (`card_id`,`position`);--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`board_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer
);
--> statement-breakpoint
CREATE INDEX `comment_card_idx` ON `comment` (`card_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `label` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `label_board_idx` ON `label` (`board_id`);--> statement-breakpoint
CREATE TABLE `notice` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text,
	`workspace_id` text,
	`board_id` text,
	`card_id` text,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notice_account_idx` ON `notice` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `publication` (
	`board_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_token_idx` ON `publication` (`token`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_member` (
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `account_id`)
);
--> statement-breakpoint
CREATE INDEX `workspace_member_account_idx` ON `workspace_member` (`account_id`);