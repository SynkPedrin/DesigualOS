# Inventário de Automações — Desigual OS

**Data da auditoria:** 15/10/2026
**HEAD auditado:** `419dd4d` (branch `feat/otto-motion-engine`)
**Deploy:** API `419dd4d` na VPS (api.citavel.ai, build 15/10 17:04 UTC — CONFIRMED_IN_DEPLOY via `/health`, ver `agentes.md` §1); web na Vercel. O executor de automações (worker) roda código de 13/10 — ver §5.1.
**Fontes:** `artifacts/auditoria-2026-10-15/automacoes.md`, `artifacts/auditoria-2026-10-15/agentes.md`. Afirmações críticas re-verificadas neste documento contra o código em 16/10/2026.

**Classes:** A = operacional validada · B = implementada, sem evidência de execução validada · C = parcial/degradada · D = desconectada (existe no código, não roda) · E = duplicada · F = obsoleta · G = órfã (capacidade implementada sem executor/chamador — classe adicionada neste inventário para a §6).

**Etiquetas de evidência:** CONFIRMED_BY_CODE / CONFIRMED_BY_TEST / CONFIRMED_IN_RUNTIME / CONFIRMED_IN_DEPLOY / INFERRED / NOT_VERIFIED.

---

## 1. Escopo

Cobertura: (a) o produto "Automações" (API + fila BullMQ + executor no worker + tela `/workflows`); (b) os 14 jobs repetíveis da fila `daily-digest`; (c) timers da API; (d) o webhook do ClickUp como automação; (e) timers de boot do worker; (f) launchd/infra. Não cobre: capacidade de agentes em si (ver `agentes.md`), sinais sem produtor (ver `docs/audits/sinais-sem-produtor-20260930.md`, parcialmente desatualizada — §5.7).

---

## 2. Inventário completo

### 2.1 Produto "Automações" (agendadas pelo usuário)

Pipeline: API registra repeatable na fila `automations` (BullMQ) → worker executa injetando o prompt como mensagem numa conversa dedicada → resultado gravado em `automation_runs`.

| Componente | Local | O que faz | Evidência |
|---|---|---|---|
| API (CRUD multi-tenant) | `apps/api/src/automations/routes.ts` | `GET /automations` (:70) com `next_run_at` do repeatable real + race de 1,5s contra Redis fora (:92-96); `GET /automations/metrics` (:103); `POST` (:225) desfaz insert se cron inválido (:266-274); `PATCH` (:281) recria repeatable (:302-314); `POST /:id/run` (:339) funciona com `enabled=false`; `DELETE` (:362); `GET /:id/runs` (:383, últimos 50) | CONFIRMED_BY_CODE |
| Fila | `packages/orchestrator/src/automation-queue.ts` | Fila `automations`; repeatable com `jobId = automation.id`, idempotente (:25-31); remoção exige mesmo pattern (:38-40) | CONFIRMED_BY_CODE (re-verificado 16/10) |
| Executor | `apps/worker/src/processors/run-automation.ts` | Concurrency 5 (`apps/worker/src/index.ts:49-55`); re-autoriza membership na execução (:56-80); injeta prompt e reusa `dispatchChatMessage` (:136-143); grava `automation_runs` e `last_run_at` (:145-157); desde 13/10 não cola bloco de contexto exceto Studio (:200-203) | CONFIRMED_BY_CODE + CONFIRMED_BY_TEST (`run-automation.test.ts`, verde 15/10 — `automacoes.md` §5) |
| Tela | `apps/web/src/app/(shell)/workflows/page.tsx` | Listagem, métricas, insights do Bento ("ativa sem agendamento", :189-209), histórico, run-now com invalidação ~4s (:289-312). Rota web `/workflows`, módulo `automations` — só nomenclatura | CONFIRMED_BY_CODE |
| Reconciliador | `apps/worker/src/scheduler/reconciliar-automacoes.ts` | A cada 15 min + boot (`scheduler/index.ts:137`): re-registra automação ligada sem repeatable e remove órfão | CONFIRMED_BY_CODE + CONFIRMED_BY_TEST (7 testes verdes — `automacoes.md` §1.1); comportamento anômalo em §5.3 |

**Execução em produção (CONFIRMED_IN_RUNTIME, log local `~/Library/Logs/desigualos-worker.log`):** 2 automações reais — `1eaf80c8…` (Jarbas, 108 dispatches, última ~20/09) e `7d8134f7…` (Bento, horária, 40 dispatches, última 15/10 16:00:09).

**Classificação: A (operacional), com ressalvas em §5.2 (turno morre no guard) e §5.6 (sem teto de retenção).**

### 2.2 Jobs repetíveis da fila `daily-digest`

Armados em `apps/worker/src/scheduler/index.ts:81-143`; lista `JOBS_REPETIVEIS` em :30-45. **14 jobs no código-fonte atual** (CONFIRMED_BY_CODE, re-verificado 16/10); o worker em produção arma só 13 — ver §5.1. Teto de retenção da fila: `removeOnComplete: 100, removeOnFail: 500` (:70-73).

| # | Job | Objetivo | Trigger/cron | Evidência de execução | Testes | Classe |
|---|---|---|---|---|---|---|
| 1 | `morning-briefing` | Pendências de execução por colaborador → notificação (`daily-digest.ts:68`) + `briefingOperacional` (tarefas ClickUp, flags de proatividade; `bento-briefing.ts`) | `0 8 * * *` (:82) | Nenhuma em runtime — o worker em produção é anterior ao `briefingOperacional` (§5.1) | `bento-briefing.test.ts` existe; execução NOT_VERIFIED. Sem teste identificado para `daily-digest` | C |
| 2 | `end-of-day-checklist` | Checklist do dia → memória do Bento + notificação (`daily-digest.ts:18`) | `0 18 * * *` (:81) | NOT_VERIFIED | Sem teste identificado | B |
| 3 | `operational-events` | Consome event store → sinais proativos (`processors/operational-events.ts`) | `*/5 * * * *` (:83) | CONFIRMED_IN_RUNTIME: "lote de eventos operacionais processado" no log de 15/10 | `operational-events.test.ts` existe; execução NOT_VERIFIED | A |
| 4 | `integration-health` | Saúde do webhook ClickUp no próprio ClickUp, religa sozinho (`integration-health.ts:19-57`) | `*/15 * * * *` (:88) | NOT_VERIFIED | `integration-health.test.ts` existe; execução NOT_VERIFIED | B |
| 5 | `knowledge-consolidation` | Reconcilia conhecimento/campanhas (`knowledge-consolidation.ts:33`) | `0 3 * * *` (:92) | NOT_VERIFIED | Sem teste identificado | B |
| 6 | `inference-warmth` | Mantém modelo quente na GPU sob demanda (`inference-warmth.ts:97`) | `*/10 * * * *` (:97) | CONFIRMED_IN_RUNTIME: falhando em 100% dos ciclos observados (§5.4) | `inference-warmth.test.ts` existe; execução NOT_VERIFIED | C |
| 7 | `studio-queue-timeout` | Expira job Studio preso (`studio-queue-timeout.ts`) | `* * * * *` (:102) | NOT_VERIFIED | `studio-queue-timeout.test.ts` existe; execução NOT_VERIFIED | B |
| 8 | `execution-timeout` | Expira execução de agente presa (`execution-timeout.ts`) | `*/2 * * * *` (:107) | NOT_VERIFIED | `execution-timeout.test.ts` existe; execução NOT_VERIFIED | B |
| 9 | `aviso-conexao-mcp` | Avisa masters de nova conexão MCP (`aviso-de-conexao-mcp.ts`) | `*/2 * * * *` (:113) | NOT_VERIFIED | `aviso-de-conexao-mcp.test.ts` existe; execução NOT_VERIFIED | B |
| 10 | `google-calendar-sync` | Sync incremental Google Calendar (`google-calendar-sync.ts:13`) | `*/15 * * * *` (:118) | NOT_VERIFIED | `packages/tool-gateway/src/google-calendar-sync.test.ts`; execução NOT_VERIFIED | B |
| 11 | `microsoft-calendar-sync` | Idem Microsoft | `*/15 * * * *` (:121) | CONFIRMED_IN_RUNTIME: "Microsoft Calendar sincronizado" a cada 15 min no log de 15/10 | `packages/tool-gateway/src/microsoft-calendar-sync.test.ts`; execução NOT_VERIFIED | A |
| 12 | `meeting-prep` | Brief ~15 min antes de reunião de cliente, dedup por notificação (`meeting-prep.ts:24`) | `*/5 * * * *` (:126) | NOT_VERIFIED | Sem teste identificado | B |
| 13 | `reconciliar-automacoes` | Postgres↔Redis das automações | `*/15 * * * *` + boot (:137,167) | CONFIRMED_IN_RUNTIME: roda, mas com comportamento anômalo (§5.3) | CONFIRMED_BY_TEST (7 testes verdes, 15/10) | C |
| 14 | `bento-varredura` | Varredura proativa determinística do ClickUp, 3 estágios por flag (`bento-varredura.ts:20-28`) | `*/15 * * * *` (:143) | CONFIRMED_IN_RUNTIME como AUSENTE em produção: adicionada 14/10 (commit `cea59e0e`), worker não reiniciado (§5.1) | CONFIRMED_BY_TEST (`bento-varredura.test.ts`, verde 15/10) | **D (em produção agora)** |

Nota: os 25 testes de `run-automation`, `reconciliar-automacoes` e `bento-varredura` passaram em vitest local em 15/10 16:43 (`automacoes.md` §5). Para os demais schedulers, os arquivos de teste existem mas não foram executados nesta auditoria — "teste existe" ≠ "teste verde".

### 2.3 Timers da API (`setInterval` em `apps/api/src/server.ts:305-313`)

| Timer | Cadência | Função | Classe |
|---|---|---|---|
| `startHealthSweep` | — | Rebaixa node sem heartbeat em 60s | B |
| `startAgentProbe` (`health/probe-scheduler.ts:20`) | 10s | Sonda agentes (existem porque não mandam heartbeat) | B |
| `startWorkerWatchdog` (`health/worker-watchdog.ts:95`) | 20s | Alerta na TRANSIÇÃO para doente, re-alerta a cada 10 min, avisa recuperação. Mora na API de propósito | B |
| `startHealthCheckRetention` | — | Retenção de `health_checks` (+21 mil linhas/dia medido) | B |
| Sync de calendário na conexão Microsoft | no evento | Sync imediato ao conectar conta (`calendar/routes.ts:424-433`) | CONFIRMED_IN_RUNTIME (15/10) |

Evidência: CONFIRMED_BY_CODE para todos. Eficácia do watchdog depende de `sendOpsAlert` — §5.6.

### 2.4 Webhook do ClickUp como automação

`apps/api/src/clickup/routes.ts`, `handleTaskChanged` (:491). A cada mudança de task no ClickUp, dispara (CONFIRMED_BY_CODE):

- Pipeline de cartões: `sincronizarCartaoDaTarefa` (:549-558 → `pipeline/sincronizar-webhook.ts`), incluindo quadro geral da agência (:87-136) — com ressalvas em §4;
- Resolução de autor (:571-596);
- Event store idempotente (:602-633);
- Sync incremental de campanhas com janela de 5 min por cliente (:643-657);
- `publishWsEvent` (:659);
- Menções @agente respondidas pelo webhook (`brain/99 - Pendencias.md:25`).

**Classe: A/C** — o encadeamento existe e o sync de campanhas/cartões é o caminho vivo, mas depende do túnel estar de pé e de uma primeira sincronização manual para o quadro geral (§4). Não validado contra o ClickUp real nesta auditoria (proibido) — fluxos classificados por código + logs.

### 2.5 Timers de boot do worker (`apps/worker/src/index.ts`)

| Timer | Cadência | Função | Evidência |
|---|---|---|---|
| `flushPendingLearnings` | 5 min (:172-182) | Descarrega aprendizados pendentes | CONFIRMED_BY_CODE |
| `expireStaleMemories` | 1/hora (:188-196) | Expira memórias velhas | CONFIRMED_BY_CODE |
| `backfillThumbnails` | boot (:139) | Preenche thumbnails faltantes | CONFIRMED_BY_CODE |
| GPU gateway | boot (:204) | Inicializa gateway de GPU | CONFIRMED_BY_CODE |
| Heartbeat do worker | — (:164) | Reporta para `/health/infrastructure` | CONFIRMED_BY_CODE |

### 2.6 Infra / launchd / scripts

| Item | Estado | Evidência | Classe |
|---|---|---|---|
| `infra/launchd/com.desigualos.api.plist` | Instalado e rodando (pid 7123); KeepAlive incondicional, ExitTimeOut 90s | CONFIRMED_IN_RUNTIME (`launchctl list`, 15/10) | A |
| `infra/launchd/com.desigualos.worker.plist` | Instalado e rodando (pid 69910, de pé desde 13/10 16:48) — **rodando código velho**, §5.1 | CONFIRMED_IN_RUNTIME | A (com ressalva §5.1) |
| `infra/launchd/com.desigualos.fichas.plist` | **NÃO instalado**: ausente de `~/Library/LaunchAgents`, sem `/tmp/desigualos-fichas.log`, plist no repo com placeholder `/CAMINHO/DO/brain-desigual`. Agendaria fichas de cliente → memória do Bento às 06:30 via `scripts/sincronizar-fichas.sh` | CONFIRMED_IN_RUNTIME (ausência verificada 15/10) | **D** |
| `com.desigualos.mcp` | Instalado e rodando, mas **sem plist versionado no repo** — infra não versionada | CONFIRMED_IN_RUNTIME | B |
| `infra/supervisor.sh` | Plano B explícito (não rodar junto com launchd) | CONFIRMED_BY_CODE | B |
| `scripts/clickup-webhook-setup.sh`, `limpar-tasks-qa.sh`, `conferir-checkout-limpo.sh`, `restart-service.sh` | Manuais | CONFIRMED_BY_CODE | — (não são automações) |
| Deploy API | `docs/deploy/api.citavel.ai.conf` proxia para `127.0.0.1:3001` na VPS (Docker) | CONFIRMED_IN_DEPLOY | A |

**Local do worker de produção: dados insuficientes.** O repo documenta só a VPS; o que é fato (CONFIRMED_IN_RUNTIME) é que o worker local deste Mac (launchd) está processando dados operacionais reais (automações, calendário Microsoft, eventos ClickUp). Se existe também um worker em Docker na VPS: NOT_VERIFIED. Falta: documentação de onde o executor de produção roda — se for este Mac, um reboot derruba automações/calendário/briefings, com `integration-health` e watchdog na mesma máquina.

---

## 3. Classificação consolidada (A–G)

| Automação | Classe | Evidência-base |
|---|---|---|
| Produto Automações (API+fila+executor+tela) | A, com ressalvas §5.2/§5.6 | Código + log de 108+40 dispatches reais |
| `operational-events` | A | Log 15/10 |
| `microsoft-calendar-sync` | A | Log 15/10, ciclo de 15 min |
| `morning-briefing` | C | Worker em produção anterior ao `briefingOperacional` (§5.1) |
| `inference-warmth` | C | Falhando 100% dos ciclos observados (§5.4) |
| `reconciliar-automacoes` | C | Roda mas "chora lobo" (§5.3) |
| `end-of-day-checklist`, `integration-health`, `knowledge-consolidation`, `studio-queue-timeout`, `execution-timeout`, `aviso-conexao-mcp`, `google-calendar-sync`, `meeting-prep` | B | Armados no código; sem evidência de execução validada |
| `bento-varredura` | D (produção) | Armada no fonte 14/10; ausente do boot de 13/10 (§5.1) |
| Fichas do Bento (launchd 06:30) | D | Plist não instalado (§2.6) |
| Webhook ClickUp (cadeia `handleTaskChanged`) | A/C | Código + logs; depende de túnel e de primeira sync (§4) |
| Timers API e boot do worker | B | CONFIRMED_BY_CODE; eficácia de alerta depende de §5.6 |
| launchd api/worker/mcp | A/B | Instalados e rodando; mcp sem plist no repo |
| Ofertas proativas do Bento (dia útil, responsável) | G | §6.1 |
| desigual-node (dispatch de chat) | G | §6.2 |
| Suzy (execução auditável) | G | §6.3 |

Nenhuma automação classificada E (duplicada) ou F (obsoleta) neste ciclo. `desigual-node` seria candidato a F — mantido em G porque o código ainda é sondado/registrado, não aposentado.

---

## 4. Automações que não automatizam (Fase 6.1)

O que parece automático e exige ação manual:

1. **Fichas do Bento (brains/dossiês/vault) — classe D.** O agendamento de 06:30 existe só no papel: plist não instalado (§2.6). Hoje depende de alguém rodar `scripts/sincronizar-fichas.sh` na mão; CLAUDE.md:55-57 documenta só o uso manual. CONFIRMED_IN_RUNTIME (ausência).
2. **Backfill de quadros de pipeline.** Tasks anteriores ao quadro só entram pelo botão "Sincronizar" (`apps/web/src/hooks/use-pipelines.ts:60-72`); mitigado por auto-sync uma vez por quadro **por visita** à tela (`apps/web/src/app/(shell)/pipeline/page.tsx:977-984`) — ainda exige ABRIR a página. CONFIRMED_BY_CODE.
3. **Quadro geral da agência órfão até a primeira sync.** Só passa a acompanhar o webhook depois de convertido em categorias, o que só acontece na primeira sincronização manual/auto (`apps/api/src/pipeline/sincronizar-webhook.ts:114-115`). CONFIRMED_BY_CODE.
4. **`taskUpdated` nunca cria cartão.** Task antiga que mudou de status não aparece sozinha — decisão documentada em `apps/api/src/pipeline/sincronizar-webhook.ts:20-26`; depende de sync. CONFIRMED_BY_CODE.
5. **Bento proativo exige flags + restart.** `BENTO_PROACTIVE_MONITORING`, `BENTO_PROACTIVE_NOTIFICATIONS`, `BENTO_PROACTIVE_ORGS` E restart do worker — o processo atual é anterior ao código (§5.1). CONFIRMED_BY_CODE + CONFIRMED_IN_RUNTIME. Valores das flags na env: NOT_VERIFIED (.env não lido).
6. **Webhook do ClickUp depende de túnel manual.** Se a máquina reinicia e o túnel cai, precisa rodar `scripts/clickup-webhook-setup.sh` de novo (`brain/99 - Pendencias.md:25`); `integration-health` religa o webhook no ClickUp, mas não recria túnel. CONFIRMED_BY_CODE.

---

## 5. Problemas confirmados

### 5.1 Worker em produção roda código de 13/10 — Bento 3.1 proativo não está no ar

Processo worker pid 69910 de pé desde 13/10 16:48; o log de boot lista **13** jobs repetíveis, sem `bento-varredura`; o código atual arma **14** (`scheduler/index.ts:30-45,143` — re-verificado 16/10; varredura adicionada em 14/10, commit `cea59e0e`). Consequência: `bento-varredura`, `briefingOperacional` (8h) e o tuning `BENTO_QUEUE_CONCURRENCY` (14/10) existem só no fonte — mesmo com as flags ligadas, nada disso executa até reiniciar o worker. **CONFIRMED_IN_RUNTIME (ps + log de boot + git log).**

### 5.2 Automação horária do Bento morre no guard de escrita; `automation_runs` grava 'dispatched' como sucesso

Log de 15/10: 16:00:09 `Automation dispatched` (automationId `7d8134f7`, execução EXE-2026-MV9WLH3GBE730E) → 16:00:16 planner respondeu na conversa `c13cd01b` → 16:00:18 `[guard] kill switch: mensagem com potencial de escrita NÃO segue pro bento-qa externo; respondendo esclarecimento` (signals: verbo_edicao, verbo_despacho, verbo_agendamento, referente_sem_verbo) na MESMA conversa. O fix de 13/10 (`mensagemDaAutomacao`, `run-automation.ts:200-203`) não bastou — o prompt da automação continua parecendo ordem de escrita para o guard. E `automation_runs` registra `dispatched` (sucesso) mesmo quando a resposta é pedido de esclarecimento: o `success_rate` da tela conta isso como êxito (`routes.ts:184`). **INFERRED com evidência forte de log (proximidade temporal + mesmo conversationId); confirmar lendo as mensagens da conversa `c13cd01b`.**

### 5.3 Reconciliador "chora lobo" 132x

Log: `reagendadas: 1, ligadasNoBanco: 1` a cada 15 min (132 ocorrências no arquivo). O repeatable existe e dispara (16:00:09, jobId `repeat:d7097144…`), mas `getRepeatableJobs()` nunca o devolve ao reconciliador (`reconciliar-automacoes.ts:113-114`), que re-registra toda vez. É no-op idempotente (não duplica disparo), mas anula o valor diagnóstico do warn e esconderia uma dessincronia real. Causa não determinada — candidato: campo `id` nulo na listagem do BullMQ para repeatables com jobId customizado nesta versão. Efeito colateral potencial: se a listagem está cega para esses repeatables, o insight "ativa sem agendamento" da tela (`workflows/page.tsx:193`) pode estar cego junto. **Comportamento CONFIRMED_IN_RUNTIME; causa INFERRED.**

### 5.4 `inference-warmth` falha em 100% dos ciclos observados

276 ocorrências de `[inferencia] aquecimento falhou`, todas com `ttftMs ≈ 10.0-10.5s` — padrão de timeout de ~10s, mas o fetch do keeper tem timeout de 180s (`inference-warmth.ts:137`, re-verificado 16/10) e o `.catch(() => null)` (:140) engole a causa: o log não diz POR QUE falhou. Provável origem no `controleDeAdmissaoDaGpu` ou na GPU (100.107.198.50) fora — falha warn-only, sem métrica nem alerta. **Sintoma CONFIRMED_IN_RUNTIME; causa NOT_VERIFIED (GPU não inspecionada).**

### 5.5 Fila `automations` sem teto de retenção

`getAutomationsQueue` (`automation-queue.ts:14-17`, re-verificado 16/10) não define `removeOnComplete/removeOnFail`. O teto foi aplicado à fila `daily-digest` (`scheduler/index.ts:70-73`) mas não à `automations`. Com automação horária, o Redis acumula histórico sem fim — o mesmo defeito medido em 18/09 na outra fila (1.911 `completed` + 226 `failed` acumulados, comentário em `scheduler/index.ts:62-64`). **CONFIRMED_BY_CODE (omissão).**

### 5.6 `sendOpsAlert` é no-op sem `ALERT_SLACK_WEBHOOK_URL`

`packages/orchestrator/src/alerts.ts:22-23` (re-verificado 16/10): sem a env, a função retorna silenciosamente — worker morto, automação com falha final e fila acumulada não chegam a ninguém. Os ganchos estão chamados nos pontos certos (watchdog §2.3, filas); falta só o destino. **CONFIRMED_BY_CODE o no-op; NOT_VERIFIED se a env está configurada (.env não lido).**

### 5.7 Auditoria antiga parcialmente desatualizada

`docs/audits/sinais-sem-produtor-20260930.md` continua correta no ponto central (`task.overdue` e `creative.rejected` seguem sem produtor — verificado via grep em 15/10), mas desatualizada ao não registrar que `bento-varredura.ts` (14/10) cobre "tarefa em risco/atrasada" por leitura determinística do ClickUp, fora do event store — o buraco foi contornado, não fechado. **CONFIRMED_BY_CODE.**

---

## 6. Capacidades de agentes implementadas e não utilizadas (classe G)

**Nota de escopo — o que o Bento 3.1 (14/10) JÁ cobre, para não duplicar:** varredura proativa determinística do ClickUp a cada 15 min (3 estágios por flag, `bento-varredura.ts:20-28`), briefing operacional das 8h (`bento-briefing.ts`), contexto multifonte no prompt (agenda, inbox, aprovações, contas de mídia — `contexto-multifonte.ts`) e 1ª varredura real medida: 1.255 tasks → 188 sinais (`bento-3.1-progress.md:303-308`). Os itens abaixo são lacunas **fora** desse escopo — com a ressalva de que nada do Bento 3.1 está no ar até §5.1 ser resolvido, e os 188 sinais não chegam à equipe porque o OS tem só 2 usuários (super, qa-bot) sem contas com `clickup_email` (`bento-3.1-progress.md:310-312`; segue aberto, não é recomendação nova).

### 6.1 Ofertas proativas do Bento sem executor

O Bento diz "Quer que eu jogue pro dia útil seguinte?" (`bento-proatividade.ts:84`) e o helper que calcula a data (`proximoDiaUtil`, :131) **não tem nenhum chamador fora do próprio teste** — re-verificado 16/10: grep em `apps/worker/src` encontra só `bento-proatividade.test.ts`. Se o usuário responde "sim", o turno cai no classificador genérico — "sim" sozinho não autoriza escrita nem carrega o alvo. A oferta promete um atalho que não existe. O mesmo vale para "Ficou sem responsável. Me diz de quem é" (:93): o update de assignee existe (`bento-update-executor`), falta o fechamento de circuito. Todos os blocos existem (executor de update com read-back + helper + texto da oferta); falta só detectar a afirmativa e executar. **CONFIRMED_BY_CODE.**

### 6.2 desigual-node morto no caminho de dispatch

O README do node diz ser o alvo de dispatch de Bento/Jarbas/Suzy — desatualizado. O dispatch atual nunca procura node para esses três (`execute-job.ts:842-856`, re-verificado 16/10: bento→`callBento`, jarbas/suzy→`callAgentesDesigual`, só o resto→`findHealthyNodeForAgent`); o portão de saúde confirma (`chat-service.ts:228-232`). O que roda nos Mac Minis são os serviços bento-qa/susy-service, não este node. O `agent-probe` ainda sonda esses hosts (`agent-probe.ts:67`), gerando falso "online". IMPLEMENTED, NOT WIRED no caminho de chat. **CONFIRMED_BY_CODE.**

### 6.3 Suzy sem execução auditável

Suzy é o único agente sem nenhum caminho de execução no repo: resposta vem do susy-service externo (100.86.237.73:3102, `execute-job.ts:489`), caixa-preta. A barreira de aprovação existe e funciona (`[AGUARDA_APROVACAO]` → `requestToolCall` → masters aprovam em `POST /tool-calls/:id/approve`, `execute-job.ts:763-790`, `apps/api/src/tool-calls/routes.ts:234`), mas `approveToolCall` só marca aprovado e devolve o input (`tool-calls/routes.ts:240-243`) — a execução pós-aprovação acontece dentro do serviço externo, invisível ao OS: o sistema registra o pedido, nunca o resultado real da escrita no Instagram/WhatsApp. Falta um executor no repo atrás do Gateway. **CONFIRMED_BY_CODE.**

---

## 7. Limitações e dados insuficientes

- **Env não lida (proibido):** `BENTO_PROACTIVE_*`, `ALERT_SLACK_WEBHOOK_URL`, `CLICKUP_WRITE_SCOPE_LIST_ID`, flags da VPS = NOT_VERIFIED. O `/health` confirma o SHA, não as flags.
- **Banco/Redis/VPS não consultados:** contagens de `automation_runs`, estado real dos repeatables e a existência de um worker em Docker na VPS = NOT_VERIFIED. A evidência de "produção" veio dos logs locais do launchd (`~/Library/Logs/desigualos-worker.log`).
- **ClickUp real não exercitado (proibido):** fluxos de webhook classificados por código + logs, não por disparo real.
- **Conversa `c13cd01b` não lida:** o encadeamento dispatch → guard (§5.2) é inferência por proximidade temporal e mesmo conversationId.
- **Testes:** executados localmente (vitest, 15/10 16:43) apenas `run-automation`, `reconciliar-automacoes`, `bento-varredura` — 25/25 verdes. Demais arquivos de teste de schedulers existem (listados em §2.2) mas não foram executados nesta auditoria.
- **Dados insuficientes — local do worker de produção:** falta documentação/inventário de onde o executor real roda (VPS Docker vs. launchd deste Mac). Sem isso, o impacto de §5.1 e o risco de reboot do Mac não são quantificáveis.
