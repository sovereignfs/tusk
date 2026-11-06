ALTER TABLE `backup_connection` ADD `last_checked_at` integer;--> statement-breakpoint
ALTER TABLE `backup_connection` ADD `mode` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `backup_connection` ADD `frequency` text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE `backup_connection` ADD `next_backup_at` integer;--> statement-breakpoint
CREATE INDEX `backup_connection_due_idx` ON `backup_connection` (`next_backup_at`);