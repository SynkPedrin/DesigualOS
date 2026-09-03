---
tags: [fase, desigual-os]
fase: 13
status: parcial
---

# Fase 13 - Auth + Auditoria completa

## Escopo

Login, JWT, papéis master/colaborador, `audit_logs` em toda ação relevante.

## Reordenação

Adiantada pra logo depois da [[Fase 04 - Bento Node]] (em vez de por último), porque o usuário já tinha configurado as credenciais do Supabase esperando login funcionando. Ver [[99 - Pendencias]].

## O que já está pronto (parte de Auth)

- `packages/auth`: valida o `access_token` do Supabase Auth contra o JWKS do projeto (`jose`, ver [[0001 - Supabase Completo]] e ADR 0003 em `docs/architecture/decisions`), sem segredo compartilhado.
- Provisionamento just-in-time: primeira vez que o token de um usuário chega, cria a linha em `users` (ligada por `auth_user_id`) e atribui o papel (`master` se o e-mail estiver em `MASTER_USER_EMAILS`, senão `colaborador`).
- `GET /me` no Orchestrator, protegido, devolve perfil + papéis + permissões resolvidas.
- RBAC seedado: `master` tem `*`/`*` (curinga), `colaborador` tem permissões operacionais específicas (chat:write, executions:read, clients:read, studio:write, knowledge:read).
- Testado de ponta a ponta com usuários reais: criei 2 usuários de teste via Supabase Admin API, logei de verdade (`/auth/v1/token?grant_type=password`), chamei `GET /me` com o token real e confirmei papel + permissões corretas pros dois casos (colaborador e master). Testei também 401 pra token ausente/inválido. Apaguei os usuários de teste (Supabase Auth e nossa tabela `users`) depois de validar.

## O que falta (fica pra quando as rotas de negócio existirem, Fases 5-12)

- `audit_logs` em toda ação relevante (regra de ouro 7): ainda não tem nenhuma rota de negócio que precise ser auditada (chat, execuções, tool calls). Vou escrever em `audit_logs` conforme essas rotas forem sendo construídas, não faz sentido isolado agora.
- `requirePermission()` já existe em `apps/api/src/auth/middleware.ts`, mas ainda não está sendo usado em nenhuma rota (as únicas rotas que existem hoje são node-to-node e `/me`, que não precisam de RBAC por recurso). Vai ser aplicado nas rotas de negócio conforme elas nascerem.

## Arquivos criados

`packages/auth/*` (supabase-jwt, provisioning, rbac), `apps/api/src/auth/middleware.ts`, `apps/api/src/auth/routes.ts`, seed de `permissions` em `packages/database/src/seed.ts`, `MASTER_USER_EMAILS` no `.env`.
