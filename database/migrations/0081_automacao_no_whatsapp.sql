ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whatsapp_phone" text;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "whatsapp_phone" text;