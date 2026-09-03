ALTER TABLE "studio_jobs" ADD COLUMN "num_slides" integer;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "quality_preset" text;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "include_text" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "copy_slides" jsonb;