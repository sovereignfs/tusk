ALTER TABLE `backup_connection` ADD `failure_kind` text;--> statement-breakpoint
ALTER TABLE `backup_connection` ADD `failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `backup_connection` ADD `stopped_at` integer;