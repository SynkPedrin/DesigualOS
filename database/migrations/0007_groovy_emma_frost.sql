ALTER TABLE "studio_jobs" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "studio_jobs" ADD CONSTRAINT "studio_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
