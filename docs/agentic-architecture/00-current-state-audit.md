# 00 — Foto do Estado Atual

Verificado em 15/09/2026 por leitura direta do código. Monorepo pnpm+turbo,
Node 20+, TypeScript, Drizzle/Postgres, Fastify, BullMQ/ioredis, Next.js (web).

## Topologia real

```
apps/
  api/      Fastify (~10.3k LOC): rotas, auth, chat, injeção de contexto operacional
  worker/   BullMQ (~3.6k LOC): AGENT_LOOP_V2 vive aqui (agentic-dispatch)
  web/      Next.js (UI, streaming, chat)
packages/
  agent-runtime/    state machine + loop universal + evaluator determinístico (609 LOC)
  context-engine/   escopo, temporal, cliente, contexto operacional, briefing (3.2k LOC)
  tool-gateway/     matriz de permissão + clickup client + bento-qa + approval (2k LOC)
  orchestrator/     memory-engine, event-store, learning, proactivity, queues (3.9k LOC)
  router/           classificador de intenção + regras + marketing-copy (852 LOC)
  types/            contratos: agent, execution, personalities, role (978 LOC)
  token-engine/     pricing/contagem (68 LOC)
  database/         schema Drizzle + 29 migrations
nodes/
  desigual-node/    node do Bento/Jarbas: openclaw client + obsidian reader (559 LOC)
  otto-node/        node do Otto: LLM local, brain próprio (1.7k LOC)
  studio-node/      geração de imagem/vídeo
```

## Inventário classificado

### Agent Runtime — `packages/agent-runtime` — GOOD
State machine real com 13 fases (`state.ts`), fases terminais explícitas, limites
de iteração por classe de tarefa (`MAX_ITERATIONS` simple=2/standard=5/complex=10),
loop universal agnóstico de LLM (`loop.ts`) com hooks understand→context→plan→
act→observe→evaluate→replan→finalize. **Regra de ouro implementada de verdade**:
o loop corta quando uma estratégia já falha é repetida (`strategiesTried`), evitando
retry cego disfarçado de replan. Checkpoint por transição via `onPhaseChange`.
Não é wrapper falso (seção 127): o runtime não chama LLM, os hooks do host chamam.

### Evaluator determinístico — `agent-runtime/evaluator.ts` + `agentic-profiles.ts` — GOOD
Régua objetiva sem LLM (ação ok 0.30 / observação não-vazia 0.25 / sem vazamento
interno 0.20 / cobertura de critérios 0.25), com pass em score>=0.6 E zero falhas.
Evaluator por agente sobreposto (`evaluatorFor`) corrige um falso-negativo real
achado em teste ao vivo (Jarbas com número mas sem a palavra "dados"). Satisfaz
seção 76 (determinístico antes de LLM). NEEDS_EVOLUTION apenas no eixo factual:
a cobertura é por palavra/substring, não por grounding em evidência (ver doc 02).

### Persistência de execução — `schema/agent-runtime.ts` (`agent_execution_states`, `agent_outcomes`) — GOOD
Todo turno agêntico grava checkpoint (upsert por executionId) e um `agent_outcome`
com goalCompletion, firstAttemptSuccess, iterations, toolFailures, evaluatorScore,
latencyMs, taskClass. É a fonte real de KPI/aprendizado (seções 66-68), gravada
fire-and-forget para não atrasar a entrega. Working memory = o próprio state
persistido. GOOD.

### Memória — `orchestrator/memory-engine.ts` (tabela `memories`) — GOOD (com limite declarado)
Pipeline real: relevância (descarta confirmação social/curto) → dedup por
conteúdo+escopo (sha256) → supersessão por `subject` (fato novo aposenta o antigo
do mesmo assunto) → gravação com confiança por origem (humano 0.9 > agente 0.5) e
importância. Recuperação só de fato ativo e não-expirado, escopada por
client/agent/user (seção 48: não vaza entre clientes). Reconfirmação só reforça
confiança se a FONTE for outra. Episódios do loop são gravados e relidos no
gatherContext. Isto NÃO é "memória falsa" (seção 128): não é só histórico de
conversa. LIMITE DECLARADO no próprio arquivo: sem contradição semântica (exigiria
LLM por escrita) e sem embedding/pgvector (busca é por escopo+kind+subject+
importância, não por similaridade). A busca vetorial de verdade vive fora, no
`bento-qa`.

### Tool Gateway — `tool-gateway/gateway.ts` — NEEDS_EVOLUTION
Existe controle de acesso real: matriz `agent_tools` (nega por omissão), log
obrigatório em `tool_calls` antes de decidir, fluxo de aprovação humana
(`requiresApproval` → notifica masters → `approveToolCall`), registro de
`tool_results`. Satisfaz seções 27-28 (permissão/classificação) e 85 (human-in-loop).
O que FALTA para ser o "Tool Gateway" pleno da seção 27: não há registro central
com input/output schema (Zod), timeout, retry-policy e idempotência POR TOOL como
metadado uniforme; o gateway controla acesso, mas a execução e verificação de cada
tool ainda vivem espalhadas (clickup-client, bento-qa-client, operational-context).

### Contexto operacional do Bento — `context-engine/build-operational-context.ts` + `api/lib/operational-context.ts` — NEEDS_EVOLUTION
Ponto forte real: dado AO VIVO do ClickUp é buscado por código determinístico
(tool-gateway) na camada da API e injetado como bloco marcado "ao vivo, consultado
agora", com precedência sobre memória, e falha de integração vira `failure` honesto
(nunca número chutado — anti-alucinação, seção 116). Resolve escopo (cliente/global/
pessoa), temporal (timezone São Paulo), e resolve membro por nome. Isto é a base
real de Operations Intelligence. O que FALTA (ver doc 02): não há `OperationalState`
consolidado com risk-engine, priority-engine e next-best-action como estágios
próprios (seções 48-52); hoje entrega contagem+listagem formatada, não ranking de
risco com evidência por item.

### Router / classificação — `packages/router` — GOOD (para fast/deep path)
Classificador de intenção + regras existe (seções 94-96: fast path vs deep path).

### Nodes remotos (execução do "pensamento") — `nodes/desigual-node`, `nodes/otto-node` — NEEDS_EVOLUTION
O hook `act` do runtime faz UMA chamada `callAgent(message)` ao node remoto
(desigual-node via openclaw para Bento/Jarbas; otto-node com LLM local para Otto).
Consequência arquitetural central: o laço PERCEBER→INVESTIGAR→EXECUTAR→OBSERVAR de
múltiplos passos com tool-calling NÃO acontece dentro do runtime — a retrieval real
é pré-injetada pela API, e o node reasoning é essencialmente single-shot sobre o
bloco injetado. A "segunda estratégia" do replan é apenas remover os blocos de
contexto e reenviar. Funciona, mas o "investigar adaptativo" (seção 15) é raso.

### MISSING (não existe hoje)
- **Evidence layer como entidade de 1a classe** (seções 24-26): não há tabela
  `evidence` nem linkage CLAIM→EVIDENCE rastreável. Evidência existe implícita
  (bloco "ao vivo", memória com confiança/fonte), mas não como store consultável.
- **Event store normalizado** (`agent_events` / `OperationalEvent`, seções 54-56):
  há `system_events` (observability) e `event-store.ts` no orchestrator + webhook,
  mas não a normalização provider→OperationalEvent como tabela própria.
- **Planner adaptativo** (seção 14): o hook `plan` devolve um array FIXO
  (`['entender','buscar contexto','consultar agente','validar','entregar']`).
- **Otto CreativeState** (seções 65-73) com histórico aprovado/rejeitado, research
  externo multi-fonte e self-revision como estágios — parcial no otto-node, não no runtime.

## Verificação executada
- `tsc --noEmit`: PASSOU (exit 0) em types, agent-runtime, context-engine,
  tool-gateway, orchestrator, router.
- `vitest`: BLOQUEADO no ambiente da auditoria (node_modules macOS em shell Linux).
  Rodar na máquina do repo. Ver README.
