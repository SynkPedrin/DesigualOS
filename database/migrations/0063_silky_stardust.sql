CREATE TABLE IF NOT EXISTS "calendar_event_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid,
	"contact_id" uuid,
	"email" text,
	"required" boolean DEFAULT true NOT NULL,
	"response_status" text DEFAULT 'needsAction' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"location" text,
	"meeting_url" text,
	"source" text DEFAULT 'native' NOT NULL,
	"external_provider" text,
	"external_event_id" text,
	"external_calendar_id" text,
	"visibility" text DEFAULT 'default' NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_external_unique" UNIQUE("external_provider","external_event_id","external_calendar_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_calendar_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid,
	"external_calendar_id" text NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"sync_token" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_calendar_accounts_user_id_external_calendar_id_unique" UNIQUE("user_id","external_calendar_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_calendar_accounts" ADD CONSTRAINT "member_calendar_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_calendar_accounts" ADD CONSTRAINT "member_calendar_accounts_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_event_participants_event_id_idx" ON "calendar_event_participants" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_event_participants_member_id_idx" ON "calendar_event_participants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_organization_id_idx" ON "calendar_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_client_id_idx" ON "calendar_events" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_start_at_idx" ON "calendar_events" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_calendar_accounts_user_id_idx" ON "member_calendar_accounts" USING btree ("user_id");