-- Memberships are administered through the trusted backend, never through
-- the Supabase public data API. RLS alone does not block TRUNCATE privileges.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organizations, organization_members FROM PUBLIC;
DO $$
DECLARE principal text;
BEGIN
  FOREACH principal IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal) THEN
      EXECUTE format('REVOKE ALL ON organizations, organization_members FROM %I', principal);
    END IF;
  END LOOP;
END $$;
