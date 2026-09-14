# Learning Engine

Status: parcialmente implementado. Aprendizado local durável existe e roda;
a parte de "ficar melhor com o tempo" é medida (KPIs) mas ainda não realimenta
os agentes de forma automática além do experience replay de episódios.

Código: `packages/orchestrator/src/learning.ts` (recordLearning,
flushPendingLearnings), `packages/otto/src/learning/pipeline.ts` (funil Otto),
outcomes em `agentic-dispatch.ts`, KPIs em `apps/api/src/agents/routes.ts`.

## Princípio

Todo aprendizado é gravado local SEMPRE (tabela `memories`, via `rememberFact`)
e empurrado para o brain remoto do agente só quando dá. Motivo medido: o brain
de cada agente vive numa máquina da Tailscale que pode estar fora do ar; se o
aprendizado dependesse só do remoto, tudo que acontecesse durante a queda seria
perdido em silêncio. Local é a fonte durável; o push remoto é entrega, e o que
falhar fica `pending` para reenvio.

## Fontes de aprendizado

### 1. Outcomes de execução (novo na V2)

Toda execução do agent loop grava uma linha em `agent_outcomes`
(`agentic-dispatch.ts:185`): goal_completion, first_attempt_success, iterations,
tool_failures, evaluator_score, latency_ms, task_class, user_feedback (campo
existe na tabela; preenchimento por feedback explícito é próximo passo).
Nunca inventado: a linha só existe porque o loop rodou. É a fonte dos KPIs.

### 2. Episódios (experience replay, novo na V2)

Execução COMPLETED grava uma memória kind `agent.episode` com objetivo,
estratégia vencedora, tentativas e score, confidence 0.9, importance 0.7 se
precisou de replan (aprender com o que foi difícil) ou 0.4 se foi de primeira,
subject `episode:<agente>:<goal>`. Recuperado no gatherContext de execuções
futuras do mesmo agente/cliente (limit 3). É o único mecanismo em que o
aprendizado realimenta a execução automaticamente hoje.

### 3. Eventos de trabalho (recordLearning)

Kinds: `studio.asset_created`, `clickup.clients_synced`,
`clickup.mention_answered`, `client.access_granted`, `execution.completed`,
`otto.creative_plan_created`, `otto.studio_handoff`, `otto.feedback`.

`recordLearning` (learning.ts:156) escreve via `rememberFact` desde a V2: os
chamadores existentes ganharam dedup, supersessão e filtro de relevância sem
mudança de assinatura. Antes gravava com INSERT cru (sem dedup: o mesmo fato
registrado 40 vezes virava 40 linhas soltas; sem supersessão: fato atualizado
nunca aposentava o anterior).

### 4. Funil de confiança do Otto (packages/otto/src/learning/pipeline.ts)

Puro e testável (sem DB; persiste em `memories` com kinds `otto.*` e estágio em
metadata). Estágios: observation → experimental → validated → trusted → core.

Pesos por origem da evidência: director 3, human_feedback 2, metric 1.5,
auto_eval 0.5. Confiança = média beta com prior 1:1 em 0.5; evidência negativa
(contraexemplo) derruba a confiança.

Regras de promoção:

| Estágio | Mín. evidências | Mín. confiança | Origem obrigatória |
|---|---|---|---|
| experimental | 1 | 0.3 | qualquer |
| validated | 3 | 0.6 | human_feedback |
| trusted | 8 | 0.8 | human_feedback |
| core | 20 | 0.9 | director |

O Otto não pode se auto-validar via QC próprio (isso seria viés de confirmação
institucionalizado): validated pra cima exige evidência humana, core exige o
diretor.

### 5. Feedback explícito (Studio)

Feedback humano sobre asset produzido vira aprendizado kind `otto.feedback` e
alimenta o funil do Otto (origem human_feedback). É o único canal de feedback
explícito implementado. Feedback sobre respostas de chat (campo
`agent_outcomes.user_feedback`) ainda não tem coleta: não implementado.

## Entrega no brain remoto

`pushToBentoBrain` (learning.ts:90): a memory-api do Bento é SOMENTE LEITURA
(verificado no código dela), então a entrega é: escrever `.md` no vault via
`BENTO_VAULT_WRITER_URL` (pasta dedicada `aprendizados/desigual-os/`, nunca no
meio das notas da equipe) e pedir `POST /memory/reindex` daquele path. Sem
credenciais configuradas, o aprendizado fica local com `delivery: skipped`;
falha de entrega vira `delivery: pending`.

`flushPendingLearnings` reenvia o que ficou pendente (idempotente: só marca
`pushed` o que o remoto aceitou). Agendado a cada 5 minutos no worker
(`apps/worker/src/index.ts`, `FLUSH_PENDING_LEARNINGS_MS = 5 * 60_000`), com
catch próprio para não derrubar o processo. Antes da V2 existia sem nenhum
chamador: aprendizado pendente nunca era reenviado.

## KPIs (medindo melhora)

`GET /agents/kpis` (`apps/api/src/agents/routes.ts:67`), autenticado. Calcula de
`agent_outcomes` (janela de 1000 execuções mais recentes), por agente:

- `task_success_rate`: goal_completion / total
- `first_attempt_success_rate`: completou na iteração 1 / total
- `avg_iterations`
- `tool_failures` (soma)
- `avg_evaluator_score`
- `avg_latency_ms`

Resposta inclui a janela (`limit`, `executions`, `since`). É o endpoint que
responde "os agentes estão melhorando?": first-attempt success subindo e
iterações médias caindo ao longo do tempo. Não implementado: persistência de
séries temporais dos KPIs (hoje é calculado on demand da janela).

## O que falta

- Feedback explícito de chat (user_feedback em agent_outcomes): campo existe, coleta não implementada.
- Realimentação automática além do replay de episódios (ex: ajustar critérios, prompts ou rotas a partir dos outcomes): não implementada.
- Consolidação de aprendizados em regras promovidas (fora do funil Otto): não implementada.
- Dashboard de KPIs na UI: endpoint existe, tela não implementada.
