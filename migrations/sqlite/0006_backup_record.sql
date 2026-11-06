ALTER TABLE `backup_connection` ADD `last_backup_at` integer;--> statement-breakpoint
ALTER TABLE `backup_connection` ADD `last_backup_path` text;--> statement-breakpoint
ALTER TABLE `backup_connection` ADD `last_fingerprint` text;