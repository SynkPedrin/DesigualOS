---
tags: [adr, supabase, desigual-os]
adr: 1
status: aceito
data: 2026-09-01
---

# ADR 0001: Usar Supabase completo (Postgres, Auth e Storage)

Espelho de `docs/architecture/decisions/0001-supabase-completo.md` no monorepo. Editar os dois em conjunto.

## Contexto

O plano original ([[02 - Stack Tecnologica]]) previa Postgres self-hosted via Docker, Auth/JWT custom e MinIO/S3 como storage. O usuário forneceu um projeto Supabase já criado (`dddchncdrgbhdirytdsp`) com chaves de API e escolheu usar a plataforma completa em vez de hospedar essas peças por conta própria.

## Decisão

- **Postgres:** banco do Orchestrator é o Postgres do Supabase, acessado via `DATABASE_URL` direta pelo Drizzle. Modelo de dados de [[05 - Modelo de Dados]] não muda.
- **Auth:** login e sessão via Supabase Auth. `users` vira tabela de perfil com `auth_user_id`. RBAC (roles/permissions/user_roles) continua modelado e aplicado pelo Orchestrator. Wiring completo na [[Fase 13 - Auth e Auditoria]].
- **Storage:** assets do [[Studio]] vão para o Supabase Storage em vez de MinIO. `docker-compose.yml` só sobe Redis em dev.
- Chaves de API dos modelos e integrações (ClickUp, Meta, Instagram) continuam fora do Supabase, como segredos do Orchestrator.

## Consequência

- Dev depende de rede externa mesmo localmente (Postgres/Auth/Storage são serviços gerenciados).
- Cadeia de acesso da seção 6.8 muda o primeiro passo: valida JWT do Supabase Auth, depois aplica RBAC próprio via `auth_user_id`.
- `sb_secret_...` tem acesso administrativo total ao projeto (bypassa RLS). Fica só em `.env`, nunca commitado, conforme [[01 - Regras de Ouro]] regra 6.
- Regra de ouro 1 não é afetada: Storage guarda só assets do Studio, não conhecimento dos agentes.

## Addendum: Session Pooler em vez de Direct Connection

O host de conexão direta (`db.<ref>.supabase.co`) só resolve por IPv6 (padrão atual do Supabase sem o add-on de IPv4 pago). `DATABASE_URL` usa o Session Pooler (`aws-0-us-east-1.pooler.supabase.com:5432`, usuário `postgres.<project-ref>`) para funcionar em qualquer rede IPv4, sem os problemas de DDL que o Transaction Pooler pode ter. Conexão validada manualmente em 2026-09-01 (Postgres 17.6).

## Status

`DATABASE_URL` configurado e testado com sucesso. Ver [[99 - Pendencias]] para o que ainda falta (instalar Node/pnpm/Docker para rodar `db:migrate` e `db:seed` de verdade).
