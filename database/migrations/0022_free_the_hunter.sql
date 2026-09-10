CREATE TABLE IF NOT EXISTS "operational_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"external_id" text,
	"client_id" uuid,
	"entity_type" text,
	"entity_id" text,
	"actor" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw" jsonb,
	"occurred_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proactive_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule" text NOT NULL,
	"agent" text NOT NULL,
	"client_id" uuid,
	"entity_type" text,
	"entity_id" text,
	"severity" text DEFAULT 'medium' NOT NULL,
	"confidence" numeric(4, 3),
	"title" text NOT NULL,
	"body" text NOT NULL,
	"recommended_action" text,
	"dedupe_key" text NOT NULL,
	"cooldown_until" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_jobs" ALTER COLUMN "include_text" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "confidence" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "importance" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proactive_signals" ADD CONSTRAINT "proactive_signals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operational_events_source_external_idx" ON "operational_events" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_events_client_idx" ON "operational_events" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_events_processed_idx" ON "operational_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_events_type_idx" ON "operational_events" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proactive_signals_dedupe_idx" ON "proactive_signals" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_signals_status_idx" ON "proactive_signals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_signals_client_idx" ON "proactive_signals" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_status_idx" ON "memories" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memories_dedupe_key_idx" ON "memories" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_source_idx" ON "memories" USING btree ("source_type","source_id");