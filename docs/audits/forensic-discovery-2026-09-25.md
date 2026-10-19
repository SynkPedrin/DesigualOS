# Auditoria Forense — FASE A (Discovery) — 2026-09-25

Escopo: reconhecimento completo do repositório, reconstrução da arquitetura REAL a partir do código executável. Nenhuma alteração de código foi feita nesta fase.

---

## 1. Mapa arquitetural real

### Stack
- TypeScript ESM, Node ≥20, monorepo pnpm 9.9 + Turborepo 2.1. Packages exportam `./src` direto; processos rodam via `tsx` (sem build).
- API: Fastify 5 (`apps/api`, porta 3001). Web: Next.js/React 19 (`apps/web`, Vercel). Worker: BullMQ sobre Redis 7 (`apps/worker`).
- DB: Postgres Supabase via Drizzle ORM (`packages/database`), 44 migrations, ~74 tabelas. Auth: Supabase JWT + RBAC próprio (ADR 0001).
- Produção: launchd (`infra/launchd/`) ou supervisor.sh no Mac + docker-compose.prod na VPS; agentes externos em Mac Minis na Tailnet.

### Componentes
| Componente | Papel real |
|---|---|
| `apps/api` | HTTP/WS: chat, conversations, ClickUp OAuth/webhook, Studio, Motion, nodes, admin. 30+ grupos de rotas (`apps/api/src/server.ts:205-233`) |
| `apps/worker` | Consumidor BullMQ (fila por agente), schedulers diários, GPU gateway :11500 |
| `apps/web` | Chat-first + Studio canvas; modo mock MSW |
| `packages/agent-runtime` | Agent loop V2: `runStepLoop` (usado) e `runAgentLoop` (aparentemente morto) |
| `packages/bento-core` | Planner LLM-sem-tools + policy determinística do Bento |
| `packages/context-engine` | Resolução de escopo/cliente/data + montagem de contexto via SQL. **Não é motor de embeddings** |
| `packages/tool-gateway` | Clientes ClickUp REST/OAuth/MCP-OAuth, matriz de permissões `agent_tools`, cripto AES-256-GCM |
| `packages/orchestrator` | Filas, dispatch, pubsub WS, memory-engine, episodic-memory, vault-writer, event-store |
| `packages/otto` | LLM (OpenAI default/Ollama rollback), brain retrieval lexical, pipeline criativo |
| `packages/otto-motion` | Motion engine Remotion via Claude Code CLI headless (flag `OTTO_MOTION_ENABLED`) |
| `nodes/otto-node` | Otto real: Fastify :4002, execute.ts com pipeline criativo completo |
| `nodes/studio-node` | Worker BullMQ `studio_jobs` na máquina RTX (ComfyUI/Flux/QA) |
| `nodes/desigual-node` | Node genérico p/ Mac Minis (Bento/Jarbas/Suzy via OpenClaw) — caminho de produção do chat NÃO passa por ele |

### Tabelas ausentes no schema
`sessions`, `entities`, `resources`, `traces` não existem como tabelas. Estado de recursos vive em `conversation_context` + `messages.metadata.selecao`. Embeddings = jsonb placeholder nunca escrito (sem pgvector).

---

## 2. Inventário de agentes (5 canônicos)

| Agente | Execução real | Modelo | Memória |
|---|---|---|---|
| **Bento** | Caminho A (flag off, produção): `bento-action-guard.ts` regex → executores REST com read-back; fallback cego p/ serviço externo `bento-qa` (:8791, fora do repo). Caminho B (flag `BENTO_OPENAI_CORE_ENABLED`, off): planner LLM sem tools → policy determinística → MCP ou REST legado | bento-qa remoto opaco; planner novo `gpt-5.6-terra` | Vault remoto + episodic/semantic via orchestrator + `ConversationResourceState` (só caminho novo) |
| **Jarbas** | Serviço externo `agentes-desigual` :3102. **Nunca entra no Agent Loop V2** (`execute-job.ts:96-100`) | remoto opaco | — |
| **Suzy** | Idem Jarbas | remoto opaco | — |
| **Otto** | `nodes/otto-node/src/execute.ts` — pipeline próprio neste repo | `gpt-5.6-terra` (OpenAI default); rollback Ollama mistral | Brain-Marketing (lexical) + DNA de feedbacks |
| **Studio** | Pipeline de mídia, sem persona | ComfyUI/Flux + visual-critic | — |

Mais: Otto Motion = sub-agente codegen Claude Code (`claude-opus-5-5`, sandboxed, MCP zerado).

---

## 3. Cérebro, contexto, memória, tools — estado real

### Ciclo agêntico
Existe: `runStepLoop` (`packages/agent-runtime/src/step-loop.ts:143`) com passos `retrieve|analyze|tool|verify|evaluate`, limites duros (12 steps, 8 tool calls, 300s), término exige passos-porta. Host: `agentic-dispatch.ts:244`. **Na prática, o caminho comum é 1 chamada ao node + verify + evaluate**, com replan reduzido único. `runAgentLoop` (`loop.ts`) existe mas não é consumido pelo dispatch.

### Contexto
`context-assembler.ts`: ordem por autoridade (frescor→diálogo→cliente→campanha→pessoas→episódios→preferências→aprendizado), teto **14.000 chars** — orçamentos em **caracteres, nunca tokens**. Tudo que entra no prompt vira `Evidence` (grounding reprova claim sem evidência).

### Memória (inventário)
| Tipo | Status | Evidência |
|---|---|---|
| Working | PARCIAL | `execution_blackboards` morto (documentado); checkpoint em `agent_execution_states` |
| Conversation | EXISTE | `conversations`/`messages`; diálogo recente 6 turnos/1800 chars |
| Resource | PARCIAL | `ConversationResourceState` só do Bento, só populado pelo caminho novo |
| Project | EXISTE | `projects`/`project_files` |
| Client | EXISTE | dossiê triplo-fonte, `campaigns`, `people`, brand kits |
| Agency | PARCIAL | vault estático + `operational_events`; sem entidade própria |
| Episodic | EXISTE | `agent_episodes`, regex de forma, dedup hash, recall temporal ILIKE |
| Semantic | EXISTE | `memories`, `memory-engine.ts` com dedup/supersessão/confiança |
| Procedural | PARCIAL | episódio "estratégia vencedora" no fim do loop |

Retrieval 100% lexical/SQL — **não existe geração de embedding no repo** (declarado em `memory-engine.ts:27-29`).

### Tools / Tool Gateway
Não é function-calling livre: matriz `agent_tools` com ações sensíveis → aprovação humana atômica (`gateway.ts:169-188`). Planner do Bento é LLM **sem tools** que devolve ação estruturada; policy determinística resolve alvo e barra UPDATE→CREATE (`policy.ts:42`, `target_unresolved` → esclarecimento).

---

## 4. Fluxo Bento → MCP → ClickUp (reconstruído)

USER → `POST /chat` (idempotência 15s) → conversa/sessão (snapshot de seleção em `messages.metadata.selecao`) → router → contexto operacional ClickUp ao vivo → BullMQ → worker:

- **Caminho novo (flag off)**: planner LLM sem tools → ponte com snapshot legado → policy (id explícito → foco → seleção única → última execução; nunca busca global) → dedup intra-conversa → provider MCP (se token OAuth) ou LEGACY → read-back → persiste estado.
- **Caminho antigo (produção)**: regex PT de intenção em `bento-action-guard.ts` → executores com read-back campo-a-campo. Frase não coberta por regex → cai no `callBento` externo **cego** (pode criar tasks sem idempotência nem read-back).
- MCP = tool nativa `type:'mcp'` da OpenAI Responses API contra `mcp.clickup.com` (execução server-side; sem client MCP próprio; sem `allowed_tools` em produção; sem enumeração de schemas).

**Lacunas confirmadas**: refresh de token OAuth MCP ausente (expiração → fallback silencioso pro legado); MCP sem reconcile-first anti-duplicata no create; MCP não grava ExecutionRecord (dedup depende do legado); extração do task_id do output MCP é best-effort (`bento-mcp-executor.ts:137-146`); read-back MCP é só de existência, não campo-a-campo; REST legado sem retry/backoff p/ 429.

---

## 5. Pipeline cognitivo do Otto (reconstruído)

`/chat` → worker monta contexto (conversa recente + identidade do cliente + brand kit) → `POST /execute` otto-node → classificação de profundidade/intenção (determinística) → classificação referencial → retrieval lexical Brain-Marketing cercado por clientSlug → DNA criativo (depende de brand kit no request) → chat (1 LLM + piso de placeholders) ou produção (estado → lacunas → pesquisa rara → plano → anti-genérico determinístico → estratégia → shaping → critic LLM + linters → até 2 rewrites → melhor candidato válido → reparos → invariantes).

**Achados estruturais**: provider OpenAI **descarta temperature silenciosamente** (`packages/otto/src/llm/openai-provider.ts:61-68`) e **achata multi-turn numa string**; chat não tem julgamento criativo (só placeholders); cerca de cliente depende de regex sobre texto do orquestrador; ~275 fallbacks `.catch(() => null/[])` podem esvaziar contexto sem erro visível; tokens nunca medidos (`usage` sempre 0); prompts/respostas do LLM não persistidos.

---

## 6. Primeiros P0/P1 (evidência no código)

| ID | Sev | Achado | Evidência |
|---|---|---|---|
| D-01 | P0 | Fallback cego pro bento-qa externo quando regex do guard não casa: UPDATE pode virar CREATE sem idempotência/read-back | `bento-action-guard.ts:38-46`, `execute-job.ts:1218-1226` |
| D-02 | P0 | Intenção UPDATE depende de regex PT; cada phrasing novo = incidente | comentários `bento-action-guard.ts:73-119` |
| D-03 | P0 | Dois estados de recurso paralelos (novo `conversation_context` vs snapshot legado) historicamente desconectados; ponte de 25/09 é recente e frágil | `bento-legacy-selection-bridge.ts:6-29` |
| D-04 | P0 | MCP path: task_id best-effort; falha → foco não registrado → follow-up perde referência | `bento-mcp-executor.ts:137-146` |
| D-05 | P1 | Caminho de produção real (flag off) não usa o core novo: invariantes UPDATE≠CREATE só valem no caminho novo | `execute-job.ts:1188-1203` |
| D-06 | P1 | Token OAuth MCP sem refresh → degradação silenciosa pro legado | `clickup-mcp-oauth.ts:142-146,164-171` |
| D-07 | P1 | ~275 fallbacks silenciosos degradam contexto sem sinal (histórico, cliente, memória) → outputs genéricos | `execute-job.ts:1430`, `client-context.ts:146-273`, `agentic-dispatch.ts:325-582` |
| D-08 | P1 | Temperature descartada no provider OpenAI do Otto; tuning de criatividade inexistente em produção | `packages/otto/src/llm/openai-provider.ts:61-68` |
| D-09 | P1 | `build-context.ts` não filtra `environment` em client.profile/learnings → fura isolamento QA/prod | `build-context.ts:121-140,158-186` |
| D-10 | P1 | Observabilidade insuficiente p/ "por que o agente fez X": prompts/respostas LLM não persistidos, usage=0, sem reqId↔execution_id | `execute.ts:753,1747`, `responses-client.ts:143` |
| D-11 | P1 | Concorrência NOT VERIFIED (auditoria 22/09); otto-node single-thread empilha jobs >405s | `DESIGUAL_OS_RELEASE_READINESS_AUDIT.md:565`, BL-14 |
| D-12 | P1 | "Agora gostei" regenera artefato em vez de congelar (P1-10 aberto) | launch report 23/09 |
| D-13 | P2 | Continuidade cross-conversa só via episódio regex; decisões fora das formas se perdem | `episodic-memory.ts:46-55` |
| D-14 | P2 | Retry OpenAI: 1 retry imediato sem backoff/jitter em 429 | `responses-client.ts:139-146` |
| D-15 | P2 | Vault consolidado `./vault-clientes` é escrito mas nunca relido por retrieval | `vault-writer.ts` |
| D-16 | P2 | Sem contagem de tokens; orçamentos em chars | `context-assembler.ts:122` |

Auditorias anteriores convergentes: forense 25/09 = 42/100 NOT READY (4 tasks de 1 pedido; continuidade quebrada B04-B06; ponderação causal: 35% contexto/memória, 25% planner/parser, 20% tool runtime, 10% observabilidade, 10% modelo); readiness 22/09 = 47/100 RED.

---

## 7. Hipóteses anteriores que estavam ERRADAS

1. **"Faltavam testes E2E"** — errado: existem E2E sérios de continuidade/referência indireta (`continuidade.spec.ts`, `bento-continuity.spec.ts`), mas são `test.skip` sem credenciais QA e rodam contra front publicado; qualidade julgada por humano. O gap é de assertions de estado/proveniência e de fault injection, não de existência.
2. **"Trocar modelo resolve"** — errado: forense anterior já provou que P0s são estruturais (cardinalidade, memória de recurso, idempotência).
3. **"MCP conectado = integração correta"** — errado: MCP delegado à OpenAI sem schemas, sem allowed_tools, sem refresh de token, read-back só de existência.
4. **"O sistema não tem ciclo agêntico"** — parcialmente errado: existe step-loop com verify/evaluate, mas o caminho comum degenera para 1 chamada + verify.
5. **"Não existe memória"** — errado: memória episódica/semântica existe e é bem governada; o problema é working/resource memory fragmentada e retrieval lexical.

---

## 8. Plano da FASE B (diagnóstico)

1. Reproduzir os 4 incidentes P0 do forense de hoje em ambiente controlado (QA isolado) com trace completo: multi-create, continuidade B04-B06, `sources:[]`, update→create.
2. Construir matriz de cobertura do `bento-action-guard`: quais phrasings caem no fallback cego (D-01/D-02).
3. Decisão arquitetural: unificar os dois estados de recurso (D-03) e os dois caminhos de escrita (D-05) — ou promover o core novo, ou endurecer o guard.
4. Fault injection: timeout pós-create, retry, double-click, webhook duplicado, MCP disconnect.
5. Medir degradação de contexto: instrumentar os ~275 fallbacks com contadores/log estruturado (D-07) antes de mudar Otto.
6. Teste fundamental de memória (seções 9 da missão): cenário 4 semanas.
7. Scorecard Otto E2E com campanha real (gap P1-03) antes/depois de correções de contexto.
