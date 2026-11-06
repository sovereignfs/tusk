CREATE TABLE "tusk"."activity" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"card_id" text,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"details" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."board" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"description" text,
	"visibility" text NOT NULL,
	"archived_at" bigint,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."board_list" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."board_member" (
	"board_id" text NOT NULL,
	"account_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "board_member_board_id_account_id_pk" PRIMARY KEY("board_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "tusk"."card" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"list_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" text,
	"due_time" text,
	"position" text COLLATE "C" NOT NULL,
	"archived_at" bigint,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."card_assignee" (
	"card_id" text NOT NULL,
	"account_id" text NOT NULL,
	"board_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "card_assignee_card_id_account_id_pk" PRIMARY KEY("card_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "tusk"."card_label" (
	"card_id" text NOT NULL,
	"label_id" text NOT NULL,
	"board_id" text NOT NULL,
	CONSTRAINT "card_label_card_id_label_id_pk" PRIMARY KEY("card_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "tusk"."checklist_item" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"board_id" text NOT NULL,
	"title" text NOT NULL,
	"completed_at" bigint,
	"position" text COLLATE "C" NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."comment" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"board_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" bigint NOT NULL,
	"edited_at" bigint
);
--> statement-breakpoint
CREATE TABLE "tusk"."label" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."notice" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"workspace_id" text,
	"board_id" text,
	"card_id" text,
	"details" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."publication" (
	"board_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tusk"."workspace_member" (
	"workspace_id" text NOT NULL,
	"account_id" text NOT NULL,
	"role" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "workspace_member_workspace_id_account_id_pk" PRIMARY KEY("workspace_id","account_id")
);
--> statement-breakpoint
CREATE INDEX "activity_board_idx" ON "tusk"."activity" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_card_idx" ON "tusk"."activity" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE INDEX "board_workspace_idx" ON "tusk"."board" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "board_list_board_idx" ON "tusk"."board_list" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "board_member_account_idx" ON "tusk"."board_member" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "card_list_idx" ON "tusk"."card" USING btree ("list_id","position");--> statement-breakpoint
CREATE INDEX "card_board_idx" ON "tusk"."card" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "card_assignee_account_idx" ON "tusk"."card_assignee" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "checklist_item_card_idx" ON "tusk"."checklist_item" USING btree ("card_id","position");--> statement-breakpoint
CREATE INDEX "comment_card_idx" ON "tusk"."comment" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE INDEX "label_board_idx" ON "tusk"."label" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "notice_account_idx" ON "tusk"."notice" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_token_idx" ON "tusk"."publication" USING btree ("token");--> statement-breakpoint
CREATE INDEX "workspace_member_account_idx" ON "tusk"."workspace_member" USING btree ("account_id");