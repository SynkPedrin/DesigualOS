CREATE TABLE IF NOT EXISTS "demand_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"demand_id" uuid NOT NULL,
	"client_id" uuid,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"storage_url" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demands" ADD COLUMN "clickup_task_id" text;--> statement-breakpoint
ALTER TABLE "demands" ADD COLUMN "clickup_task_url" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "demand_files" ADD CONSTRAINT "demand_files_demand_id_demands_id_fk" FOREIGN KEY ("demand_id") REFERENCES "public"."demands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "demand_files" ADD CONSTRAINT "demand_files_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "demand_files" ADD CONSTRAINT "demand_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demand_files_demand_id_idx" ON "demand_files" USING btree ("demand_id");