CREATE TABLE "tusk"."reminder_slot" (
	"account_id" text NOT NULL,
	"at" bigint NOT NULL,
	"claimed_at" bigint,
	CONSTRAINT "reminder_slot_account_id_at_pk" PRIMARY KEY("account_id","at")
);
--> statement-breakpoint
CREATE INDEX "reminder_slot_due_idx" ON "tusk"."reminder_slot" USING btree ("at");