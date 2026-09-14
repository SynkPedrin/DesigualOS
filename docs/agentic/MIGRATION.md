# Migração para o Agentic V2

Status: aplicada em produção (migration 0025 + flag AGENT_LOOP_V2).
Data: 2026-09-11.

## O que mudou no banco

Migration `database/migrations/0025_chunky_energizer.sql`. Estritamente
aditiva: cria duas tabelas novas, não altera nem remove nada existente.

### agent_execution_states (checkpoint do loop)

| Coluna | Tipo | Nota |
|---|---|---|
| id | uuid PK | |
| execution_id | text UNIQUE | Um checkpoint por execução (upsert a cada transição) |
| agent | agent_name | |
| user_id / client_id / conversation_id | uuid | FKs para users e clients (ON DELETE set null) |
| phase | text | Fase atual do loop |
| task_class | text | simple / standard / complex |
| iterations | integer | |
| evaluator_score | numeric(4,3) | |
| state | jsonb | AgentExecutionState completo (trace auditável) |
| created_at / updated_at | timestamptz | |

Índices: agent, user_id, client_id.

### agent_outcomes (outcome por execução)

| Coluna | Tipo | Nota |
|---|---|---|
| id | uuid PK | |
| execution_id | text UNIQUE | Uma linha por execução terminada |
| agent | agent_name | |
| user_id / client_id / conversation_id | uuid | FKs para users e clients |
| goal_completion | boolean | Completou? |
| first_attempt_success | boolean | Completou na iteração 1? |
| iterations | integer | |
| tool_failures | integer | |
| evaluator_score | numeric(4,3) | |
| latency_ms | integer | |
| task_class | text | |
| user_feedback | text | Campo reservado; coleta não implementada |
| created_at / updated_at | timestamptz | |

Índices: agent, client_id, created_at.

Aplicar: `pnpm db:migrate` (ou o processo padrão de migrations do repo).

## Como ligar

No worker, definir a env e reiniciar:

```
AGENT_LOOP_V2=true
```

Ponto de leitura da flag: `apps/worker/src/processors/execute-job.ts:42`
(`process.env.AGENT_LOOP_V2 === 'true'`). Default: desligado. Documentada em
`.env.example` (com `AGENT_LOOP_V2=false`).

## Compatibilidade

Com a flag OFF o comportamento é byte a byte o de antes: o dispatch
single-agent segue o caminho original do execute-job, sem loop, sem checkpoint,
sem outcome, sem eventos `agent.phase`. Nenhum consumidor existente é
obrigado a conhecer as tabelas novas.

Com a flag ON:

- O dispatch single-agent passa pelo loop. O contrato de resposta
  (`ExecuteResponse`) é o mesmo, com um bloco extra em
  `metadata.agentic` (task_class, iterations, strategies_tried,
  evaluator_score, phase) que consumidores antigos simplesmente ignoram.
- O frontend sem o código novo de `agent.phase` também não quebra: o evento
  é apenas mais um tipo no envelope WS e é ignorado por clients antigos.
- Workflows multi-agente (consolidation, handoffs) NÃO passam pelo loop:
  comportamento inalterado com ou sem flag.
- A migração de schema do drizzle inclui `packages/database/src/schema/agent-runtime.ts`
  (fonte das duas tabelas); rodar typecheck/build normal após o pull.

## Rollback

1. Remover ou comentar `AGENT_LOOP_V2` na env do worker (ou setar `false`).
2. Reiniciar o worker.

Pronto. As tabelas novas são aditivas: podem ficar no banco sem efeito
colateral (o que já foi gravado permanece como evidência histórica). Se for
necessário remover de fato (não recomendado), `DROP TABLE agent_outcomes,
agent_execution_states` não afeta nenhuma tabela pré-V2, pois as FKs apontam
delas para users/clients, nunca o contrário.

Rollback de código (se o problema for o pacote novo): reverter o merge que
trouxe `packages/agent-runtime`, `agentic-dispatch.ts`, `agentic-profiles.ts`
e a chamada condicional em execute-job.ts. Sem a flag, mesmo com o código
presente, nada muda.

## Dados antigos

Totalmente preservados. A 0025 não toca em `memories`, `executions`,
`tool_calls` nem nenhuma tabela existente. As memórias gravadas antes da V2
pelo INSERT cru antigo de `recordLearning` continuam ativas e legíveis; fato
novo sobre o mesmo subject passa a aposentar a antiga normalmente daqui pra
frente (não há backfill de dedupeKey nem limpeza retroativa: decisão
consciente, pois reescrever histórico destruiria a auditoria).

## Verificação pós-migração

```
# 1. Tabelas existem
SELECT to_regclass('agent_execution_states'), to_regclass('agent_outcomes');

# 2. Com a flag ON, enviar mensagem no chat e conferir
SELECT execution_id, agent, phase, iterations, evaluator_score
  FROM agent_execution_states ORDER BY updated_at DESC LIMIT 3;
SELECT agent, goal_completion, first_attempt_success, iterations, evaluator_score
  FROM agent_outcomes ORDER BY created_at DESC LIMIT 3;

# 3. KPIs
GET /agents/kpis   # autenticado

# 4. Fases na UI: os indicadores de "pensando" mostram fases reais
#    (ex: "Validando a resposta") em vez das etapas genéricas
```
