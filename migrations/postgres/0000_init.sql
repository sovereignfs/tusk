CREATE SCHEMA "tusk";
--> statement-breakpoint
CREATE TABLE "tusk"."account_settings" (
	"account_id" text PRIMARY KEY NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"created_at" bigint NOT NULL
);
