# AI_CONTEXT — Contexto do Projeto e do Trabalho Recente

Este documento resume o que existe no repositório, onde cada frente está, e
qual o estado de cada uma. É a entrada para qualquer nova sessão de trabalho:
leia antes de tocar em código.

## 1. O que é o Desigual OS

Plataforma operacional da Agência Desigual (TypeScript/Node, monorepo pnpm +
turbo). Dentro dela vivem:

| Módulo | Responsabilidade |
|---|---|
| `apps/web` | Front-end Next.js (App Router). Inbox, Studio, Pipeline, Calendário, etc. |
| `apps/api` | Back-end Fastify. Rotas, serviços, worker entry (`server.ts`). |
| `apps/worker` | Processamento assíncrono dos jobs (turnos de agentes, automações). |
| `packages/database` | Schema Drizzle + migrations (PostgreSQL). |
| `packages/tool-gateway` | Clientes HTTP de ferramentas externas (ClickUp, Meta, Google Ads, Evolution/W-API, OpenWA). |
| `packages/auth`, `context-engine`, `orchestrator`, `router`, `node-protocol` | Infraestrutura interna: identidade, contexto por turno, orquestração, roteamento. |
| `brain/` | Vault (Obsidian) com regras dos agentes e do projeto. |
| `OpenWA-main/` | Checkout local do OpenWA (API REST multi-sessão). Não é código do Desigual OS. |

## 2. Os agentes

| Agente | Node | Onde vive | Capacidades | Limitações |
|---|---|---|---|---|
| **Bento** | Mac Mini próprio (OpenClaw + vault pessoal) | `apps/api/src/bento-*` | Leitura/escrita ClickUp, Obsidian, reasoning via LLM, ações autorizadas | Roda fora do servidor; o Brain é dele, não do repo |
| **Otto** (criativo) | Mac Mini próprio | `packages/otto`, `nodes/otto-node` | Criação (posts, carrosséis, decks), direção de arte, conteúdo | Roda fora do servidor |
| **Jarbas** (tráfego) | Mac Mini próprio | `apps/api/src/jarbas-*` | Meta Ads, Google Ads, analytics | — (não tocar neste agente a menos que a tarefa seja dele) |
| **Suzy** (social) | Mac Mini próprio | `apps/api/src/suzy-*` | Instagram/social | — |
| **Studio** | dentro do servidor (`apps/api/src/studio`) | — | Geração de imagens/edição dentro do processo | — |

Detalhes em `brain/Agentes/*.md`. As regras de ouro ficam em
`brain/01 - Regras de Ouro.md`.

## 3. As duas frentes atuais (2026-10)

Trabalhando na branch `feat/openwa-whatsapp-integration` (HEAD `0193395`).

### 3.1 Bento no WhatsApp — IMPLEMENTADO (reaproveitado)

O canal WhatsApp do Bento já existe como implementação completa, commitada em
`31eded8` + `0193395` (mergeado nesta branch):

- `apps/api/src/bento-whatsapp/` — gateway do Bento: recepção de mensagens,
  identidade por código de uso único, autorização por usuário/organização,
  memória conversacional, formatação natural de respostas, idempotência,
  testes de equivalência Web ↔ WhatsApp (`gateway.test.ts`, `equivalencia.test.ts`).
- `apps/api/src/bento-whatsapp/openwa/` — contrato e cliente HTTP do OpenWA
  (`contract.ts` define a interface `BentoWhatsappTransport` que qualquer
  cliente do OpenWA pode adaptar).
- `packages/database/src/schema/bento-whatsapp.ts` — tabelas de vínculo,
  mensagens e turnos.
- `apps/api/src/chat/` (`routes.ts`, `turn-service.ts`) — a execução do Brain
  existente recebe o canal como input; o Brain não mudou.

### 3.2 OpenWA + Inbox — EM IMPLEMENTAÇÃO

A frente da Inbox conecta o OpenWA como fornecedor de WhatsApp Business:

- `packages/tool-gateway/src/openwa-client.ts` — cliente HTTP do OpenWA
  (enviar texto/imagem/áudio/documento, health).
- `packages/tool-gateway/src/communication-provider-resolver.ts` — o vendor
  `openwa` entra no `CommunicationProvider`; envio por `POST /inbox/threads/:id/messages`
  já funciona com ele.
- `apps/api/src/openwa-integration/client.ts` — leitura do OpenWA
  (sessão, chats, contatos, histórico, mídia).
- `apps/api/src/openwa-integration/sync.ts` — ingestão assíncrona
  (contatos, chats, últimos 10 mensagens por chat) gravada nos mesmos
  modelos da frente Evolution.
- `apps/api/src/openwa-integration/routes.ts` — `GET /openwa/state` e
  `POST /openwa/sync`.
- A interface web já esperava esse fornecedor: `channel === 'whatsapp'` em
  `ThreadList`, `/inbox/threads*` em `apps/api/src/communications/`.

## 4. Como o Brain recebe mensagens (resumo técnico)

`POST /chat` (chat interno) → `chat/routes.ts` →
`createAndEnqueueExecution` → worker `execute-job` →
`runBentoOpenAiCore`/`runBentoAction` → ferramentas existentes.

O Bento sabe o **quem** está conversando porque o turno é carregado com a
identidade do usuário autenticado (nunca com o número do WhatsApp). No canal
WhatsApp, `bento-whatsapp/gateway.ts` faz a mesma coisa: resolve a identidade
pelo vínculo com código e executa o mesmo Brain.

## 5. Integrações existentes (não quebrar)

- **Evolution API / W-API** (`tool-gateway`): provider `evolution`/`wapi`,
  webhook de entrada, envio, health.
- **ClickUp**: cliente e OAuth próprios; também consumidos pelo worker.
- **Google Ads / Meta / Google Calendar / Microsoft Calendar / Notion**:
  apenas leitura via MCP/rotas internas.
- **OpenAI-compatible LLM** (`openai-provider`): usado pelos Bento.

## 6. Ambiente

- Node ≥ 20 (`.local/toolchain`), pnpm 9, turbo.
- Testes: `pnpm test` (vitest por pacote).
- Typecheck: `pnpm typecheck`. Lint: `pnpm lint`.
- Banco de teste: Supabase local em execução (containers ativos).
- Docker disponível; OpenWA local roda via compose dentro de `OpenWA-main/`.
