CREATE TABLE "tusk"."backup_connection" (
	"account_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"repository" text NOT NULL,
	"branch" text NOT NULL,
	"credential_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
