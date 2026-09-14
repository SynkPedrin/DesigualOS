# Arquitetura Agentic V2

Status: implementado (parcial, atrás de feature flag)
Data: 2026-09-11
Escopo: dispatch single-agent do chat. Workflows multi-agente não passam pelo loop.

## O que é a V2

A V2 não reescreve os agentes. Ela envolve o dispatch que já existia com um loop
de estado (understand, context, plan, act, observe, evaluate, replan) que garante
objetivo declarado, contexto recuperado de memória, avaliação determinística da
resposta, replan com estratégia materialmente diferente, checkpoint a cada fase e
outcome medido por execução. O agente remoto (Bento, Jarbas, Otto, Suzy) continua
sendo quem pensa; o runtime ao redor garante o processo.

## Diagrama do sistema

```
                         ┌────────────────────────── DESIGUAL OS ──────────────────────────┐
                         │                                                                 │
 Usuário (web chat)      │  apps/api                      apps/worker                      │
      │                  │  ┌───────────────┐            ┌──────────────────────────────┐  │
      │ POST /chat       │  │ chat/routes.ts│            │ processors/execute-job.ts    │  │
      ▼                  │  │ - Router      │  enqueue   │  - flag AGENT_LOOP_V2        │  │
  apps/web               │  │ - resolve     │ ─────────► │    (default off)             │  │
  chat-thread.tsx        │  │   cliente/    │  (BullMQ)  │         │                    │  │
  thinking-steps.tsx     │  │   escopo      │            │         ▼                    │  │
      ▲                  │  │ - buildContext│            │  processors/                 │  │
      │ WS agent.phase   │  │   (context-   │            │  agentic-dispatch.ts         │  │
      │                  │  │   engine)     │            │  ┌────────────────────────┐  │  │
      │                  │  └───────────────┘            │  │ runAgentLoop           │  │  │
      │                  │                               │  │ (@desigual-os/         │  │  │
      │                  │  packages/orchestrator        │  │  agent-runtime)        │  │  │
      │                  │  ┌───────────────────┐        │  │                        │  │  │
      └──────────────────┼──│ pubsub.ts          │◄───────┼──│ onPhaseChange ──► WS   │  │  │
        Redis pub/sub    │  │ memory-engine.ts   │◄───────┼──│ gatherContext/recall   │  │  │
                         │  │ learning.ts        │◄───────┼──│ rememberFact (episódio)│  │  │
                         │  └───────────────────┘        │  └──────────┬─────────────┘  │  │
                         │                               │             │ callAgent       │  │
                         │  Postgres (Supabase)          │             ▼                 │  │
                         │  ┌───────────────────┐        │  ┌────────────────────────┐  │  │
                         │  │ memories          │        │  │ agente REMOTO (caixa-  │  │  │
                         │  │ agent_execution_  │        │  │ preta fora do repo):   │  │  │
                         │  │   states (0025)   │◄───────┼──│ bento-qa, desigual-    │  │  │
                         │  │ agent_outcomes    │        │  │ node, otto-node...     │  │  │
                         │  │   (0025)          │        │  └────────────────────────┘  │  │
                         │  └───────────────────┘        └──────────────────────────────┘  │
                         │          ▲                                                       │
                         │          │ GET /agents/kpis (apps/api/src/agents/routes.ts)      │
                         └─────────────────────────────────────────────────────────────────┘
```

## Decisões de arquitetura (ADR resumido)

### 1. Evolução incremental, não reescrita

A spec V2 descreve um sistema inteiro novo (planner com LLM, autonomy policy por
níveis, artifact engine, evaluator por LLM). A decisão foi extrair dela o que
fecha os defeitos medidos no sistema real: retry cego, resposta ruim entregue sem
checagem, memória escrita e nunca lida, aprendizado sem dedup nem supersessão,
etapas de "pensando" inventadas pela UI. O restante da spec fica marcado como
não implementado em cada documento desta pasta, nunca apresentado como existente.

### 2. O loop vive no worker, junto do Orchestrator

`runAgentLoop` é um pacote novo e puro (`packages/agent-runtime`): não sabe nada
de LLM, ClickUp ou máquinas remotas. Os hooks (understand, gatherContext, plan,
act, evaluate, finalize, onPhaseChange) são injetados pelo host, hoje o worker
em `apps/worker/src/processors/agentic-dispatch.ts`. Isso mantém o runtime
testável de forma isolada (12 testes em `loop.test.ts`) e permite plugar outros
hosts no futuro sem mexer no loop.

### 3. Agentes remotos são ferramentas, não participantes do loop

bento-qa e os agentes-desigual rodam fora do repo, em máquinas próprias (Mac
Minis/RTX via Tailscale). São caixa-preta: o loop os chama via `callAgent` dentro
do hook `act`, registra a chamada como `ToolCallRecord` (`agent:<nome>`) e avalia
a observação que volta. Não há como impor fases internas a eles; a governança
possível é a que o runtime faz em volta.

### 4. Feature flag AGENT_LOOP_V2, default off

O loop só assume o dispatch single-agent quando `AGENT_LOOP_V2=true` no worker
(`apps/worker/src/processors/execute-job.ts:42`). Desligado, o caminho é
exatamente o de antes. Rollback é unset na env + restart. Detalhes em
MIGRATION.md.

## O que mudou vs o que ficou

Mudou (novo na V2):

- `packages/agent-runtime/`: state machine, loop genérico, evaluator determinístico, 12 testes.
- `apps/worker/src/processors/agentic-dispatch.ts` e `agentic-profiles.ts`: integração do loop, goal/critérios/evaluator por agente, classificação de tarefa.
- Tabelas `agent_execution_states` e `agent_outcomes` (migration 0025).
- Evento WS `agent.phase` (`packages/orchestrator/src/pubsub.ts`) e consumo no frontend (`ws-client.ts`, `chat-thread.tsx`, `thinking-steps.tsx`, `chat-message.tsx`).
- Endpoint `GET /agents/kpis` (`apps/api/src/agents/routes.ts:67`).
- Escopo `userId` em `recallMemories` (user memory real).
- `flushPendingLearnings` agendado a cada 5 min no worker (`apps/worker/src/index.ts`).
- `recordLearning` passou a escrever via `rememberFact` (dedup + supersessão + filtro de relevância), sem mudar a assinatura pública.

Ficou (pré-existente, reusado):

- `packages/context-engine` inteiro: buildContext, resolve-client, resolve-scope, briefing-engine. Não existe Context Engine V2 novo.
- `packages/orchestrator/src/memory-engine.ts`: rememberFact/recallMemories já existiam testados; a V2 passou a chamá-los de fato.
- Funil de aprendizado do Otto (`packages/otto/src/learning/pipeline.ts`).
- Tool Gateway (`packages/tool-gateway`), matriz `agent_tools`, filas BullMQ, Router, handoff Otto→Studio.

## Limites declarados da arquitetura atual

- Sem streaming token-a-token: a resposta chega inteira ao fim da execução.
- Sem evaluator por LLM: toda avaliação é determinística (barata, explicável, limitada).
- Handoff estruturado entre agentes existe só no caminho Otto→Studio (`handoffOttoProductionSpec` em execute-job.ts).
- Artifact engine e geração de PDF: não implementados.
- Autonomy policy por níveis: não formalizada. O que existe é o Tool Gateway com aprovação para ações críticas.
- A flag cobre só o dispatch single-agent: workflows multi-agente não passam pelo loop.
- Semantic search por embedding: não implementada no Orchestrator (recall é por escopo + importância + recência).
