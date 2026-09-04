---
tags: [pendencias, desigual-os]
status: living-document
---

# Pendências

Notas ativas do estado atual do projeto. Atualizada conforme o trabalho avança.

## Desbloqueio Jarbas/Suzy + ClickUp + automações (2026-09-03, sessão Kimi)

- **`POST /internal/ask` deployado nas máquinas do Jarbas e da Suzy** (autorizado pelo usuário nesta sessão; era o bloqueante nº 1 desde 02/set): cada agente expõe `answerQuestion()` reusando o cérebro real do WhatsApp (Suzy: bentoAsk/openclawBrain/ollamaChat; Jarbas: generateResponse). Token único novo em `API_KEYS` com permission `internal_ask` (mesmo nas duas máquinas; credenciais antigas preservadas, nada rotacionado). Backups `.bak-20260903` em cada arquivo editado.
- **Worker despacha Jarbas/Suzy de verdade**: novo client `askAgent` em `packages/tool-gateway/src/agent-ask-client.ts` (env `JARBAS_ASK_URL`, `SUZY_ASK_URL`, `AGENTES_ASK_TOKEN`), branch em `execute-job.ts` antes do `/execute` genérico. Validado E2E: chat privado, chats públicos (mesmo pipeline) e automação agendada, tudo com resposta real dos agentes.
- **ClickUp: menções @Jarbas e @Suzy** agora respondidas pelo webhook (`detectMentionedAgent` + `respondAsAgent` em `apps/api/src/lib/agent-mention.ts`), mesmo fluxo do @Bento. Validado E2E com assinatura HMAC real e resposta postada numa task de teste (86bbuk847, lista Enxame). `CLICKUP_WEBHOOK_SECRET` de dev gerado (estava vazio); registrar webhook real continua dependendo de URL pública (deploy na VPS).
- **Bug real corrigido**: `DELETE /automations/:id` retornava 204 mas deixava o repeatable job órfão no Redis — o `jobId` dentro de `repeatOpts` é sobrescrito por `undefined` no `Object.assign` interno do BullMQ 5.81; corrigido passando o jobId no 3º argumento de `removeRepeatable`. Órfãos removidos.
- **Automações agora levam contexto** (cliente, tom de voz, histórico): `run-automation.ts` usa `buildContext`/`formatContextForPrompt` igual ao `POST /chat`. Antes o Jarbas respondia "sobre qual cliente?" numa automação com cliente vinculado.
- **Workspace de cliente (frontend)**: removido embed/iframe do ClickUp (tasks abrem direto no ClickUp), aba Conversas passou a mostrar os comentários das tasks do ClickUp (novo `GET /clickup/tasks/:id/comments`), aba Studio removida de dentro do cliente (a página /studio continua).
- **Commit inicial do repo** (estava zero commits, risco máximo): tudo protegido em `main`.
- **Limitações externas que continuam**: Bento depende de OpenAI sem créditos (429, decisão do usuário ignorar); `ANTHROPIC_API_KEY` vazia no `.env`, então a copy de marketing do Studio sai null por design e o classifier do Router cai nas regras. Em dev, os IPs Tailscale foram apontados pros túneis SSH locais no `.env` (BENTO_QA_URL=localhost:8791 etc.) porque este Mac está fora da tailnet.

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
