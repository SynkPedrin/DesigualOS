ALTER TABLE "studio_jobs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;