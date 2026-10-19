ALTER TABLE "notifications" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_dedupe_key_uq" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;