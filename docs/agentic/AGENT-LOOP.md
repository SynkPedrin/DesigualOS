# Agent Loop (Agentic V2)

Status: implementado e testado (12 testes unitários)
Código: `packages/agent-runtime/` (state.ts, loop.ts, evaluator.ts, loop.test.ts)
Host: `apps/worker/src/processors/agentic-dispatch.ts`

## Visão geral

`runAgentLoop` (`packages/agent-runtime/src/loop.ts:71`) é o loop universal do
Agentic V2. Ele é deliberadamente burro sobre domínio: não sabe o que é um LLM,
um agente remoto ou o ClickUp. O host injeta hooks que executam o trabalho real;
o runtime garante estado, ordem das fases, limites de iteração, avaliação e a
regra de ouro do replan: nunca repetir uma estratégia que já falhou.

## Fases

Definidas em `packages/agent-runtime/src/state.ts:7`:

```
RECEIVED -> UNDERSTANDING -> GATHERING_CONTEXT -> PLANNING
         -> ACTING -> OBSERVING -> EVALUATING
         -> (pass) FINALIZING -> COMPLETED
         -> (fail, recuperável) REPLANNING -> ACTING ...
         -> (fail, terminal) FAILED
         -> (falta informação do usuário) NEEDS_USER_INPUT
```

Fases terminais: `COMPLETED`, `FAILED`, `NEEDS_USER_INPUT` (`TERMINAL_PHASES`).
`WAITING_TOOL` existe no enum para execuções futuras com ferramentas assíncronas;
o host atual não a usa porque o `callAgent` é síncrono dentro do hook `act`.

## Estado

`AgentExecutionState` (`state.ts:44`) carrega tudo que uma execução sabe:
executionId, agentId, userId, clientId, conversationId, originalRequest,
interpretedGoal, constraints, successCriteria, plan, currentStep, toolCalls,
observations, artifacts, confidence, evaluatorScore, phase, iterations,
strategiesTried, timestamps. Criado por `createInitialState` (fase RECEIVED,
iterations 0, strategiesTried vazio).

Cada `Observation` (`state.ts:36`) registra o texto do que foi observado de fato
(resultado real da ação, não suposição), a estratégia que o gerou e a tentativa.
Cada `ToolCallRecord` (`state.ts:28`) registra tool, input resumido, ok,
duration_ms e erro.

## Hooks

`AgentLoopHooks` (`loop.ts:40`):

| Hook | Papel | Implementação no worker |
|---|---|---|
| `understand` | Devolve goal, successCriteria, constraints, taskClass | `goalFor` + `successCriteriaFor` por agente, `classifyTask` por heurística (agentic-profiles.ts) |
| `gatherContext` | Monta o contexto da execução | `recallMemories` de `agent.episode` (limit 3) + `user.preference` (limit 5) |
| `plan` | Plano mínimo interno, nunca exposto cru ao usuário | Lista fixa de 5 passos |
| `act` | Executa uma tentativa, devolve `ActResult` | `callAgent` com 2 estratégias (ver abaixo) |
| `evaluate` | Opcional, default `deterministicEvaluator` | `evaluatorFor(agent)` (agentic-profiles.ts) |
| `finalize` | Produz a resposta final | Última observação |
| `onPhaseChange` | Chamado após TODA transição | Publica WS `agent.phase` + upsert de checkpoint |

## Limites por classe de tarefa

`MAX_ITERATIONS` (`state.ts:84`): simple=2, standard=5, complex=10. A classe vem
do hook `understand`; no worker é a heurística determinística `classifyTask`
(`agentic-profiles.ts:25`): mensagem com mais de 500 chars ou sinais de
complexidade ("planejamento", "relatório completo", "monte um briefing"...) vira
`complex`; menos de 80 chars sem " e depois " vira `simple`; o resto `standard`.
Estourado o limite, o loop encerra em FAILED sem entregar resposta: nunca entrega
o que não passou no evaluator.

## Guarda anti-retry-idêntico

Regra central do loop (`loop.ts:111`): se `act` devolve uma estratégia que já
consta em `strategiesTried`, o runtime encerra em FAILED imediatamente, em vez de
fazer retry cego. Repetir estratégia que falhou é loop infinito disfarçado.

No worker, as duas estratégias implementadas (`agentic-dispatch.ts:122`) são:

1. `dispatch_completo` (tentativa 1): mensagem como chegou, com os blocos de
   contexto anexados pela API.
2. `dispatch_reduzido` (tentativa 2+): mensagem cortada em `"\n\n---\n"`, sem os
   blocos de contexto. É materialmente diferente porque esses blocos disparam o
   edge case de classificação de job no Jarbas/Suzy e poluem a busca vetorial do
   Bento. É a recuperação de menor custo antes de desistir.

## Evaluator determinístico

`deterministicEvaluator` (`evaluator.ts:39`). Régua objetiva, sem LLM:

| Quesito | Peso |
|---|---|
| Ação reportou sucesso técnico | 0.30 |
| Observação não vazia e não genérica ("null", "{}", "[]") | 0.25 |
| Sem vazamento de mecanismo interno (execution_id, tool_call, "prompt do sistema", comandos de agente) | 0.20 |
| Critérios de sucesso cobertos pela observação (por palavra com mais de 3 letras) | até 0.25 |

Pass: `score >= 0.6` E zero failures. Sem critérios declarados, o quesito de
cobertura recebe nota máxima.

Evaluators por agente (`evaluatorFor`, agentic-profiles.ts:82): rodam a régua
base sem critérios literais e somam a checagem semântica do que conta como
sucesso para cada agente. Motivo registrado no código: a régua por palavra
literal reprovou resposta correta do Jarbas no primeiro teste ao vivo (respondeu
"Investimento: R$ 1.234" e a régua procurava as palavras "dados"/"período").
Hoje: Jarbas exige número OU declaração de limitação ("não tenho/encontrei");
Bento exige resposta com pelo menos 20 chars. Falha aqui desconta 0.35 do score
e reprova a tentativa.

Não implementado: evaluator por LLM. A interface `Evaluator` já permite plugar
um depois sem mexer no loop.

## Recovery

- Falha com `recoverable: true` (default): vai para REPLANNING e tenta outra estratégia.
- Falha com `recoverable: false` (agente offline, permissão negada): FAILED sem gastar iterações.
- `needsUserInput: true`: encerra em NEEDS_USER_INPUT com a resposta do `finalize` (ex: pergunta de clarificação).
- Exceção não tratada em qualquer hook: fase vira FAILED (se não terminal) e o erro propaga.

## Checkpointing

`onPhaseChange` é chamado após toda transição com o estado atualizado e a fase
anterior. No worker (`agentic-dispatch.ts:56`) cada checkpoint faz duas coisas:

1. Publica `agent.phase` no pub/sub (alimenta a UI com fases reais).
2. Upsert em `agent_execution_states` (chave `execution_id`): phase, taskClass,
   iterations, evaluatorScore, state jsonb completo.

Falha ao persistir checkpoint vira log de warn e não derruba a execução. Uma
execução longa sobrevive a restart do worker no sentido de auditoria (o trace
completo está no banco); o resume automático a partir do último checkpoint é
não implementado (próximo passo).

## Onde vive no código

| Peça | Arquivo |
|---|---|
| Fases e estado | `packages/agent-runtime/src/state.ts` |
| Loop | `packages/agent-runtime/src/loop.ts` |
| Evaluator | `packages/agent-runtime/src/evaluator.ts` |
| Testes | `packages/agent-runtime/src/loop.test.ts` |
| Host (dispatch) | `apps/worker/src/processors/agentic-dispatch.ts` |
| Perfis por agente | `apps/worker/src/processors/agentic-profiles.ts` |
| Ponto de entrada/flag | `apps/worker/src/processors/execute-job.ts:42` e `:803` |
