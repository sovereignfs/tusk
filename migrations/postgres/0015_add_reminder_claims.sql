ALTER TABLE "tusk"."account_settings" ADD COLUMN "last_digest_on" text;--> statement-breakpoint
ALTER TABLE "tusk"."desk_card" ADD COLUMN "reminded_for" text;--> statement-breakpoint
ALTER TABLE "tusk"."card" ADD COLUMN "reminded_for" text;