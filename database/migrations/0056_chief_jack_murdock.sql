ALTER TABLE "client_users" DROP CONSTRAINT "client_users_client_id_user_id_unique";--> statement-breakpoint
ALTER TABLE "client_users" ADD COLUMN "responsibility" text;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_client_id_user_id_responsibility_unique" UNIQUE("client_id","user_id","responsibility");