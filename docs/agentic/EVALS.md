# Evals e Evidências

Status: suíte unitária do loop verde (12 testes), testes live de memória e WS
executados contra produção com sucesso. Sem CI dedicada à V2 ainda.

## 1. Testes unitários do agent loop

```
pnpm --filter @desigual-os/agent-runtime test
```

Arquivo: `packages/agent-runtime/src/loop.test.ts` (vitest). 12 testes:

| # | Teste | O que prova |
|---|---|---|
| 1 | caminho feliz | Passa por UNDERSTANDING→GATHERING_CONTEXT→PLANNING→ACTING→OBSERVING→EVALUATING→FINALIZING→COMPLETED, 1 iteração, score ≥ 0.6 |
| 2 | SELF-CORRECTION | Primeira estratégia falha, segunda (diferente) entrega: COMPLETED em 2 iterações, `strategiesTried` com as duas |
| 3 | anti-retry-idêntico | Mesma estratégia duas vezes vira FAILED no segundo ACT, nunca loop infinito |
| 4 | limite por classe | taskClass `simple` para em 2 iterações (MAX_ITERATIONS.simple) e FAILED |
| 5 | falha não recuperável | `recoverable: false` encerra em 1 chamada, sem gastar iterações |
| 6 | needsUserInput | Encerra em NEEDS_USER_INPUT com a resposta do finalize (pergunta de clarificação) |
| 7 | checkpoint | `onPhaseChange` recebe todas as transições na ordem (`RECEIVED->UNDERSTANDING` até `FINALIZING->COMPLETED`, 8 transições) |
| 8 | exceção em hook | Exceção no gatherContext vira FAILED e propaga |
| 9 | evaluator reprova observação vazia | pass=false com failures legíveis |
| 10 | evaluator reprova vazamento interno | Texto com comando de agente ("`pergunta pro bento: ...`") é reprovado |
| 11 | evaluator aprova observação completa | Critérios cobertos: pass=true, score=1 |
| 12 | estado inicial | createInitialState coerente (RECEIVED, 0 iterações) |

Testes de apoio já existentes e relevantes (pré-V2, continuam valendo):

```
pnpm --filter @desigual-os/orchestrator test      # memory-engine.test.ts, queues, alerts...
pnpm --filter @desigual-os/context-engine test    # build-context, resolve-client, resolve-scope, briefing-engine
pnpm --filter @desigual-os/otto test              # learning/pipeline.test.ts, learning/feedback.test.ts
pnpm test                                         # turbo: todo o monorepo
```

## 2. Teste live de memória (Supabase real)

```
cd apps/worker && pnpm tsx scripts/qa-memory-test.mts
```

Arquivo: `apps/worker/scripts/qa-memory-test.mts` (o original foi movido de
`scripts/qa/memory-test.mts` para junto do worker, que é onde roda). 8 checks
contra o Supabase REAL com kinds `qa.test*` e cleanup ao final:

1. memória persiste entre conversas (escrita numa "conversa 1", recall numa "conversa 2")
2. isolamento cliente A/B (memória do cliente A não aparece no recall do B, CRÍTICO)
3. user memory persiste (escopo userId, novo na V2)
4. isolamento user A/B
5. supersessão: fato novo sobre o mesmo subject fica ativo
6. supersessão: fato antigo sai do recall (aposentado)
7. histórico auditável preservado (linha antiga continua no banco com status `superseded`)
8. cleanup remove só as linhas QA

Resultado registrado: todos os checks PASS.

## 3. Teste live de fases WS

```
node scripts/qa/ws-phases.mjs "mensagem de teste" JARBAS
```

Arquivo: `scripts/qa/ws-phases.mjs`. Envia mensagem real no `POST /chat`,
escuta o WebSocket e captura os eventos `agent.phase` da execução (requer token
em `/tmp/desigual-qa-token`, gerado por `scripts/qa/login.mjs`). Prova que a UI
recebe fases REAIS (label, attempt) em vez de etapas inventadas.

## 4. Execução real de referência

Execução ao vivo do Jarbas via chat com a flag ligada: COMPLETED em 1 iteração,
evaluator_score 1.0, outcome gravado em `agent_outcomes`, checkpoints em
`agent_execution_states`, episódio em `memories` (kind `agent.episode`) e fases
`agent.phase` recebidas no WS. Verificável com:

```
GET /agents/kpis        # task_success_rate, first_attempt_success_rate, avg_iterations por agente
SELECT * FROM agent_outcomes ORDER BY created_at DESC LIMIT 5;
SELECT execution_id, phase, iterations, evaluator_score FROM agent_execution_states ORDER BY updated_at DESC LIMIT 5;
```

## Matriz de cobertura vs spec V2

| Item da spec | Cobertura | Como |
|---|---|---|
| Loop com fases e estado | Testado | loop.test.ts (12 testes) |
| Self-correction com estratégia diferente | Testado | loop.test.ts #2 + execução real |
| Anti-retry-idêntico | Testado | loop.test.ts #3 |
| Limites por classe de tarefa | Testado | loop.test.ts #4 |
| Evaluator determinístico | Testado | loop.test.ts #9-11 |
| Checkpoint por transição | Testado | loop.test.ts #7 + live (tabela) |
| Outcomes e KPIs | Parcial | KPIs calculados; sem série temporal nem alertas de regressão |
| Memória: persistência, escopo, supersessão | Testado live | qa-memory-test.mts (8 checks) |
| Fases reais na UI | Testado live | ws-phases.mjs |
| Evaluator por LLM | Não implementado | Sem cobertura (não existe) |
| Semantic search | Não implementado | Sem cobertura (não existe) |
| Multi-agente no loop | Não implementado | Flag cobre só single-agent |
| Resume após restart do worker | Não implementado | Checkpoint é auditável, não retomável |
| Suite de evals com casos canônicos de conversa | Não implementada | Próximo passo: golden set de mensagens + respostas esperadas |
