ALTER TABLE "tusk"."backup_connection" ADD COLUMN "last_checked_at" bigint;--> statement-breakpoint
ALTER TABLE "tusk"."backup_connection" ADD COLUMN "mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "tusk"."backup_connection" ADD COLUMN "frequency" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "tusk"."backup_connection" ADD COLUMN "next_backup_at" bigint;--> statement-breakpoint
CREATE INDEX "backup_connection_due_idx" ON "tusk"."backup_connection" USING btree ("next_backup_at");