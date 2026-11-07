ALTER TABLE "tusk"."backup_connection" ADD COLUMN "failure_kind" text;--> statement-breakpoint
ALTER TABLE "tusk"."backup_connection" ADD COLUMN "failures" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tusk"."backup_connection" ADD COLUMN "stopped_at" bigint;