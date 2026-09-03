CREATE TABLE IF NOT EXISTS "direct_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"content" text,
	"attachment_url" text,
	"attachment_type" text,
	"attachment_filename" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "language" text DEFAULT 'pt-BR' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachment_url" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachment_type" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachment_filename" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
