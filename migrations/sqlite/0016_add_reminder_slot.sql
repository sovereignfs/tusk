CREATE TABLE `reminder_slot` (
	`account_id` text NOT NULL,
	`at` integer NOT NULL,
	`claimed_at` integer,
	PRIMARY KEY(`account_id`, `at`)
);
--> statement-breakpoint
CREATE INDEX `reminder_slot_due_idx` ON `reminder_slot` (`at`);