ALTER TABLE "tusk"."account_settings" ADD COLUMN "encryption" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tusk"."account_settings" ADD COLUMN "recipient" text;--> statement-breakpoint
ALTER TABLE "tusk"."account_settings" ADD COLUMN "key_offered_at" bigint;