ALTER TABLE "tusk"."account_settings" ADD COLUMN "brief_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tusk"."account_settings" ADD COLUMN "brief_at" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tusk"."account_settings" ADD COLUMN "reminders_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tusk"."account_settings" ADD COLUMN "email_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tusk"."account_settings" ADD COLUMN "sent_kinds" text DEFAULT '' NOT NULL;