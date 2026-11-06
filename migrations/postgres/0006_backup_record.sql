ALTER TABLE "tusk"."backup_connection" ADD COLUMN "last_backup_at" bigint;--> statement-breakpoint
ALTER TABLE "tusk"."backup_connection" ADD COLUMN "last_backup_path" text;--> statement-breakpoint
ALTER TABLE "tusk"."backup_connection" ADD COLUMN "last_fingerprint" text;