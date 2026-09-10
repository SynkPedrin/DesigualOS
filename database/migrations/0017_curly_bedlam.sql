ALTER TABLE "studio_jobs" ADD COLUMN "style" text DEFAULT 'padrao' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "variations" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;