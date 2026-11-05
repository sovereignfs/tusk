CREATE SCHEMA "tusk";
--> statement-breakpoint
CREATE TABLE "tusk"."account_settings" (
	"account_id" text PRIMARY KEY NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"pruned_through" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."applied_mutation" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"seq" bigint NOT NULL,
	"applied_at" bigint NOT NULL,
	CONSTRAINT "applied_mutation_account_id_id_pk" PRIMARY KEY("account_id","id")
);
--> statement-breakpoint
CREATE TABLE "tusk"."desk_card" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"list_id" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"due_date" text,
	"due_time" text,
	"completed_at" bigint,
	"fields" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."desk_check" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"card_id" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"fields" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."desk_list" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"fields" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."desk_series" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"list_id" text NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"fields" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."rate_bucket" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."tombstone" (
	"table_name" text NOT NULL,
	"id" text NOT NULL,
	"account_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"deleted_at" bigint NOT NULL,
	CONSTRAINT "tombstone_table_name_id_pk" PRIMARY KEY("table_name","id")
);
--> statement-breakpoint
CREATE INDEX "desk_card_owner_seq_idx" ON "tusk"."desk_card" USING btree ("owner_id","seq");--> statement-breakpoint
CREATE INDEX "desk_check_owner_seq_idx" ON "tusk"."desk_check" USING btree ("owner_id","seq");--> statement-breakpoint
CREATE INDEX "desk_list_owner_seq_idx" ON "tusk"."desk_list" USING btree ("owner_id","seq");--> statement-breakpoint
CREATE INDEX "desk_series_owner_seq_idx" ON "tusk"."desk_series" USING btree ("owner_id","seq");--> statement-breakpoint
CREATE INDEX "rate_bucket_window_idx" ON "tusk"."rate_bucket" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "tombstone_account_seq_idx" ON "tusk"."tombstone" USING btree ("account_id","seq");