-- Roda no banco NOVO. Variáveis: :'antigo' (ref atual) e :'novo' (ref novo).
-- Troca links do Storage do projeto antigo pelos do novo. audit_logs fica de fora: é histórico.
\set ON_ERROR_STOP on
begin;
select format(
  'update public.%I set %I = replace(%I::text, %L, %L)::%s where %I::text like %L',
  c.table_name, c.column_name, c.column_name,
  :'antigo' || '.supabase.co', :'novo' || '.supabase.co',
  case when c.data_type = 'ARRAY' then c.udt_name::regtype::text else c.data_type end,
  c.column_name, '%' || :'antigo' || '%'
)
from information_schema.columns c
where c.table_schema = 'public' and c.table_name <> 'audit_logs'
  and c.data_type in ('text', 'jsonb', 'json', 'character varying', 'ARRAY')
\gexec
commit;
