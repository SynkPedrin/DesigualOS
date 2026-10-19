ALTER TABLE "mcp_tokens" ADD COLUMN "actor_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_actor_identity_id_operational_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."operational_identities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_tokens_actor_identity_id_idx" ON "mcp_tokens" USING btree ("actor_identity_id");