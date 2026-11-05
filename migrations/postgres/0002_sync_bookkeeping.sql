CREATE TABLE "tusk"."applied_mutation" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"seq" bigint NOT NULL,
	"applied_at" bigint NOT NULL,
	CONSTRAINT "applied_mutation_account_id_id_pk" PRIMARY KEY("account_id","id")
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
CREATE INDEX "rate_bucket_window_idx" ON "tusk"."rate_bucket" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "tombstone_account_seq_idx" ON "tusk"."tombstone" USING btree ("account_id","seq");