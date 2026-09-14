# Desigual OS — Context Recovery

> Documento gerado em 2026-09-03 pelo Kimi Code, a partir da análise integral das sessões anteriores do Claude Code (`~/.claude/projects/-Users-pedro-Downloads-Desigual-OS/` e `~/.claude/projects/-Users-pedro-Downloads-LP---DESIGUAL-OS/`) e do código atual dos dois diretórios de projeto.
> Regra seguida: nada aqui foi inventado. Onde a informação não existe, está escrito "Não encontrado no histórico/código".

---

## 1. Resumo executivo

O Desigual OS é um **sistema operacional de IA da Agência Desigual**: um Orchestrator (Fastify) + AI Router que coordenam 4 agentes (Bento, Jarbas, Suzy, Studio), cada um rodando em hardware dedicado (3 Mac Minis + 1 PC Windows com RTX 4090), interligados via Tailscale, com frontend Next.js, Postgres/Auth/Storage no Supabase, filas BullMQ+Redis e integração profunda com ClickUp.

O projeto foi construído entre **31/ago e 03/set/2026** por múltiplas sessões paralelas do Claude Code (backend, frontend, QA) que se coordenavam via mensagens cross-session e um vault Obsidian (`brain/`). O sistema está **majoritariamente funcional em ambiente dev**: chat com Router funcionando com o Bento real, Studio gerando imagens reais via ComfyUI/Flux, auth + RBAC + recuperação de senha, automações agendadas, ClickUp (OAuth + webhook + sync de ~50 clientes), custos em USD, monitoramento com probes reais.

**As sessões do Claude terminaram sempre por limite de uso (rate limit), nunca por conclusão.** O último estado conhecido (03/set ~14:40 horário local): duas perguntas do usuário sem resposta, um deploy crítico aguardando autorização (Node Agent nas máquinas do Jarbas e da Suzy) e uma correção na LP aplicada sem validação.

**Riscos imediatos:** (1) o monorepo principal **não tem nenhum commit git** — todo o trabalho existe só no working tree; (2) credenciais reais em plaintext nos arquivos de sessão e no `.env`; (3) Jarbas e Suzy não respondem no chat (bloqueante conhecido).

Além do sistema, existe uma **landing page** (`/Users/pedro/Downloads/LP - DESIGUAL OS`) completa, com `/cadastro` que cria contas reais no mesmo Supabase Auth do app, planejada para ser absorvida pelo monorepo.

---

## 2. Histórico das sessões do Claude Code

**11 sessões encontradas** (10 no projeto principal + 1 na LP). Horários em horário local (UTC-3).

### Projeto principal (`/Users/pedro/DesigualOS`)

| # | Sessão | Período | Tamanho | Papel | Relevância |
|---|--------|---------|---------|-------|-----------|
| 1 | `8693fcd5` | 01/set 13:51 → 02/set 00:14 | 23MB | Frontend principal ("desigual-os-c2") | ALTA |
| 2 | `035b7433` | 01/set 21:55 → 02/set 15:57 | 17MB | Frontend 2 ("desigual-os-81") | ALTA |
| 3 | `3582951a` | 31/ago → 03/set 14:02 | 57MB | **Backend principal (a maior sessão)** | CRÍTICA |
| 4 | `9532704c` | 03/set 08:43 → 11:00 | 8.5MB | Studio (carrossel/overlay) + skills + dossiê | ALTA |
| 5 | `34cf1dc5` | 03/set 11:27 → 14:08 | 4.4MB | **Última sessão substantiva** (Fases 2-3, notificações, Studio) | CRÍTICA |
| 6 | `44c42006` | 03/set ~12:38 | 1.1MB | QA ponta a ponta ("desigual-os-ce") | ALTA |
| 7 | `381b3074` | 02/set 17:04 | 23KB | Bug do Studio (interrompida pelo usuário) | Baixa |
| 8 | `ca935081` | 03/set 12:30 | 31KB | Pergunta sobre acesso à VPS | Baixa |
| 9 | `bf716018` | 03/set 09:47 | 2.7KB | Só eventos de login local | Nula |
| 10 | `7386551b` | 03/set ~11:42–14:42 | 43KB | "logout" — morreu sem produzir; recebeu achados da QA | Média (pelos achados recebidos) |

### Landing page (`/Users/pedro/Downloads/LP - DESIGUAL OS`)

| # | Sessão | Período | Tamanho | Papel | Relevância |
|---|--------|---------|---------|-------|-----------|
| 11 | `0031fe1f` | 03/set 12:18 → 14:39 | 49MB | Construção completa da LP | CRÍTICA (última sessão antes do Kimi) |

### As 3 sessões mais importantes

1. **`3582951a`** — o backend inteiro: Prompt Mestre, 45+ tabelas, Router, Orchestrator, worker, RBAC, ClickUp, Studio real, conexão com as máquinas via VPS/Tailscale, recuperação de senha. Morreu por rate limit com a pergunta "o quanto o sistema anda sozinho para outro cliente?" sem resposta.
2. **`34cf1dc5`** — última sessão substantiva: Fase 2 (chat público), Fase 3 (automações do zero), sistema de notificações reescrito, Studio (proporção/qualidade reais, upscale removido). Morreu por rate limit investigando Jarbas/Suzy + delete de assets + vídeo no ComfyUI.
3. **`8693fcd5` + `035b7433`** (par de frontend) — todo o `apps/web`: 12-14 telas, design system, auth, MSW, convites, `/convite`, CORS, favicon. Morreram com a pergunta "cadastro aberto ou só convite?" sem resposta.

### Sessões paralelas referenciadas mas sem arquivo próprio identificado

O histórico menciona sessões de backend adicionais (`desigual-os-de/d8/48/64`) e sessões `desigual-os-6a`, `17`, `a7`, `ef` que trocaram mensagens cross-session. Parte do trabalho delas pode estar registrada apenas dentro dos JSONLs acima.

---

## 3. Arquitetura definida

**Monorepo pnpm + Turborepo**, seguindo o "Prompt Mestre" (spec canônica de ~900 linhas colada pelo usuário em 31/ago):

```
apps/
  api/      Orchestrator — Fastify 4.29, porta 3001 (19 grupos de rotas)
  web       Next.js 16 (App Router, Turbopack, React 19, Tailwind 4), porta 3010
  worker    BullMQ — processors (execute-job, run-automation) + schedulers (cron)
packages/
  router, orchestrator, context-engine, token-engine, tool-gateway,
  node-protocol, auth, database, logging, types
nodes/
  desigual-node   Node Agent genérico p/ Macs (NÃO deployado ainda)
  studio-node     Worker GPU BullMQ — geração REAL via ComfyUI
brain/            Vault Obsidian do projeto (memória viva, pt-BR)
Brain-Marketing/  6 frameworks de marketing consumidos em runtime
database/         14 migrations SQL (0000-0013)
docs/             api-gaps.md + 5 ADRs
infrastructure/   4 pastas VAZIAS (docker, nginx, networking, monitoring)
```

**Por que essa arquitetura:** o spec exigia contrato-first, separação Orchestrator (coordenação) vs agentes (execução nas máquinas), e as "8 regras de ouro" (ver seção 26). O desvio consciente do spec foi **Supabase gerenciado em vez de Postgres self-hosted** (o usuário passou credenciais reais no meio da sessão; direct connection do Supabase é IPv6-only e o ambiente não tinha IPv6 → usa-se session pooler IPv4).

**Conectividade real:** VPS LocaWeb (`vps37685.publiccloud.com.br`, 191.252.203.180, Debian 12) como **bastion SSH**; Tailscale nas máquinas (tailnet `tail6a0625.ts.net`): Bento `100.93.182.83`, Jarbas `100.118.12.97`, Suzy `100.86.237.73`, Studio/PC `100.107.198.50`. O Orchestrator **nunca foi deployado na VPS** — tudo rodou em dev local.

---

## 4. Stack tecnológica

- **Backend:** Fastify 4.29 + @fastify/cors v9 + @fastify/websocket v10; BullMQ + Redis 7 (docker-compose só sobe Redis); Drizzle ORM sobre Supabase Postgres; `jose` (JWKS) para JWT; Zod em tudo; Pino (logging); Resend (e-mail); `@anthropic-ai/sdk` (classifier do Router + copy de marketing); AES-256-GCM para cofre de tokens de integração.
- **Frontend (app):** Next.js 16, React 19, Tailwind 4, TanStack Query, Zustand, MSW (modo mock), supabase-js, Framer Motion.
- **LP:** Next.js 16.3.4, Tailwind v4, Motion 13, next-themes, Remotion 4 (Player ao vivo + render), supabase-js.
- **Agentes reais (descoberta de 02/set):** existem **3 sistemas sobrepostos** nas máquinas — OpenClaw (instalado, mas NÃO é o runtime de produção), "enxame"/swarm-api (Bento, porta 8787) e **"Agentes Desigual"/susy-service** (Express + Evolution API + Ollama/Claude CLI, portas 13102/23102 — este é a fonte de verdade do WhatsApp/Instagram de clientes). O Studio usa Pinokio + ComfyUI 0.28.0 com Flux.2 Dev fp8 na RTX 4090.
- **MCP / Telegram / OpenRouter:** **não encontrados** no sistema nem no histórico (MCP só aparece como skills de terceiros baixadas; Telegram teve 1 ocorrência acidental num help de CLI).

---

## 5. Estrutura atual do projeto

Ver seção 3. Estado medido no código (03/set):

- **Git (projeto principal): ZERO commits.** Branch `main` sem commits; tudo untracked (25 entradas). `.env` gitignored. **Risco máximo de perda.**
- **Git (LP):** 1 commit (boilerplate create-next-app); todo o trabalho real não commitado.
- `infrastructure/` vazia; `docs/{agents,api,deployment,security}/` vazias.
- `.claude/` e `.agents/` contêm apenas bibliotecas de skills de terceiros (26 skills travadas em `skills-lock.json`); sem settings/commands/memória próprios.
- Lint + typecheck verdes nos 15 pacotes (último estado reportado pelo Claude).
- **Zero arquivos de teste automatizado** no repo (Fase 16 não iniciada). Filosofia até aqui: testar de verdade contra infra real.

---

## 6. Frontend

### App principal (`apps/web`, porta 3010)

- 14 rotas no route group `(shell)`: dashboard, chat, agents, clients, costs, history, knowledge, messages, monitoring, settings, studio, workflows, admin, analytics + login, signup, convite, forgot/reset-password.
- ~80 componentes, 30 hooks, `lib/api/contracts.ts` com 1145 linhas de contratos (fonte da verdade contract-first).
- **Modo dual:** `NEXT_PUBLIC_API_MODE=mock` (default, MSW) ou `live`. Estado final: **live**.
- Auth real via Supabase (`auth-provider.tsx`, `use-supabase-session.ts`), auth gate no `(shell)/layout.tsx`, botão Sair.
- Design system: dark como assinatura, acento `#E1F900`, fontes proibidas (Inter/Roboto/Poppins), **nunca travessão**, sem bounce/confetti. Tema persistido server-side (`theme` em `/me`).
- Features entregues: chat (thread, thinking-steps, composer, sidebar de conversas, deep-link `?agent=X`, botão Encaminhar), Studio como modal + galeria com carrossel agrupado + download zip, busca geral ⌘K, workspace de cliente com aba Acesso, `/messages` (DM com anexos), `/settings` (idioma/foto), admin/team (convite, roles, toggle ativo, delete com regra 409), Monitoramento com SyncPanel, vídeos de motion nos title cards, responsividade corrigida (shell até 2400px), notificações com popup inbox reescrito, automações com presets/cron.
- **Dados ainda ilustrativos (não reais):** Knowledge (`SAMPLE_KNOWLEDGE_SOURCES`), timeline de eventos do Monitoring (`mockSystemEvents`), `lib/admin/sample-users.ts`.
- **Gap conhecido:** frontend faz **polling** (5-20s) em vez de consumir o WebSocket `/ws` que já existe no backend — `apps/web/src/lib/realtime` está vazio. O wiring foi iniciado ao final (AppShell), não concluído/validado.

### Landing page (`/Users/pedro/Downloads/LP - DESIGUAL OS`, porta 3000)

- 11 seções: Hero → TeamMarquee → Problem → HowItWorks → AgentsDetail → FeaturesGrid → ProductShowcase → Differentiators → TechStack → CurrentState → FinalCta → Footer. Copy 100% do `DOSSIE-LP-DESIGUAL-OS.md`.
- Remotion ao vivo: `AmbientBackdrop` (4 vídeos `pattern-*.mp4` com crossfade, tilt 3D no scroll) no hero; `AgentReveal` nos cards. Exportável para MP4 (`remotion render`).
- Tema dark/light completo (texturas, logos e tokens trocam por tema).
- `/cadastro`: **`supabase.auth.signUp` real** no mesmo projeto Supabase do app (metadata `{name, agencia}`), validação client-side, tela "Confira seu e-mail", link "Entrar" via `NEXT_PUBLIC_DESIGUALOS_LOGIN_URL`.
- Build de produção gerado com sucesso em 03/set 12:28. **Última edição (fix da tagline rotativa do hero) aplicada sem revalidação** — ver seção 24.

---

## 7. Backend

`apps/api` (Fastify, porta 3001) — implementado de verdade, 19 grupos de rotas: nodes, health, auth, chat, executions, studio, ws, costs, clients, conversations, admin, clickup, integrations, notifications, messages, team, search, tool-calls, automations.

Componentes-chave:
- **Auth:** validação JWT Supabase via JWKS; provisioning JIT do usuário; `requireAuth` + `requirePermission(resource, action)`; master wildcard `*:*` (masters em `MASTER_USER_EMAILS`).
- **Recuperação de senha:** completa — `POST /auth/forgot-password` anti-enumeração + e-mail Resend com branding + páginas `/forgot-password` e `/reset-password` (validado `status=delivered`).
- **Convites:** `POST /admin/invite` (Supabase Admin + Resend). Limitações: Resend estava em sandbox (403 p/ não-donos); domínio `noreply.institutoalmada.org` verificado depois, mas e-mail caiu no **Spam do Outlook**.
- **Chat:** `POST /chat` → Router → fila → worker → agente. Resposta gravada em `execution_steps` (bug crítico corrigido em 03/set: o caminho single-agent não gravava steps → bolha vazia; fix com upsert + `steps.at(-1)` no frontend).
- **WebSocket `/ws`:** broadcast de `execution.progress/completed`, `node.status`, `studio.job.progress` — **sem consumidor no frontend ainda**.
- **Agent-probe + agent-sync:** sonda HTTP real nos 4 agentes via Tailscale a cada 30s; botão "Sincronizar" com diagnósticos em PT e autofix conservador só no próprio banco. Thresholds de saúde: 75s/150s/300s.
- **Notificações, DMs (`direct_messages` + storage `user-uploads`), busca geral, avatar upload, custos (`/costs/*` master-only, USD), admin com integrações por usuário.**
- **Automações (Fase 3, última sessão):** tabelas `automations`/`automation_runs`, repeatable jobs BullMQ, CRUD `/automations`, worker posta como mensagem no chat do agente + notificação. **Pendente: rodar migration, seed e restart.**
- **Erro envelope:** sempre `{error: string}`; validação Zod → 400 com `details`.

`apps/worker`: `execute-job.ts` (single-agent + workflow multi-agente encadeado), `run-automation.ts`, schedulers (checklist 18h + briefing 8h que alimentam a "memória" do Bento).

---

## 8. Banco de dados

- **Supabase Postgres** (projeto `dddchncdrgbhdirytdsp`), acesso via **session pooler** (IPv4). Drizzle ORM, 14 migrations (0000-0013), seed idempotente em `packages/database/src/seed.ts`.
- **49 tabelas** em 12 grupos: identidade (users/roles/permissions/user_roles), clientes (clients/client_users/client_brand_kits), infra (agents/nodes/node_capabilities/agent_tools), conversa/execução (conversations/messages/router_decisions/execution_plans/executions/execution_steps), filas (jobs/job_attempts), tools (tool_calls/tool_results), custos (token_usage/model_usage/cost_records/economy_records), conhecimento (knowledge_sources/documents/chunks/embeddings/memories), ClickUp (workspaces/spaces/lists/tasks/user_connections), Studio (projects/assets/jobs/brand_kits), workflows, observabilidade (audit_logs/notifications/system_events/health_checks), mais direct_messages, automations, automation_runs, integration_connections.
- **RLS: nenhuma.** Acesso 100% enforced no Orchestrator (RBAC próprio). Decisão consciente (a secret key bypassa RLS de qualquer forma).
- **Funções/triggers: nenhuma** — lógica toda na aplicação.
- `economy_records` existe no schema mas **nada escreve nela** (instruído a não fabricar dados).
- **Base de usuários limpa:** só resta o master `super@institutoalmada.org`.

---

## 9. Autenticação

**ADR 0001 — "decisão já tomada e não deve mudar":**
- Login direto no browser com supabase-js + publishable key. **Sem tela de login própria de senha no backend e sem JWT próprio** (seria redundante).
- Frontend manda `Authorization: Bearer <supabase_access_token>`; Orchestrator valida via JWKS (`jose`, ADR 0003) e resolve `sub` → `users.auth_user_id` → RBAC.
- **Role NÃO vem no JWT** — resolver via `GET /me`. Nunca decodificar JWT no client.
- Auth node-to-node separada via `NODE_SECRET` (máquinas, não pessoas), com comparação timing-safe.
- Supabase Auth de e-mail é bypassed quando Resend está configurado (template próprio com branding).

**Pergunta em aberto (nunca respondida):** "Cadastro aberto ou só convite?" — signup self-service está aberto hoje; recomendação do Claude: só convite de admin. **Ponto de segurança aberto.**

---

## 10. Usuários e permissões

- **RBAC próprio** (roles/permissions/user_roles): master vs colaborador. Masters definidos em `MASTER_USER_EMAILS` (`super@institutoalmada.org`, `endrigo@institutoalmada.org`).
- `nodes:read` e `costs:read` são master-only (custos escondidos do colaborador — pedido explícito do usuário).
- Colaborador acessa workspace de cliente via `client_users` (`POST /clients/:id/access`, role viewer/editor).
- **Mudança de política feita na última sessão (sinalizada ao usuário):** chat/conversas/mensagens ficaram públicos entre colaboradores (removido filtro por dono; `hasClientAccess` aberto a todo colaborador; `clients:write` no seed).
- Auditoria de 02/set corrigiu 16 achados: auth ausente no `/execute` do node, RBAC não checava `users.active`, IDOR em `POST /chat`, escopo de cliente no Studio, JWT sem `aud`/`iss`, rotas `/nodes` e `/health/infrastructure` sem auth.
- Credenciais criadas ao longo das sessões: master `super@institutoalmada.org` / `Elefante#123`; colaborador de teste `colaborador.teste@institutoalmada.org` / `Colaborador#123` (pode ter sido deletado na limpeza).

---

## 11. Router / Orquestrador

- **AI Router** (`packages/router`): decide **qual agente** atende (bento/jarbas/suzy/studio) em camadas — rule engine (testada) → classifier Anthropic (`claude-sonnet-4-5`, ADR 0004; **nunca testado com chave real**). Não escolhe máquina — quem localiza a máquina física é o Node Registry + health.
- **Orchestrator** (`packages/orchestrator`): filas BullMQ (`queue-<agente>` — hífen, pois dois-pontos é inválido no BullMQ), `studio-jobs` separada, dispatch single-agent, Workflow Engine multi-agente com `execution_steps` encadeados, cost-service, pubsub Redis→WS, agent-probe, agent-sync, learning, automation-queue.
- **Circuit breaker** = gating por máquina de estados de saúde (só roteia para node `online`), não contador de falhas.
- **Context Engine:** contexto mínimo (usuário, brand kit do cliente, últimas 5 mensagens) com queries paralelas.
- **Comunicação entre agentes:** tudo passa pelo Orchestrator (regra de ouro). Dispatch real hoje: Bento via `callBento()` → endpoint `bento-qa /ask` (100.93.182.83:8791) com fallback `/memory/search`; **Jarbas/Suzy caem no caminho genérico `/execute` que falha honesto** (ver seção 24).
- **Auto-aprendizado** (`learning.ts`): grava em `memories` + tenta escrever markdown no vault do Bento via `BENTO_VAULT_WRITER_URL` + `POST /memory/reindex`. **Endpoint de escrita não existe ainda** (retorna pending/skipped); prova de conceito manual via SSH/scp validada.

---

## 12. Agentes

| Agente | Máquina | IP Tailscale | Runtime real | Status no chat |
|--------|---------|--------------|--------------|----------------|
| **Bento** (Institucional) | Mac Mini | 100.93.182.83 | enxame/swarm-api (8787) + bento-qa (8791) | **Funciona** (via bento-qa) |
| **Jarbas** (Tráfego) | Mac Mini | 100.118.12.97 | Agentes Desigual (23102) | **Não responde** — falta endpoint interno |
| **Suzy** (Social Selling) | Mac Mini | 100.86.237.73 | susy-service (13102) | **Não responde** — falta endpoint interno |
| **Studio** (Criação) | PC Windows RTX 4090 | 100.107.198.50 | Pinokio + ComfyUI 0.28.0, Flux.2 Dev fp8 | **Funciona** (imagem/carrossel reais) |

- **Regra de ouro:** o cérebro de cada agente nunca sai da máquina dele; o Node Agent chama o runtime local na própria máquina.
- `nodes/desigual-node` (Node Agent genérico com `/health`, `/status`, `/capabilities`, `/execute`, heartbeat, cliente OpenClaw via CLI, leitor Obsidian local) está **pronto em código mas NÃO deployado em nenhuma máquina real**.
- Descoberta documentada (Fase Extra, 02/set): **OpenClaw não é o runtime de produção** — Jarbas/Suzy rodam "Agentes Desigual" (Express + Evolution API + Ollama/Claude CLI); Bento roda o enxame.
- Correção em produção (via scp + pm2): `AGENTS_ENABLED=jarbas` no `server.js` do Jarbas — resolveu duplicação de sessão WhatsApp da Suzy. Suzy foi separada em pasta própria.
- Agentes **não processam** áudio/vídeo/pdf/doc/pptx no chat (pipeline não feito; DMs entre usuários aceitam anexos, agentes não).
- Bento estava com 429 da OpenAI (sem créditos) — externo, usuário mandou ignorar.

---

## 13. ClickUp

- **Pivot de estratégia:** OAuth → **API key única** (`pk_118245538_...`, Team ID 9014937439) com atribuição por e-mail, porque o usuário só conseguia gerar API key (OAuth app exige owner do workspace). Depois o **OAuth real foi reimplementado** (`/integrations/clickup/callback` com state HMAC) — mas com **mismatch http/https no redirect URI não resolvido**.
- Implementado: cliente real (tasks, members, comments, reply), **sync de clientes** (folders "CLIENTES *" → ~50 clientes com vínculo), criação de tarefas, `DELETE /clickup/tasks/:id` via **fila de aprovação do Tool Gateway** (`/tool-calls`, master-only), `bento-mention.ts` (responde menções @Bento no ClickUp via SSH + `claude -p` no padrão Jarbas).
- **Webhook:** `POST /clickup/webhook` é a **única rota pública** do Orchestrator, protegida por HMAC-SHA256. **`CLICKUP_WEBHOOK_SECRET` não existe — nenhum webhook real registrado** (depende de URL pública = deploy).
- UI de "aprovações pendentes" (tool-calls): só contrato anotado; UI não construída.
- `TOOL_EXECUTORS` só tem `clickup.delete_task`.

---

## 14. MCP

**Não encontrado no histórico/código.** O servidor MCP do ClickUp apareceu apenas como ferramenta disponível nas sessões; zero chamadas MCP reais. No repo, "MCP" só aparece em skills de terceiros (`.claude/skills/`). Nenhuma decisão de arquitetura envolve MCP.

## 15. Obsidian

- **Regra de ouro:** "vaults ficam locais, nunca sync".
- `brain/` = vault do projeto no repo: `00-Índice`, `01-Regras de Ouro`, `05-Modelo de Dados`, `06-Contratos de API`, `07-Design System`, `99-Pendências`, `Decisoes/`, `Fases/` (21 notas densas com DoD validado e bugs reais). **Está atualizado até 03/set e é a memória mais confiável do projeto** — mas em alguns pontos o código já está à frente (Studio real, automações, learning, ClickUp OAuth).
- Fontes citadas no chat são caminhos de arquivos do Obsidian (`steps[].output.sources` é `string[]`).
- `nodes/desigual-node/src/obsidian/reader.ts`: leitor local — só snippets saem da máquina.
- Vaults reais dos agentes ficam nas máquinas deles (ex.: vault do Bento, escrita via `BENTO_VAULT_WRITER_URL` — endpoint inexistente).

## 16. OpenClaw

- Instalado nas máquinas, referenciado extensamente (300+ menções), **mas não é o runtime real de produção** (descoberta de 02/set). No Mac do usuário só existe o agente `main` configurado.
- O Token/Cost Engine usa fallback de preço "unknown" (nível Sonnet) porque **o OpenClaw não reporta o modelo real usado** — custo é aproximado, limitação documentada honestamente.
- `nodes/desigual-node` tem cliente OpenClaw via CLI (`child_process` com env limpo), pronto mas não deployado.

## 17. Infraestrutura

- **VPS LocaWeb** `vps37685.publiccloud.com.br` (191.252.203.180, Debian 12, root): bastion SSH + Tailscale instalado. **Deploy do Orchestrator na VPS ficou PENDENTE** (Fase 17 documentada e deferida; dependência explícita: webhook ClickUp precisa de URL pública).
- **Frota Tailscale** (tailnet `tail6a0625.ts.net`): 3 Mac Minis + PC Windows RTX 4090. Acesso do sandbox via duplo hop SSH (scripts `expect`, deletados após uso).
- `infrastructure/` no repo: **totalmente vazia**.
- `docker-compose.yml`: só Redis 7.
- **Pendente de decisão do usuário:** onde o worker roda em produção (Mac local com Tailscale vs VPS).
- SSH key-based auth Orchestrator→Bento não configurado.

## 18. Integrações externas

- **Supabase** (Auth/Postgres/Storage — buckets `studio-assets`, `user-uploads`).
- **ClickUp** — ver seção 13.
- **Resend** — e-mails de convite e recuperação de senha (sandbox → domínio verificado; cai no Spam do Outlook).
- **Anthropic** — classifier do Router + copy de marketing do Studio (`marketing-copy.ts` consome `Brain-Marketing/`).
- **ComfyUI/Ollama** — geração real no Studio (Flux 28 passos medidos, img2img denoise 0.80, snap para múltiplos de 16, resolveCheckpointName dinâmico, retry de rede, fix do "Missing lock for job" do BullMQ).
- **Enxame (swarm-api)** — token emitido e "hello swarm" validado; **cliente no Orchestrator ainda não escrito** (pendente #2 da Fase Extra).
- **Bento Q&A / memory-api** — cliente real (`bento-qa-client.ts`).
- **Evolution API** — WhatsApp/Instagram reais via Agentes Desigual (fora do monorepo).

## 19. Controle de tokens

- **Token/Cost Engine real:** `recordCostEvent`/`finalizeExecutionCost`; tabelas `token_usage`, `model_usage`, `cost_records`; tabela de preços USD por modelo com fallback "unknown" (preço nível Sonnet) quando o modelo é desconhecido (OpenClaw não reporta).
- **Valores sempre em USD** (decisão consciente: é como os LLMs cobram; conversão BRL seria no frontend).
- Rotas `GET /costs/*` (overview/by-agent/by-client/by-user, `?range=Nd`) — **master-only**.
- Dashboard mostra economia potencial vs real com dados de executions reais.
- `economy_records` sem escritor; custo de GPU não existe (instruído a não fabricar).
- Retry BullMQ sem idempotência (pode cobrar 2x) — divergência documentada.

## 20. Dashboard

- Tela inicial limpa: apenas "Bem-vindo de volta, {nome}, o que vamos fazer hoje?" (card duplicado removido a pedido).
- 4 StatCards com a logo da OS; `PageHeader` virou card com fundo texturizado; vídeos de motion vinculados aos title cards (4 MP4s, mapeamento determinístico por rota).
- Dados reais de executions (Fase 11 DoD). Custos e Monitoramento master-only.
- Analytics/Workflows/History existem como telas; profundidade real varia.

---

## 21. Funcionalidades concluídas

(Validadas contra infra real, segundo o vault + código)

- Monorepo completo, lint/typecheck verdes nos 15 pacotes.
- Auth Supabase + RBAC + provisioning JIT + recuperação de senha via Resend (delivered) + páginas forgot/reset.
- Pipeline de chat completo: POST /chat → Router → fila → worker → **Bento real** com resposta gravada em `execution_steps` (validado com execution real).
- Workflow Engine multi-agente.
- **Studio: geração real de imagem e carrossel** via ComfyUI/Flux na RTX 4090, com copy de marketing (Claude + Brain-Marketing), overlay de texto (sharp), upload no Supabase Storage, jobs persistentes (`requestedBy`, "my jobs", rehidratação), notificações, galeria com agrupamento por carrossel + legenda copiável + download zip, controles de Proporção e Qualidade reais.
- Custos reais em USD + rotas `/costs/*`.
- DMs entre usuários com anexos; notificações (lista + popup inbox reescrito); busca geral ⌘K.
- Automações agendadas (cron BullMQ) — código completo, **aguardando migration+seed+restart**.
- ClickUp: sync de ~50 clientes, criação de tarefas, delete com aprovação, menção @Bento, OAuth (com pendência de redirect).
- Monitoramento com probes reais ao vivo + botão Sincronizar (diagnóstico/autofix).
- Convites por e-mail com página `/convite` (bug do link 404 corrigido — última entrega da sessão de frontend).
- Frontend: 14 telas, mock/live, tema server-side, responsividade, favicon.
- **LP completa** com cadastro real no Supabase.
- Correção em produção: `AGENTS_ENABLED=jarbas` (fix WhatsApp duplicado Jarbas/Suzy).

## 22. Funcionalidades parcialmente concluídas

| Item | O que existe | O que falta |
|------|--------------|-------------|
| Chat Jarbas/Suzy | Pipeline completo até o dispatch | Endpoint Q&A interno nas máquinas deles (deploy do desigual-node OU `POST /internal/ask` no susy-service) |
| WebSocket tempo real | Backend `/ws` completo com eventos | Frontend consome (lib/realtime vazio; hoje polling 5-20s) |
| Studio vídeo/reels | Tipos de job existem, falham honesto com aviso | Workflow ComfyUI de vídeo (LTX-V/Wan 2.2 não confirmados); timeout da RTX a investigar |
| Auto-aprendizado | `learning.ts` + gravação em `memories` + PoC manual validada | Endpoint `BENTO_VAULT_WRITER_URL` na máquina do Bento |
| ClickUp OAuth | Fluxo completo implementado | Resolver mismatch http/https no redirect URI no app do ClickUp |
| ClickUp webhook | Rota pública + HMAC prontos | `CLICKUP_WEBHOOK_SECRET` + URL pública (deploy) + registro real |
| Automações | Backend + UI completos | Rodar migration, seed, restart da API/worker |
| Knowledge (frontend) | Tela pronta | Dados reais (hoje `SAMPLE_KNOWLEDGE_SOURCES` ilustrativo) |
| Monitoring timeline | Tela pronta | `system_events` reais em vez de `mockSystemEvents` |
| Aprovações pendentes (tool-calls) | Rotas + contrato | UI não construída |
| Enxame client | Token validado | Cliente no Orchestrator não escrito |
| Anexos para agentes | Spec + DMs com anexos | Pipeline de áudio/vídeo/pdf/doc/pptx para agentes |
| LP `/cadastro` | signUp real funcionando | Teste E2E real nunca executado; entidade "agência" não existe (vai como metadata); `/login` relativo inexistente na LP |

## 23. Funcionalidades pendentes (planejadas, não implementadas)

- **Deploy do desigual-node nas máquinas do Jarbas e da Suzy** — BLOQUEANTE nº 1; aguardava autorização do usuário desde 03/set 12:38.
- **Deploy do Orchestrator na VPS** (Fase 17) + registro do webhook ClickUp real.
- Decisão: onde o worker roda em produção (Mac local vs VPS).
- **Testes automatizados** (Fase 16 não iniciada; zero arquivos de teste).
- ~~Build de produção do monorepo (ADR 0002 registra que `tsc` puro com moduleResolution Bundler provavelmente precisará de esbuild/tsup).~~ **Resolvido** para `apps/api`/`apps/worker`: `build.mjs` (esbuild) valida em 2026-09-07, confirmado rodando `pnpm build` e o `dist/*.js` gerado (ver ADR 0002 e `apps/api/build.mjs`). Os nodes (`nodes/desigual-node`, `nodes/studio-node`, `nodes/otto-node`) ainda não receberam o mesmo bundler; ver a seção "Rodar em produção" de cada `README.md` em `nodes/*/`.
- Botão de deletar artes do Studio (investigação cortada pelo rate limit).
- Upscale (removido como tipo de job; x4-upscaler existe na máquina mas não configurado).
- Tutorial animado do Studio (item 12 do plano de blocos: "NÃO IMPLEMENTAR AGORA" — decisão do usuário).
- "Login com ClickUp" no convite (bloqueado por e-mail + OAuth).
- Logo preta para tema claro (workaround atual: chip escuro fixo).
- Template de e-mail do Supabase não customizado.
- `economy_records` (sem escritor).
- Responder a pergunta final do usuário: **"o quanto o sistema anda sozinho para implementar na operação de outro cliente?"** (multi-tenancy/replicabilidade — nunca respondida).
- Entidade "agência"/multi-tenant (inexistente; cadastro da LP vai como metadata).
- Fusão da LP no monorepo (trocar `NEXT_PUBLIC_DESIGUALOS_LOGIN_URL` por `/login` relativo; CORS se a LP chamar a API).
- `infrastructure/` (vazia), `docs/{agents,api,deployment,security}/` (vazias).

## 24. Bugs conhecidos

**Ativos/conhecidos:**
1. **Jarbas e Suzy não respondem no chat** — falta endpoint interno; chat falha honestamente com notificação. (Bloqueante; solução = deploy do Node Agent, aguardando autorização.)
2. **LP: última edição não validada** — fix da tagline rotativa do hero (`hero.tsx`, AnimatePresence + inline-block sem wrapper) aplicado 3s antes do rate limit, **sem tsc/lint/build/screenshot depois**.
3. Bento: OpenAI 429 (sem créditos) — externo, ignorar por decisão do usuário.
4. E-mails (convite/recuperação) caem no **Spam do Outlook**; imagem do e-mail "quebrada" = bloqueio de imagens externas do Outlook.
5. ClickUp OAuth: redirect URI http vs https pendente.
6. Timeout genuíno do ComfyUI na RTX para jobs pesados (carrossel) — investigar.
7. Healthchecks/probes "passando" nas sessões dependiam de **túneis SSH temporários do sandbox** — não provam conectividade a partir do Mac do usuário.
8. WS `/ws` é broadcast sem filtro por usuário (filtrar client-side).
9. Retry BullMQ sem idempotência (cobrança dupla possível).
10. Studio fora do protocolo de Node Agent (não aparece em `/costs/*` nem no circuit breaker).
11. `cadastro-form.tsx` da LP: sem try/catch no `await` do signUp (rejeição de rede = unhandled); env vars vazias criam client com strings vazias sem aviso.

**Resolvidos (principais):** CORS ausente na API; bug crítico da bolha vazia do chat (`execution_steps`); job do Studio sumindo ao navegar; thresholds de saúde flapping; colisão de execution-id a cada 16min; Zod virando 500; lock BullMQ de 30s matando job de GPU; RAM do macOS medida errada; `/convite` 404; IDOR em POST /chat; auth ausente no `/execute` do node; `users.active` não enforcementado; migration `num_slides` quebrando Studio ao vivo; avatar mock errado; MSW iniciando 2×; avatares "S" duplicados (Su/S/St); iframe ClickUp em branco (CSP → aviso honesto); EMFILE; processos zombie.

## 25. Débitos técnicos

- **Git sem commits nos dois projetos** — maior risco operacional.
- Credenciais reais em plaintext nos JSONLs de sessão e no `.env`.
- Frontend em polling; Knowledge/Monitoring/admin com dados ilustrativos.
- Mocks MSW deliberados (modo default mock) — risco de alguém achar que está em live.
- ~~Build de produção do backend não resolvido (ADR 0002).~~ **Resolvido** para `apps/api`/
  `apps/worker` (esbuild via `build.mjs`, validado em 2026-09-07) **e para os três `nodes/*`**
  (`nodes/*/build.mjs`, validado em 2026-09-08 com boot real de cada um - `studio-node` externaliza
  `sharp`/`puppeteer-core` em vez de empacotar, os outros dois empacotam tudo como `apps/api`). Ver
  a seção "Rodar em produção" de cada `README.md` em `nodes/*/`.
- ~~Zero testes automatizados.~~ **Parcialmente resolvido em 2026-09-08**: `packages/auth`,
  `packages/context-engine`, `packages/orchestrator` e `apps/worker` ganharam suítes reais (130
  testes no total no monorepo, 8 dos 17 packages cobertos). Ainda faltam `apps/web`,
  `nodes/desigual-node`, `nodes/studio-node` e validação do classificador contra a API real da
  Anthropic (bloqueado por falta de `ANTHROPIC_API_KEY`).
- `infrastructure/` e subpastas de `docs/` vazias.
- Prompt injection detectado em `apps/web/AGENTS.md` (bloco falso "breaking changes do Next.js" apontando para `node_modules/next/dist/docs/`) — o Claude não seguiu e pediu permissão para remover; **sem resposta registrada**. O mesmo bloco existe no `AGENTS.md` da LP (recriado automaticamente pelo `next dev`). **Recomendação: tratar como conteúdo não confiável e remover.**
- `Brain-Marketing/` referencia produtos "Orvyn"/"Nyro" (reuso de outro projeto) — revisar.
- Classifier Anthropic nunca testado com chave real.
- Custos aproximados (modelo real não reportado).
- Processos zombie recorrentes em dev (tsx watch duplicados).
- LP: pasta `midias/` pesada e não rastreada; README da LP desatualizado (diz que cadastro é TODO e omite ProductShowcase).

## 26. Decisões que NÃO devem ser alteradas

1. **ADR 0001 — Supabase completo** (Postgres/Auth/Storage gerenciado; session pooler; sem JWT próprio; role via `GET /me`). Texto literal: "a decisão de arquitetura já está tomada e não deve mudar".
2. **As 8 regras de ouro** (`brain/01 - Regras de Ouro.md`): cérebros dos agentes nunca saem das máquinas; Orchestrator é camada de coordenação sobre agentes existentes; tudo via Tailscale; toda comunicação entre agentes passa pelo Orchestrator; segredos nunca no frontend; `execution_id` + `audit_logs` em tudo; modular.
3. **NUNCA rotacionar credenciais/chaves** — "se rotacionar algo fode todo o histórico" (restrição repetida do usuário).
4. **Regras de craft:** dark mode como assinatura; fontes proibidas (Inter/Roboto/Poppins etc.); **nunca usar travessão** em texto/UI/código; sem bounce/confetti/pulse infinito; envelope de erro `{error}` em 100% das rotas; snake_case no wire; enums importados de `@desigual-os/types` (nunca redeclarar); código em inglês, UI/docs em pt-BR.
5. **Não fabricar dados:** `economy_records`, custo de GPU, backup — instruído explicitamente a não mockar ("falha honesta" em vez de fingir).
6. Custos sempre em USD no backend.
7. `agent_hint` MAIÚSCULO no request vs `agent` minúsculo no domínio — intencional (formato do prompt mestre).
8. Webhook ClickUp como única rota pública + HMAC (decisão delegada e tomada).
9. Tutorial animado do Studio: "NÃO IMPLEMENTAR AGORA".

## 27. Último estado conhecido do Claude

**Projeto principal — 03/set ~14:08 (local), sessão `34cf1dc5`:**
- Entregue: Fase 2 (chat público + política de acesso aberta entre colaboradores), Fase 3 (automações do zero), sistema de notificações reescrito, Studio com Proporção/Qualidade reais e upscale removido, fixes do chat.
- Às 12:35 começou a investigar Jarbas/Suzy + delete de assets + vídeo ComfyUI → **rate limit às 12:35-12:38**.
- Última mensagem do usuário ("dossie") não atendida — mas o dossiê já existia (`DOSSIE-LP-DESIGUAL-OS.md`, criado às 10:55 pela sessão `9532704c`).
- Em paralelo, a sessão de QA (`44c42006`) concluiu às 12:38: **próximo passo bloqueante = deploy do Node Agent nas máquinas do Jarbas e da Suzy**, aguardando autorização do Pedro (pedida às 12:38 pela sessão `3582951a`, nunca respondida).
- A sessão `3582951a` morreu às 14:02 com a pergunta **"estando o projeto 100% funcional, o quanto ele consegue andar sozinho para eu implementar na operação de outro cliente?"** — sem resposta.
- A sessão `7386551b` recebeu às 12:19-12:23 dois achados da QA (WebSocket não usado no frontend; bug do `steps[0]` — este já corrigido) que **nunca foram processados**.

**LP — 03/set ~14:40 (local), sessão `0031fe1f`:**
- No meio de uma auditoria de responsividade (Playwright, mobile→ultrawide).
- Acabara de aplicar o fix da tagline rotativa do hero → rate limit 3s depois, **sem validar**.

**O que estava funcionando:** sistema completo em dev (API 3001, web 3010, worker, Redis); chat com Bento real; Studio gerando imagens reais; auth + recuperação de senha; monitoramento ao vivo; LP buildada com cadastro real.
**O que estava quebrado:** Jarbas/Suzy no chat; vídeo/reels no Studio; Bento sem créditos OpenAI; e-mails no Spam.

## 28. Próximos passos (na ordem em que o Claude os deixou)

1. **[Aguardando autorização]** Deploy do `desigual-node` nas máquinas do Jarbas e da Suzy (via VPS bastion → Tailscale) para destravar o chat dos dois agentes.
2. Rodar migration + seed da Fase 3 (automações) e reiniciar API/worker.
3. Validar a última edição da LP (tsc + lint + build + screenshot do hero).
4. Teste E2E real do cadastro da LP → login no app :3010.
5. Decisão do usuário: onde o worker roda (Mac local com Tailscale vs VPS).
6. Deploy do Orchestrator na VPS + `CLICKUP_WEBHOOK_SECRET` + registro do webhook real.
7. Wiring do WebSocket no frontend (substituir polling).
8. Botão de deletar artes do Studio; investigar timeout do ComfyUI; vídeo/reels.
9. Decidir: cadastro aberto vs só convite (segurança).
10. Responder a pergunta sobre replicabilidade multi-cliente (arquitetura multi-tenant).

## 29. Plano recomendado para finalizar o projeto

### P0 — CRÍTICO

| Tarefa | Objetivo | Arquivos | Dependências | Risco | Como validar | Status |
|--------|----------|----------|--------------|-------|--------------|--------|
| Commit inicial dos dois repos | Proteger todo o trabalho (zero commits hoje) | todo o working tree de ambos | nenhuma | Baixo; verificar .gitignore cobre `.env` | `git log` mostra commit; `git status` limpo | Pendente |
| Validar fix da tagline (LP) | Confirmar que a última edição não quebrou nada | `components/sections/hero.tsx` | dev server | Baixo | `npx tsc --noEmit` + `npm run lint` + `npm run build` + screenshot do hero | Pendente |
| Deploy do desigual-node no Jarbas e na Suzy | Destravar o chat dos 2 agentes (bloqueante nº 1) | `nodes/desigual-node/` + máquinas 100.118.12.97 / 100.86.237.73 | Acesso via VPS bastion; **autorização do usuário**; NÃO rotacionar nada | Alto (mexe em produção real com clientes) | Mensagem real no chat respondida por Jarbas e por Suzy; `GET /executions` confirma | Aguardando autorização |
| Migration + seed + restart (automações) | Ativar a Fase 3 | `database/migrations/`, `packages/database/src/seed.ts` | Redis + API + worker rodando | Médio | Criar automação na UI e vê-la disparar | Pendente |

### P1 — ALTA PRIORIDADE

| Tarefa | Objetivo | Arquivos | Dependências | Risco | Como validar | Status |
|--------|----------|----------|--------------|-------|--------------|--------|
| Teste E2E do cadastro da LP | Criar conta real na LP e logar no app :3010 | `components/cadastro-form.tsx`, `.env.local` | App rodando | Baixo | Conta criada → e-mail → login no app | Pendente |
| Wiring do WebSocket no frontend | Substituir polling por tempo real | `apps/web/src/lib/realtime/` (vazio), AppShell | Backend `/ws` (pronto) | Médio | Mensagens/notificações chegam sem refresh | Pendente (achado da QA nunca processado) |
| Decisão: signup aberto vs só convite | Fechar ponto de segurança aberto desde 02/set | `apps/web/src/app/signup/`, config | Decisão do usuário | Baixo | Política aplicada e testada | **Aguardando decisão do usuário** |
| Botão deletar artes do Studio | Completar CRUD da galeria | `apps/api/src/studio/`, `asset-gallery.tsx` | Storage + DB | Médio | Deletar asset some da galeria e do storage | Pendente |
| try/catch + validação de env no cadastro-form | Robustez do formulário | `components/cadastro-form.tsx` | nenhuma | Baixo | Erro de rede exibido na UI | Pendente |
| Remover prompt injection do AGENTS.md | Higiene de segurança | `apps/web/AGENTS.md`, `AGENTS.md` (LP) | Decisão do usuário (Claude pediu, sem resposta) | Baixo | Arquivo limpo | Aguardando ok |

### P2 — MÉDIA PRIORIDADE

| Tarefa | Objetivo | Arquivos | Dependências | Risco | Como validar | Status |
|--------|----------|----------|--------------|-------|--------------|--------|
| Deploy do Orchestrator na VPS | URL pública p/ webhook + produção | `apps/api`, `apps/worker`, `docker-compose.prod.yml`, `docs/deploy/` | Decisão Mac-local-vs-VPS (build de produção já resolvido, ver seção 25) | Alto | API respondendo na VPS; webhook ClickUp registrado e recebendo | Pendente (preparação pronta: `docker-compose.prod.yml`, `docs/deploy/vps-nginx.conf.example`, `docs/runbook.md`; falta a execução real, sem acesso a VPS neste ambiente) |
| Resolver redirect http/https do ClickUp OAuth | OAuth por usuário funcional | `packages/tool-gateway/src/clickup-oauth.ts` | Acesso ao app no ClickUp (owner) | Baixo | Fluxo OAuth completo | Pendente |
| `BENTO_VAULT_WRITER_URL` | Ativar auto-aprendizado real | máquina do Bento + `packages/orchestrator/src/learning.ts` | Acesso ao Bento | Médio | Aprendizado aparece no vault + reindex | Bloqueado (instruções entregues ao usuário) |
| Timeout do ComfyUI em carrossel | Estabilizar geração pesada | `nodes/studio-node/` | Máquina RTX | Médio | Carrossel gerado sem timeout | Pendente |
| UI de aprovações pendentes | Fechar fluxo do Tool Gateway | `apps/web` + rotas `/tool-calls` (prontas) | nenhuma | Baixo | Aprovar/rejeitar delete de task pela UI | Pendente |
| Dados reais em Knowledge/Monitoring | Eliminar dados ilustrativos | `apps/web/src/lib/knowledge/`, `lib/monitoring/` | Backend de knowledge (parcial) | Médio | Telas sem SAMPLE_* | Pendente |

### P3 — MELHORIAS

| Tarefa | Objetivo | Arquivos | Dependências | Risco | Como validar | Status |
|--------|----------|----------|--------------|-------|--------------|--------|
| Testes automatizados (Fase 16) | Cobertura mínima | repo todo | nenhuma | Baixo | `pnpm test` verde | Não iniciada |
| Build de produção (esbuild/tsup) | Resolver ADR 0002 | configs de build | nenhuma | Médio | `pnpm build` gera artefatos | **Resolvido para apps/api e apps/worker** (2026-09-07); pendente ainda para nodes/* |
| Vídeo/reels no Studio | Geração real de vídeo | `nodes/studio-node/`, ComfyUI LTX-V/Wan | Confirmar modelos na RTX | Alto | Job de vídeo gera MP4 | Pendente |
| Entidade "agência" / multi-tenant | Responder pergunta final do usuário | schema + RBAC | Decisão de produto | Alto | Segunda agência operando isolada | Não iniciada |
| Fusão da LP no monorepo | `/cadastro` + `/login` relativos | LP + `apps/web` | Decisão de estrutura | Médio | LP servida pelo app | Planejada |
| Licença Remotion | Verificar necessidade comercial | — | Decisão do usuário | Baixo | Licença regularizada | Pendente |
| `economy_records` | Escritor de economia real | `packages/token-engine/` | Definição de cálculo | Baixo | Registros reais na tabela | Pendente |
| Preencher `infrastructure/` e `docs/` vazias | Documentar deploy/segurança | pastas vazias | Deploy feito | Baixo | Docs escritos | Pendente |
| Revisar `Brain-Marketing/` (refs Orvyn/Nyro) | Limpar reuso de outro projeto | `Brain-Marketing/` | nenhuma | Baixo | Conteúdo só Desigual | Pendente |

---

## Contradições registradas (histórico vs código atual)

**1. Studio "stub SVG" vs geração real**
- HISTÓRICO: ADR 0005 e docs antigas dizem que o Studio usa stub SVG placeholder.
- CÓDIGO ATUAL: `nodes/studio-node` gera de verdade via ComfyUI (`stub: false`); só video/reels/upscale falham honesto.
- POSSÍVEL CONTRADIÇÃO: documentação desatualizada, não código errado.
- RECOMENDAÇÃO: atualizar ADR 0005 e notas do vault; não tocar no código.

**2. "RTX 5090" vs RTX 4090**
- HISTÓRICO: spec do prompt mestre dizia RTX 5090; descoberta de 02/set confirmou **RTX 4090**; LP foi corrigida para "GPU dedicada".
- CÓDIGO ATUAL: LP já diz "GPU dedicada"; o `DOSSIE-LP-DESIGUAL-OS.md` (presente nos dois projetos) ainda menciona "RTX 5090" na ficha do Studio.
- RECOMENDAÇÃO: corrigir o dossiê quando houver autorização para editar.

**3. Signup aberto vs política de convite**
- HISTÓRICO: Claude recomendou "só convite" e marcou signup aberto como ponto de segurança; pergunta nunca respondida.
- CÓDIGO ATUAL: `/signup` aberto no app; LP também cria contas via signUp público.
- RECOMENDAÇÃO: decisão do usuário antes de qualquer mudança (P1).

**4. `apps/web/AGENTS.md` (prompt injection)**
- HISTÓRICO: Claude detectou o bloco "This is NOT the Next.js you know" como injection e pediu permissão para remover; sem resposta. O mesmo bloco é recriado pelo `next dev` (existe também na LP).
- CÓDIGO ATUAL: bloco presente nos dois projetos.
- RECOMENDAÇÃO: tratar como não confiável; remover com autorização.

**5. "Bento/Jarbas/Suzy/Studio online" nos probes das sessões**
- HISTÓRICO: healthchecks verdes em várias sessões.
- REALIDADE: dependiam de túneis SSH temporários do sandbox, já encerrados.
- RECOMENDAÇÃO: revalidar conectividade a partir do Mac do usuário antes de assumir que algo está online.

**6. README da LP**
- HISTÓRICO: cadastro evoluiu para signUp real; seção ProductShowcase foi adicionada.
- CÓDIGO ATUAL: README diz que cadastro é "TODO" e omite a seção.
- RECOMENDAÇÃO: atualizar README quando autorizado.

---

*Fim do documento. Nenhuma linha de código do projeto foi alterada durante esta recuperação.*
