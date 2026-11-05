CREATE TABLE "tasks"."list" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"fields" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks"."series" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"list_id" text NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"fields" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks"."task" (
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
CREATE INDEX "list_owner_seq_idx" ON "tasks"."list" USING btree ("owner_id","seq");--> statement-breakpoint
CREATE INDEX "series_owner_seq_idx" ON "tasks"."series" USING btree ("owner_id","seq");--> statement-breakpoint
CREATE INDEX "task_owner_seq_idx" ON "tasks"."task" USING btree ("owner_id","seq");