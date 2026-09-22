-- Tenant foundation: additive and reversible at the application level.
-- Existing single-agency data is assigned to one default organization first;
-- NOT NULL constraints are intentionally deferred until the backfill is
-- verified in production.
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "organization_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'collaborator' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "organization_members_org_user_unique" UNIQUE("organization_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "organization_members_user_id_idx" ON "organization_members" ("user_id");
CREATE INDEX IF NOT EXISTS "organization_members_organization_id_idx" ON "organization_members" ("organization_id");

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL;
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "automations_organization_id_idx" ON "automations" ("organization_id");

INSERT INTO "organizations" (name, slug)
VALUES ('Desigual OS', 'default')
ON CONFLICT (slug) DO NOTHING;

UPDATE "clients"
SET "organization_id" = (SELECT id FROM organizations WHERE slug = 'default')
WHERE "organization_id" IS NULL;

INSERT INTO "organization_members" (organization_id, user_id, role)
SELECT o.id, u.id,
       CASE WHEN EXISTS (
         SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id AND r.name = 'master'
       ) THEN 'owner' ELSE 'collaborator' END
FROM organizations o CROSS JOIN users u
WHERE o.slug = 'default'
ON CONFLICT (organization_id, user_id) DO NOTHING;

UPDATE "automations" a
SET "organization_id" = COALESCE(
  (SELECT c.organization_id FROM clients c WHERE c.id = a.client_id),
  (SELECT id FROM organizations WHERE slug = 'default')
)
WHERE "organization_id" IS NULL;
