ALTER TABLE "ge_entries" ADD COLUMN "paid_at_unknown" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_parties_document_uq" ON "ge_parties" USING btree ("organization_id","document") WHERE "ge_parties"."document" is not null;
--> statement-breakpoint
ALTER TABLE "ge_entries" DROP CONSTRAINT "ge_entries_paid_ck";--> statement-breakpoint
ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_paid_ck" CHECK ((status = 'quitado') = (paid_at is not null or paid_at_unknown));--> statement-breakpoint
ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_paid_unknown_ck" CHECK (not (paid_at is not null and paid_at_unknown));
