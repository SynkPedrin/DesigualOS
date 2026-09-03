---
tags: [pendencias, desigual-os]
status: living-document
---

# Pendências

Notas ativas do estado atual do projeto. Atualizada conforme o trabalho avança.

## Status geral do backend (2026-09-01, atualizado)

Concluídas e validadas com infraestrutura real (Postgres/Supabase, Redis, BullMQ, Supabase Storage, nodes reais ou fakes conforme o caso): [[Fase 01 - Core e Database]], [[Fase 02 - Node Protocol e Node Agent base]], [[Fase 03 - Node Registry, Discovery e Health]], [[Fase 04 - Bento Node]], [[Fase 05 - Jarbas Node]], [[Fase 06 - Suzy Node]], [[Fase 07 - Studio Node e GPU Worker]], [[Fase 08 - AI Router]], [[Fase 09 - Queue e Orchestrator]], [[Fase 10 - Workflow Engine]], e a parte de Auth da [[Fase 13 - Auth e Auditoria]] (adiantada).

Parciais: [[Fase 11 - Context Engine e Token Cost Engine]] (Token & Cost Engine pronto e testado; falta o Context Engine em si e `economy_records`), [[Fase 12 - Tool Gateway e RBAC]] (RBAC de usuário pronto e em uso numa rota; falta o Tool Gateway central e aprovação humana).

Ainda faltam: resto da auditoria da Fase 13 (cobrir mais ações sensíveis além de execuções), e as Fases 14 a 17 (Frontend é de outra sessão, Security Hardening, Testing, Deployment).

## Ajustes finos pedidos pelo frontend (2026-09-01)

Enquanto revisava os contratos com a sessão do frontend (`docs/api-gaps.md`), corrigi coisas reais no caminho: `GET /executions` agora aceita `?client_id=` e devolve `client_id` (lista e detalhe); `POST /studio/jobs.type` virou enum de verdade (`STUDIO_JOB_TYPES` em `@desigual-os/types`: image/carousel/video/reels/upscale) em vez de string livre; `GET /clients`, `GET /clients/:id` e `POST /clients` (RBAC `clients:read`/`clients:write`) existem agora; e um bug real que só apareceu testando com input inválido: erro de validação Zod virava `500 Internal Server Error` em vez de `400`, corrigido com um error handler global no Fastify (`apps/api/src/server.ts`) que sempre devolve `{ error, details }` com 400 pra qualquer `ZodError`.

Pipeline ponta a ponta já funciona de verdade: `POST /chat` → Router → circuit breaker de node saudável → fila BullMQ → worker → `POST /execute` no node → grava tokens/status/custo/auditoria, tanto pra agente único quanto pra workflow multi agente encadeado. `POST /studio/jobs` → fila própria → `studio-node` → upload real no Supabase Storage → progresso ao vivo via WebSocket (`/ws`, Redis pub/sub). `GET /costs/*` reflete custo real calculado a partir de tokens reais.

## Ainda pendente para o Design System (não bloqueia código, só o visual)

- [ ] Logo do [[Studio]] (quarto agente).
- [ ] Mockup 1: Dashboard admin (cards de topo, donut de tokens por agente, economia real vs estimada, tabela de consumo por modelo, top usuários, projeção 30 dias, painel de saúde do sistema).
- [ ] Mockup 2: Home / Chat / Agentes (hero "Intelligence Operating System", seletor de agente com AUTO em destaque, painel de agentes, chat com estados de "pensando", histórico, visão de cliente com Investimento/Conversões/CPA/ROAS).

Decisão do usuário em 2026-09-01: seguir com o código sem esperar esses três (mudou a decisão original de esperar). Ajusto [[07 - Design System]] com o hex real de `--color-sinal` quando os mockups chegarem, isso só afeta a [[Fase 14 - Frontend]].

## Recebido até agora

- `assets/Desiguaal OS - logo.png` (wordmark desigual OS, confirma dark mode)
- `assets/bento-logo.png`
- `assets/jarbas-logo.png`
- `assets/suzy-logo.png`

## Reordenação do plano (2026-09-01)

O usuário confirmou (via a sessão do frontend) que já colocou as credenciais do Supabase esperando login funcionando. Estou adiantando [[Fase 13 - Auth e Auditoria]] (login/signup via Supabase Auth, `GET /me`, RBAC) pra logo depois da [[Fase 04 - Bento Node]], em vez de deixar por último como o prompt mestre original propunha. As Fases 5 a 12 seguem depois, na ordem original.

## Decisões já tomadas com o usuário

- Vault Obsidian: criar um novo aqui em `brain/`, não vincular vault existente.
- Monorepo: fica em `~/Downloads/Desigual OS` (mesma pasta deste vault), não move de lugar.
- [[0001 - Supabase Completo]]: Postgres, Auth e Storage via Supabase em vez de self-hosted (2026-09-01).
