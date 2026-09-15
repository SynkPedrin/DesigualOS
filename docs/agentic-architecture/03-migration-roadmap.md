# 03 — Roadmap de Evolução Priorizado

A fundação já existe (docs 00-02). O que segue são as frentes de MAIOR alavancagem,
ordenadas por impacto/risco. Cada fase tem phase-gate real (seção 132): só está
pronta quando o COMPORTAMENTO passa, não quando compila.

## Regra de preservação (seções 89, 119)
- Jarbas não muda de comportamento. Alteração em package compartilhado
  (agent-runtime, memory-engine, tool-gateway) exige regressão de Jarbas.
- Não quebrar chat/streaming/histórico/anexos/auth do frontend.
- Feature flags por agente (`AGENT_RUNTIME_V2_BENTO`, `_OTTO`) para rollout.

## Frente A — Evidence layer + grounding factual (maior alavancagem)
Fecha os dois eixos mais baixos do scorecard (Evidence 3, Bento factual).
1. Tabela `evidence` (executionId, type, source, sourceId, clientId, retrievedAt,
   validAt, confidence, content) + migration aditiva.
2. `gatherContext`/operational-context passam a EMITIR evidências (cada task ao vivo,
   cada memória usada) em vez de só texto.
3. Evaluator ganha eixo `factualGrounding`: pergunta factual sobre estado real
   sem evidência suficiente NÃO passa (seção 25).
Gate: "quantas tarefas vencem hoje?" produz trace com evidências ClickUp reais e
resposta ancorada; remover o dado → agente reconhece ausência (seção 116).

## Frente B — Tool-loop multi-passo com verificação (Bento executor)
1. `act` deixa de ser single-shot: ganha ciclo investigar→agir→observar sobre o
   tool-gateway (searchTasks/getTask/createTask/updateTask/attachFile).
2. Read-back obrigatório em toda escrita (seção 32): criar task → getTask → conferir
   title/assignee/dueDate/attachment antes de declarar sucesso.
3. idempotencyKey por operação (seção 33): timeout não duplica task.
Gate: teste da seção 59 (criar task p/ Pedro, hoje, com briefing anexado) passa com
verificação real, e um timeout forçado não cria task duplicada.

## Frente C — OperationalState do Bento (Operations Intelligence de verdade)
1. `OperationalState` consolidado (overdue, dueToday, blocked, incompleteBriefings,
   workload, pendingApprovals, risks) montado como view calculada (seção 48).
2. Priority-engine transparente (deadline/atraso/bloqueio/importância) — sem ML (seção 50).
3. Risk-engine com evidência por risco (seção 51) + next-best-action (seção 52).
Gate: "Bento, como está a operação?" descobre prioridades/riscos/bloqueios SEM
receber isso no prompt (seção 113), cada fato com evidência.

## Frente D — CreativeState do Otto
1. `CreativeState` com brand + histórico aprovado/rejeitado + performance por cliente.
2. Research externo multi-fonte quando o pedido depender de dado atual (seções 69-70).
3. Avaliador criativo (fit de marca, anti-genérico seção 74) + self-revision antes de
   entregar (seção 73), rodando DEPOIS das checagens determinísticas.
Gate: teste da seção 140 (campanha completa com avaliação e revisão) + memória
criativa por cliente que não vaza para outro (seções 117, 141).

## Frente E — Planner adaptativo + observability por-step
1. `plan` deixa de ser fixo: plano curto/adaptável (seção 14) que o replan revisa.
2. Trace por-step inspecionável com timings de retrieval/tool (seção 80).

## Frentes de suporte (conforme necessário)
- Event store normalizado `OperationalEvent` (seções 54-56) para Bento proativo.
- Tool Gateway pleno: schema Zod + timeout + retry-policy por tool (seção 27).
- Budgets aplicados (maxTokens/maxCost por run) e cache com TTL para dado mutável.

## Ordem recomendada
A → B → C (Bento vira Operations Intelligence completo), depois D (Otto), depois E.
Frente A é pré-requisito de qualidade para todas as outras (grounding).
