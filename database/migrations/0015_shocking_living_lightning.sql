CREATE TABLE IF NOT EXISTS "direct_message_thread_prefs" (
	"user_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"favorited_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_message_thread_prefs_user_id_partner_id_pk" PRIMARY KEY("user_id","partner_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "direct_message_thread_prefs" ADD CONSTRAINT "direct_message_thread_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "direct_message_thread_prefs" ADD CONSTRAINT "direct_message_thread_prefs_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "direct_message_thread_prefs_user_idx" ON "direct_message_thread_prefs" USING btree ("user_id");