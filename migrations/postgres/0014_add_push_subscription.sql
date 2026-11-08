CREATE TABLE "tusk"."push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"credential_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint_idx" ON "tusk"."push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscription_account_idx" ON "tusk"."push_subscription" USING btree ("account_id");