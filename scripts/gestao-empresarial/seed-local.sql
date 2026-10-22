-- Dados mínimos do banco LOCAL da Gestão Empresarial: uma empresa, um administrador e um colaborador.
-- Os IDs são os mesmos de auth-local.mjs. Idempotente: pode rodar quantas vezes quiser.
insert into organizations (id, name, slug) values ('00000000-0000-4000-8000-0000000000c0', 'Desigual (local)', 'desigual-local') on conflict (id) do nothing;

insert into users (auth_user_id, email, name, organizacao_ativa_id) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@local.test', 'Admin Local', '00000000-0000-4000-8000-0000000000c0'),
  ('00000000-0000-4000-8000-0000000000b2', 'colaborador@local.test', 'Colaborador Local', '00000000-0000-4000-8000-0000000000c0')
on conflict (auth_user_id) do nothing;

insert into user_roles (user_id, role_id)
select u.id, r.id from users u join roles r on r.name = (case u.email when 'admin@local.test' then 'master' else 'colaborador' end)::role_name
where u.email in ('admin@local.test', 'colaborador@local.test') and not exists (select 1 from user_roles x where x.user_id = u.id and x.role_id = r.id);

insert into organization_members (organization_id, user_id, role)
select '00000000-0000-4000-8000-0000000000c0', u.id, case u.email when 'admin@local.test' then 'owner' else 'collaborator' end
from users u where u.email in ('admin@local.test', 'colaborador@local.test')
  and not exists (select 1 from organization_members m where m.user_id = u.id and m.organization_id = '00000000-0000-4000-8000-0000000000c0');
