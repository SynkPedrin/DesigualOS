CREATE TABLE IF NOT EXISTS "ge_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid,
	"proposal_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"total_cents" bigint NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"party_id" uuid,
	"party_label" text,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"competence_date" date,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"paid_at" date,
	"paid_amount_cents" bigint,
	"account_id" uuid,
	"category_id" uuid,
	"cost_center_id" uuid,
	"installment_group_id" uuid,
	"installment_no" integer,
	"installment_total" integer,
	"recurrence_id" uuid,
	"doc_number" text,
	"related_kind" text,
	"related_ref" text,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"source" text,
	"source_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'banco' NOT NULL,
	"opening_balance_cents" bigint,
	"opening_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'em_staging' NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"source_key" text NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb NOT NULL,
	"status" text NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_party_id" uuid,
	"applied_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"entry_id" uuid,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"transfer_id" uuid,
	"reverses_id" uuid,
	"memo" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_media_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"media_type" text,
	"coverage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"document" text,
	"raw_document" text,
	"document_kind" text,
	"document_valid" boolean,
	"email" text,
	"phone" text,
	"city" text,
	"state" text,
	"status" text DEFAULT 'ativo' NOT NULL,
	"notes" text,
	"client_id" uuid,
	"source" text,
	"source_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_party_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_production_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"entry_id" uuid,
	"incurred_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"request_id" uuid,
	"quote_id" uuid,
	"supplier_id" uuid,
	"party_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'aberta' NOT NULL,
	"sale_cents" bigint,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_production_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"supplier_id" uuid,
	"total_cents" bigint NOT NULL,
	"lead_time_days" integer,
	"status" text DEFAULT 'recebida' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_production_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'aberta' NOT NULL,
	"due_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_proposal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"valid_until" date,
	"notes" text,
	"created_by" uuid,
	"source" text,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_recurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"party_id" uuid,
	"amount_cents" bigint NOT NULL,
	"category_id" uuid,
	"cost_center_id" uuid,
	"account_id" uuid,
	"frequency" text NOT NULL,
	"day_of_month" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"generated_until" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid,
	"proposal_id" uuid,
	"contract_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"total_cents" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'venda' NOT NULL,
	"unit" text,
	"default_price_cents" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ge_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"posted_on" date NOT NULL,
	"description" text,
	"amount_cents" bigint NOT NULL,
	"external_key" text NOT NULL,
	"ledger_id" uuid,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_categories" ADD CONSTRAINT "ge_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_categories" ADD CONSTRAINT "ge_categories_parent_id_ge_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ge_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_contracts" ADD CONSTRAINT "ge_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_contracts" ADD CONSTRAINT "ge_contracts_party_id_ge_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_contracts" ADD CONSTRAINT "ge_contracts_proposal_id_ge_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."ge_proposals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_contracts" ADD CONSTRAINT "ge_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_cost_centers" ADD CONSTRAINT "ge_cost_centers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_party_id_ge_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_account_id_ge_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ge_financial_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_category_id_ge_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ge_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_cost_center_id_ge_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."ge_cost_centers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_recurrence_id_ge_recurrences_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."ge_recurrences"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_financial_accounts" ADD CONSTRAINT "ge_financial_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_import_batches" ADD CONSTRAINT "ge_import_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_import_batches" ADD CONSTRAINT "ge_import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_import_rows" ADD CONSTRAINT "ge_import_rows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_import_rows" ADD CONSTRAINT "ge_import_rows_batch_id_ge_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ge_import_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_import_rows" ADD CONSTRAINT "ge_import_rows_resolved_party_id_ge_parties_id_fk" FOREIGN KEY ("resolved_party_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_import_rows" ADD CONSTRAINT "ge_import_rows_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_ledger" ADD CONSTRAINT "ge_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_ledger" ADD CONSTRAINT "ge_ledger_account_id_ge_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ge_financial_accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_ledger" ADD CONSTRAINT "ge_ledger_entry_id_ge_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ge_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_ledger" ADD CONSTRAINT "ge_ledger_reverses_id_ge_ledger_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."ge_ledger"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_ledger" ADD CONSTRAINT "ge_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_media_vehicles" ADD CONSTRAINT "ge_media_vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_media_vehicles" ADD CONSTRAINT "ge_media_vehicles_party_id_ge_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."ge_parties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_parties" ADD CONSTRAINT "ge_parties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_parties" ADD CONSTRAINT "ge_parties_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_parties" ADD CONSTRAINT "ge_parties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_party_roles" ADD CONSTRAINT "ge_party_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_party_roles" ADD CONSTRAINT "ge_party_roles_party_id_ge_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."ge_parties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_costs" ADD CONSTRAINT "ge_production_costs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_costs" ADD CONSTRAINT "ge_production_costs_order_id_ge_production_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."ge_production_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_costs" ADD CONSTRAINT "ge_production_costs_entry_id_ge_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ge_entries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_orders" ADD CONSTRAINT "ge_production_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_orders" ADD CONSTRAINT "ge_production_orders_request_id_ge_production_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ge_production_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_orders" ADD CONSTRAINT "ge_production_orders_quote_id_ge_production_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."ge_production_quotes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_orders" ADD CONSTRAINT "ge_production_orders_supplier_id_ge_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_orders" ADD CONSTRAINT "ge_production_orders_party_id_ge_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_orders" ADD CONSTRAINT "ge_production_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_quotes" ADD CONSTRAINT "ge_production_quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_quotes" ADD CONSTRAINT "ge_production_quotes_request_id_ge_production_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ge_production_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_quotes" ADD CONSTRAINT "ge_production_quotes_supplier_id_ge_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_requests" ADD CONSTRAINT "ge_production_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_requests" ADD CONSTRAINT "ge_production_requests_party_id_ge_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_production_requests" ADD CONSTRAINT "ge_production_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_proposal_items" ADD CONSTRAINT "ge_proposal_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_proposal_items" ADD CONSTRAINT "ge_proposal_items_proposal_id_ge_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."ge_proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_proposal_items" ADD CONSTRAINT "ge_proposal_items_service_id_ge_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."ge_services"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_proposals" ADD CONSTRAINT "ge_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_proposals" ADD CONSTRAINT "ge_proposals_party_id_ge_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_proposals" ADD CONSTRAINT "ge_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_recurrences" ADD CONSTRAINT "ge_recurrences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_recurrences" ADD CONSTRAINT "ge_recurrences_party_id_ge_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_recurrences" ADD CONSTRAINT "ge_recurrences_category_id_ge_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ge_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_recurrences" ADD CONSTRAINT "ge_recurrences_cost_center_id_ge_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."ge_cost_centers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_recurrences" ADD CONSTRAINT "ge_recurrences_account_id_ge_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ge_financial_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_sales_orders" ADD CONSTRAINT "ge_sales_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_sales_orders" ADD CONSTRAINT "ge_sales_orders_party_id_ge_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."ge_parties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_sales_orders" ADD CONSTRAINT "ge_sales_orders_proposal_id_ge_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."ge_proposals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_sales_orders" ADD CONSTRAINT "ge_sales_orders_contract_id_ge_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."ge_contracts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_sales_orders" ADD CONSTRAINT "ge_sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_services" ADD CONSTRAINT "ge_services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_statement_lines" ADD CONSTRAINT "ge_statement_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_statement_lines" ADD CONSTRAINT "ge_statement_lines_account_id_ge_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ge_financial_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ge_statement_lines" ADD CONSTRAINT "ge_statement_lines_ledger_id_ge_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ge_ledger"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_categories_name_uq" ON "ge_categories" USING btree ("organization_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_contracts_number_uq" ON "ge_contracts" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_cost_centers_name_uq" ON "ge_cost_centers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_entries_due_idx" ON "ge_entries" USING btree ("organization_id","kind","status","due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_entries_party_idx" ON "ge_entries" USING btree ("organization_id","party_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_entries_competence_idx" ON "ge_entries" USING btree ("organization_id","competence_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_entries_group_idx" ON "ge_entries" USING btree ("installment_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_entries_source_uq" ON "ge_entries" USING btree ("organization_id","source","source_key") WHERE "ge_entries"."source_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_financial_accounts_name_uq" ON "ge_financial_accounts" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_import_batches_file_uq" ON "ge_import_batches" USING btree ("organization_id","kind","sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_import_rows_batch_idx" ON "ge_import_rows" USING btree ("batch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_import_rows_key_uq" ON "ge_import_rows" USING btree ("batch_id","source_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_ledger_account_idx" ON "ge_ledger" USING btree ("organization_id","account_id","occurred_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_ledger_entry_idx" ON "ge_ledger" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_ledger_reverses_uq" ON "ge_ledger" USING btree ("reverses_id") WHERE "ge_ledger"."reverses_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_media_vehicles_party_uq" ON "ge_media_vehicles" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_parties_org_idx" ON "ge_parties" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_parties_doc_idx" ON "ge_parties" USING btree ("organization_id","document");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_parties_name_idx" ON "ge_parties" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_parties_source_uq" ON "ge_parties" USING btree ("organization_id","source","source_key") WHERE "ge_parties"."source_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_party_roles_uq" ON "ge_party_roles" USING btree ("party_id","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_party_roles_org_idx" ON "ge_party_roles" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_production_costs_order_idx" ON "ge_production_costs" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_production_orders_number_uq" ON "ge_production_orders" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_production_quotes_request_idx" ON "ge_production_quotes" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_production_requests_number_uq" ON "ge_production_requests" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_proposal_items_proposal_idx" ON "ge_proposal_items" USING btree ("proposal_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_proposals_number_uq" ON "ge_proposals" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_proposals_org_idx" ON "ge_proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_proposals_source_uq" ON "ge_proposals" USING btree ("organization_id","source","source_key") WHERE "ge_proposals"."source_key" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_recurrences_org_idx" ON "ge_recurrences" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_sales_orders_number_uq" ON "ge_sales_orders" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_services_org_idx" ON "ge_services" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_statement_lines_key_uq" ON "ge_statement_lines" USING btree ("organization_id","account_id","external_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ge_statement_lines_date_idx" ON "ge_statement_lines" USING btree ("organization_id","account_id","posted_on");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ge_statement_lines_ledger_uq" ON "ge_statement_lines" USING btree ("ledger_id") WHERE "ge_statement_lines"."ledger_id" is not null;
--> statement-breakpoint
ALTER TABLE "ge_parties" ADD CONSTRAINT "ge_parties_status_ck" CHECK (status in ('ativo','inativo'));
--> statement-breakpoint
ALTER TABLE "ge_parties" ADD CONSTRAINT "ge_parties_kind_ck" CHECK (document_kind is null or document_kind in ('cpf','cnpj','outro'));
--> statement-breakpoint
ALTER TABLE "ge_party_roles" ADD CONSTRAINT "ge_party_roles_role_ck" CHECK (role in ('cliente','fornecedor','veiculo_midia','prestador','colaborador'));
--> statement-breakpoint
ALTER TABLE "ge_services" ADD CONSTRAINT "ge_services_kind_ck" CHECK (kind in ('venda','compra'));
--> statement-breakpoint
ALTER TABLE "ge_services" ADD CONSTRAINT "ge_services_price_ck" CHECK (default_price_cents is null or default_price_cents >= 0);
--> statement-breakpoint
ALTER TABLE "ge_financial_accounts" ADD CONSTRAINT "ge_financial_accounts_kind_ck" CHECK (kind in ('banco','caixa','carteira','cartao'));
--> statement-breakpoint
ALTER TABLE "ge_categories" ADD CONSTRAINT "ge_categories_kind_ck" CHECK (kind in ('receita','despesa'));
--> statement-breakpoint
ALTER TABLE "ge_recurrences" ADD CONSTRAINT "ge_recurrences_kind_ck" CHECK (kind in ('receita','despesa'));
--> statement-breakpoint
ALTER TABLE "ge_recurrences" ADD CONSTRAINT "ge_recurrences_freq_ck" CHECK (frequency in ('mensal','bimestral','trimestral','semestral','anual','semanal'));
--> statement-breakpoint
ALTER TABLE "ge_recurrences" ADD CONSTRAINT "ge_recurrences_amount_ck" CHECK (amount_cents > 0);
--> statement-breakpoint
ALTER TABLE "ge_recurrences" ADD CONSTRAINT "ge_recurrences_day_ck" CHECK (day_of_month is null or (day_of_month between 1 and 31));
--> statement-breakpoint
ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_kind_ck" CHECK (kind in ('receita','despesa'));
--> statement-breakpoint
ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_status_ck" CHECK (status in ('aberto','quitado','cancelado'));
--> statement-breakpoint
ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_amount_ck" CHECK (amount_cents > 0);
--> statement-breakpoint
ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_paid_ck" CHECK ((status = 'quitado') = (paid_at is not null));
--> statement-breakpoint
ALTER TABLE "ge_entries" ADD CONSTRAINT "ge_entries_installment_ck" CHECK (installment_no is null or (installment_no >= 1 and installment_total >= installment_no));
--> statement-breakpoint
ALTER TABLE "ge_ledger" ADD CONSTRAINT "ge_ledger_kind_ck" CHECK (kind in ('recebimento','pagamento','transferencia','estorno','ajuste'));
--> statement-breakpoint
ALTER TABLE "ge_ledger" ADD CONSTRAINT "ge_ledger_amount_ck" CHECK (amount_cents <> 0);
--> statement-breakpoint
ALTER TABLE "ge_statement_lines" ADD CONSTRAINT "ge_statement_lines_amount_ck" CHECK (amount_cents <> 0);
--> statement-breakpoint
ALTER TABLE "ge_proposals" ADD CONSTRAINT "ge_proposals_status_ck" CHECK (status in ('rascunho','enviada','aprovada','recusada','expirada','cancelada'));
--> statement-breakpoint
ALTER TABLE "ge_proposal_items" ADD CONSTRAINT "ge_proposal_items_qty_ck" CHECK (quantity > 0);
--> statement-breakpoint
ALTER TABLE "ge_proposal_items" ADD CONSTRAINT "ge_proposal_items_price_ck" CHECK (unit_price_cents >= 0 and discount_cents >= 0);
--> statement-breakpoint
ALTER TABLE "ge_proposal_items" ADD CONSTRAINT "ge_proposal_items_discount_ck" CHECK (discount_cents <= unit_price_cents * quantity);
--> statement-breakpoint
ALTER TABLE "ge_contracts" ADD CONSTRAINT "ge_contracts_status_ck" CHECK (status in ('rascunho','vigente','encerrado','cancelado'));
--> statement-breakpoint
ALTER TABLE "ge_contracts" ADD CONSTRAINT "ge_contracts_total_ck" CHECK (total_cents >= 0);
--> statement-breakpoint
ALTER TABLE "ge_contracts" ADD CONSTRAINT "ge_contracts_dates_ck" CHECK (ends_on is null or starts_on is null or ends_on >= starts_on);
--> statement-breakpoint
ALTER TABLE "ge_sales_orders" ADD CONSTRAINT "ge_sales_orders_status_ck" CHECK (status in ('aberto','faturado','cancelado'));
--> statement-breakpoint
ALTER TABLE "ge_sales_orders" ADD CONSTRAINT "ge_sales_orders_total_ck" CHECK (total_cents >= 0);
--> statement-breakpoint
ALTER TABLE "ge_production_requests" ADD CONSTRAINT "ge_production_requests_status_ck" CHECK (status in ('aberta','cotando','aprovada','cancelada'));
--> statement-breakpoint
ALTER TABLE "ge_production_quotes" ADD CONSTRAINT "ge_production_quotes_status_ck" CHECK (status in ('recebida','escolhida','descartada'));
--> statement-breakpoint
ALTER TABLE "ge_production_quotes" ADD CONSTRAINT "ge_production_quotes_total_ck" CHECK (total_cents >= 0);
--> statement-breakpoint
ALTER TABLE "ge_production_orders" ADD CONSTRAINT "ge_production_orders_status_ck" CHECK (status in ('aberta','em_producao','entregue','cancelada'));
--> statement-breakpoint
ALTER TABLE "ge_production_orders" ADD CONSTRAINT "ge_production_orders_sale_ck" CHECK (sale_cents is null or sale_cents >= 0);
--> statement-breakpoint
ALTER TABLE "ge_production_costs" ADD CONSTRAINT "ge_production_costs_amount_ck" CHECK (amount_cents > 0);
--> statement-breakpoint
ALTER TABLE "ge_import_batches" ADD CONSTRAINT "ge_import_batches_kind_ck" CHECK (kind in ('clientes','fornecedores','veiculos_midia','lancamentos'));
--> statement-breakpoint
ALTER TABLE "ge_import_batches" ADD CONSTRAINT "ge_import_batches_status_ck" CHECK (status in ('em_staging','aplicado','descartado'));
--> statement-breakpoint
ALTER TABLE "ge_import_rows" ADD CONSTRAINT "ge_import_rows_status_ck" CHECK (status in ('novo','duplicado_provavel','invalido','precisa_vinculo','aplicado','ignorado'));
