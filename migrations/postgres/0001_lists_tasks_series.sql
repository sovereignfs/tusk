CREATE TABLE "tusk"."list" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"fields" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."series" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"list_id" text NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"fields" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."task" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"list_id" text NOT NULL,
	"parent_id" text,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"reminder_sent_at" bigint,
	"due_date" text,
	"due_time" text,
	"completed_at" bigint,
	"fields" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "list_owner_seq_idx" ON "tusk"."list" USING btree ("owner_id","seq");--> statement-breakpoint
CREATE INDEX "series_owner_seq_idx" ON "tusk"."series" USING btree ("owner_id","seq");--> statement-breakpoint
CREATE INDEX "task_owner_seq_idx" ON "tusk"."task" USING btree ("owner_id","seq");