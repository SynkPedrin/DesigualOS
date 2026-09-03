ALTER TABLE "clients" RENAME COLUMN "clickup_space_id" TO "clickup_list_id";--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT "clients_clickup_space_id_unique";--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_clickup_list_id_unique" UNIQUE("clickup_list_id");