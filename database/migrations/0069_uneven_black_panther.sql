ALTER TABLE "pipeline_boards" ADD COLUMN "client_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_boards" ADD CONSTRAINT "pipeline_boards_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_boards_client_idx" ON "pipeline_boards" USING btree ("client_id");