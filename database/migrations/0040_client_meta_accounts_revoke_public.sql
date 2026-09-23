-- client_meta_accounts (0039_jarbas_chat_operability.sql) foi aplicada sem a
-- cerca de acesso público que 0037_restrict_public_data_api.sql e
-- 0038_jarbas_persistent_tasks.sql já aplicam às demais tabelas de
-- aplicação — mesmo motivo do NOTA em 0038: tabela nova não é coberta pelo
-- REVOKE em massa de 0037 porque ela não existia quando ele rodou. Contém
-- ID de conta de mídia (Meta Ads accountId) — não pode ficar exposta ao
-- PostgREST (anon/authenticated) por omissão. Verificado em 23/09/2026:
-- anon e authenticated tinham SELECT/INSERT/UPDATE/DELETE nela antes desta
-- migração.
DO $$
DECLARE principal text;
BEGIN
  FOREACH principal IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'client_meta_accounts', principal);
    END IF;
  END LOOP;
  REVOKE ALL ON TABLE public.client_meta_accounts FROM PUBLIC;
END $$;
