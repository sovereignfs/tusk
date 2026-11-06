CREATE TABLE "tusk"."credential" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"purpose" text NOT NULL,
	"sealed" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "credential_account_idx" ON "tusk"."credential" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "credential_key_idx" ON "tusk"."credential" USING btree ("key_fingerprint");