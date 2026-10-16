# Auditoria Operacional e de Automação — Desigual OS

**Relatório principal** · Data: 15/10/2026 · HEAD auditado: `419dd4d` (branch `feat/otto-motion-engine`)
**Deploy:** API em `419dd4d` na VPS (confirmado via `/health`, release_sha igual ao HEAD local, build 15/10 17:04 UTC — CONFIRMED_IN_RUNTIME); web na Vercel (CONFIRMED_IN_DEPLOY).
**Método:** auditoria somente-leitura por 11 agentes; achados brutos e evidências completas em `artifacts/auditoria-2026-10-15/*.md`. Este documento consolida; não substitui as evidências primárias.
**Etiquetas:** CONFIRMED_BY_CODE (lido no código) · CONFIRMED_BY_TEST (coberto por teste que passou) · CONFIRMED_IN_RUNTIME (observado em log/processo) · CONFIRMED_IN_DEPLOY (no caminho de deploy versionado) · INFERRED (inferência declarada) · NOT_VERIFIED (sem prova nesta sessão).

**Documentos irmãos desta série (não repetidos aqui):**
- `docs/audits/clickup-integration-map.md` — mapa completo da integração ClickUp
- `docs/audits/automation-inventory.md` — inventário exaustivo de automações
- `docs/audits/automation-opportunities.md` — catálogo de oportunidades
- `docs/audits/automation-implementation-roadmap.md` — roadmap detalhado de execução

---

## 1. Resumo executivo

O Desigual OS é um sistema real, deployado e em uso: API Fastify + worker BullMQ em Docker numa VPS, web Next.js 16 na Vercel, MCP no Railway, Postgres gerenciado no Supabase, nodes físicos na tailnet (CONFIRMED_IN_DEPLOY — `docker-compose.prod.yml:23-118`). A suíte de testes é grande e verde: **4.661 testes passando em 348 arquivos, zero falhas** (CONFIRMED_BY_TEST — `artifacts/auditoria-2026-10-15/testes-fase-11.md` §2), com lacunas de cobertura concentradas nas jornadas de inbox, tool-calls e nas rotas HTTP do pipeline (§17).

A espinha dorsal operacional — ClickUp como fonte de verdade de tarefas, webhook inbound com HMAC, pipeline Kanban que escreve de volta, agentes com cadeia de autorização de escrita em camadas — existe e está ligada. Os problemas não são de ausência de arquitetura; são de **elos fechados pela metade e de drift entre código e runtime**:

1. **Runtime atrás do código (CONFIRMED_IN_RUNTIME):** o worker em produção roda processo de 13/10; o 14º job (`bento-varredura`) e o briefing das 8h, entregues em 14/10, não executam até restart (`artifacts/.../automacoes.md` §3.4).
2. **Dedup do event store apaga o histórico de updates (CONFIRMED_BY_CODE, re-verificado nesta redação):** `externalId` usa o id da inscrição do webhook (constante), então só o primeiro `taskUpdated` de cada tarefa é gravado (`apps/api/src/clickup/routes.ts:606`).
3. **Cerca de escrita com topologia de env desconhecida (NOT_VERIFIED):** dependendo de em qual processo `CLICKUP_WRITE_SCOPE_LIST_ID` está setada, ou as rotas humanas `/clickup/*` estão todas bloqueadas, ou escrevem sem cerca nenhuma (`artifacts/.../permissoes-seguranca.md` P1).
4. **Conta de QA `qa-motion` escreve na carteira real (CONFIRMED_BY_CODE):** duas funções divergentes de identidade de QA (`ehQaBot` string única × `ehContaDeQa` lista) fazem a segunda conta de QA receber a válvula de produção.
5. **Jornada central do negócio (inbox → quinzena → ClickUp → conclusão) tem 4 elos quebrados** (CONFIRMED_BY_CODE): contato sem cliente não vira demanda, prazo não chega ao ClickUp, status não volta do ClickUp, e `done/cancelled` não tem chamador na UI (`artifacts/.../jornadas-api.md` G2–G5).

A maioria dos ganhos disponíveis é de baixo esforço: das 10 maiores alavancas (§11), 5 são mudanças de 1–10 linhas e 1 é operacional (restart). O que falta em instrumentação — não há medição de tempo-por-etapa nem contagem de ações manuais — está declarado em §18 e na resposta à Q1.

---

## 2. Arquitetura atual

Fonte primária: `artifacts/auditoria-2026-10-15/arquitetura.md` (mapa completo, filas e schedulers).

### 2.1 Topologia de produção

| Componente | Onde roda | Evidência | Estado |
|---|---|---|---|
| Redis 7 (com senha, sem porta publicada) | VPS, Docker compose prod | `docker-compose.prod.yml:43-47` | CONFIRMED_IN_DEPLOY |
| API (Fastify 5, ~50 módulos de rota) | VPS, Docker, bind `127.0.0.1:3001`, Nginx+TLS na borda | `apps/api/src/server.ts:250-303`; `docker-compose.prod.yml` | CONFIRMED_IN_DEPLOY + CONFIRMED_IN_RUNTIME (`/health` no SHA `419dd4d`) |
| Worker (BullMQ consumers + schedulers + GPU gateway) | VPS, Docker (node:22-slim por causa do Chrome do Remotion) — **mas há um worker local no Mac via launchd processando dados operacionais reais** | `apps/worker/src/index.ts`; `artifacts/.../automacoes.md` §1.6 | CONFIRMED_IN_RUNTIME (local); topologia real do worker de prod NOT_VERIFIED |
| Postgres | Supabase gerenciado | ADR 0001 `docs/architecture/decisions/0001-supabase-completo.md` | CONFIRMED_IN_DEPLOY |
| Web (Next.js 16, React 19) | Vercel | `apps/web/package.json` | CONFIRMED_IN_DEPLOY |
| MCP (Express + MCP SDK, sem LLM) | Railway (Railpack) | `Dockerfile.mcp:1-20`, `apps/mcp/src/server.ts:44-50` | CONFIRMED_IN_DEPLOY (ao vivo NOT_VERIFIED) |
| Nodes físicos (studio-node GPU, otto-node, Mac Minis com bento-qa/susy-service) | Tailnet, fora da VPS | `docker-compose.prod.yml:7-9`, `docs/runbook.md:80-90` | CONFIRMED_IN_DEPLOY |

### 2.2 Filas e agendamentos

- 7 filas BullMQ com produtor e consumidor confirmados em código: 5 filas de agentes (`queue-{bento,jarbas,suzy,studio,otto}`), `daily-digest` (agenda interna), `automations`, `thumbnails`, relatórios PDF, `otto-motion` (atrás de flag) e `studio-jobs` — esta última consumida pelo studio-node físico, não pelo worker (`arquitetura.md` §1.4 — CONFIRMED_BY_CODE).
- **14 jobs repetíveis** na fila `daily-digest` (`apps/worker/src/scheduler/index.ts:81-143` — CONFIRMED_BY_CODE, re-verificado nesta redação): checklists 18h/8h, eventos operacionais (5min), integration-health (15min, religa webhook suspenso), consolidação de conhecimento (3h), warmth de GPU (10min), timeouts de studio/execução, aviso MCP, sync Google/Microsoft Calendar (15min), meeting-prep (5min), reconciliador de automações (15min + boot), varredura proativa do Bento (15min, atrás de flag).
- Timers na API: health sweep, probe de agentes (10s), watchdog do worker (20s), retenção de `health_checks` (`apps/api/src/server.ts:305-313` — CONFIRMED_BY_CODE).
- Fora dos containers: launchd de fichas de cliente (06:30) **não instalado** (ver §6); launchd de api/worker instalados no Mac local como plano B (`arquitetura.md` §1.5, §1.8).

### 2.3 Testes

4.661 testes verdes em 348 arquivos vitest, zero falhas (CONFIRMED_BY_TEST — detalhe e ressalvas em §17). `node-protocol` (contrato de segurança Orchestrator↔Node) e `token-engine` (matemática de custo) têm **zero testes** (CONFIRMED_BY_CODE — `arquitetura.md` §1.7).

---

## 3. Como a operação funciona

Fluxo real de hoje, ponta a ponta (consolidação de `jornadas-api.md`, `jornadas-web.md`, `agentes.md`):

1. **Demanda entra** por WhatsApp (webhook Evolution → inbox; NOT_VERIFIED contra instância real) ou é criada manualmente como "Quinzena" (`demands`). O dono da quinzena é derivado automaticamente da atribuição `account` do cliente — sem redigitação (CONFIRMED_BY_CODE/TEST — `demands/service.ts:22-29`).
2. **Briefing** é redigido a partir da quinzena (rascunho automático é concatenação de mensagens, declarado como andaime — `briefs/service.ts:121-151`) e enviado à produção, o que cria uma **segunda** task no ClickUp (CONFIRMED_BY_CODE — G5).
3. **Execução acontece no ClickUp.** O OS espelha: webhook inbound (HMAC timing-safe, resposta 200 antes de processar) atualiza cartões de pipeline, event store, caches e publica WS (CONFIRMED_BY_CODE — `clickup/routes.ts:491-663`). O drag de cartão no pipeline escreve status no ClickUp **antes** do banco local, com válvula de produção (CONFIRMED_BY_CODE/TEST — `pipeline/routes.ts:1227,1275` + `write-scope.test.ts` 29/29).
4. **Agentes:** Bento responde no worker com contexto ao vivo do ClickUp + multifonte, e escreve (create/update/comment/delete) através de cadeia RBAC → válvula → cerca de lista → kill switch (`agentes.md` §1.2 — CONFIRMED_BY_CODE/TEST, 244 testes verdes na área). Jarbas lê números reais de Meta/Google Ads no worker (default-on desde 14/10). Suzy é caixa-preta externa (§6). Otto vai ao otto-node via Tailscale; Motion Engine atrás de flag default-off.
5. **Acompanhamento:** telas `/today` (agregado de 9 seções em paralelo), `/pipeline`, `/tasks`, ficha de cliente, `/signals`, `/activity`, control center da agência. Automações agendadas pelo usuário (produto "Automações") rodam na fila dedicada com reconciliador e métricas.

O desenho é coerente; os defeitos estão nos elos de retorno (ClickUp→demanda, aprovação→efeito) e em superfícies duplicadas (§7).

---

## 4. Mapa do ClickUp

Resumo executivo; o mapa completo está em **`docs/audits/clickup-integration-map.md`**.

- **30 operações ClickUp** exportadas pelo tool-gateway, 24 com caller em produção, 3 mortas (`removeTaskFromList`, `createFolder`, `createList`), 1 pronta mas bloqueada upstream (`registrarTempo` — ClickApp Time Tracking desligado no workspace) (CONFIRMED_BY_CODE — `artifacts/.../clickup-gateway.md` §2).
- Toda escrita passa por cerca + kill switch (`write-scope.ts`), fail-closed por task; 106/106 testes do pacote verdes (CONFIRMED_BY_TEST).
- Inbound: webhook com HMAC; **a inscrição real na VPS (quais eventos cobre) é NOT_VERIFIED** — só existe script de dev que registra `taskCommentPosted` (`clickup-sync.md` §1). Se a inscrição não cobre eventos de task, todo o caminho `handleTaskChanged` está morto em produção.
- Caches SWR de 60s/10min na consulta agregada e por lista, invalidados pelo webhook (CONFIRMED_BY_CODE).
- Defeito estrutural: dedup do event store (§1, item 2) apaga o histórico de `taskUpdated` (CONFIRMED_BY_CODE, re-verificado: `apps/api/src/clickup/routes.ts:606`).

---

## 5. Automações existentes

Resumo; o inventário exaustivo (classificações A–F por automação) está em **`docs/audits/automation-inventory.md`**. Fonte primária: `artifacts/.../automacoes.md`.

- **Produto "Automações" (agendadas pelo usuário):** CRUD multi-tenant completo, fila dedicada com repeatable idempotente, re-autorização no momento da execução, reconciliador Postgres↔Redis a cada 15min + boot, tela `/workflows` com métricas e histórico. Evidência de uso real: 2 automações disparando (Jarbas com 108 dispatches; Bento horário com 40) — CONFIRMED_IN_RUNTIME (log local).
- **14 jobs repetíveis do worker** (tabela em §2.2) — dos quais `operational-events` e `microsoft-calendar-sync` têm evidência de execução no dia da auditoria (CONFIRMED_IN_RUNTIME); os demais são B (implementados, sem validação de produção).
- **Ações do webhook ClickUp:** pipeline, resolução de autor, event store idempotente, sync incremental de campanhas, WS, menções @agente (CONFIRMED_BY_CODE — `automacoes.md` §1.4).
- **Timers de boot do worker e schedulers da API** (§2.2).
- **Sync de calendário** Google/Microsoft a cada 15min + sync imediato ao conectar conta.

---

## 6. Automações desconectadas

Implementadas (ou documentadas) mas sem efeito real hoje:

| # | Automação | Por que está desconectada | Evidência |
|---|---|---|---|
| 1 | Fichas diárias do Bento (vault → memória, 06:30) | plist **não instalado**, placeholder `/CAMINHO/DO/brain-desigual` no arquivo; hoje é execução manual | `infra/launchd/com.desigualos.fichas.plist`; `automacoes.md` §1.6 — CONFIRMED_BY_CODE + CONFIRMED_IN_RUNTIME (ausência em `~/Library/LaunchAgents`) |
| 2 | Bento proativo (varredura 15min + briefing 8h) | worker em produção roda código de 13/10; os jobs foram adicionados em 14/10 e exigem restart + flags | `automacoes.md` §3.4 — CONFIRMED_IN_RUNTIME (ps + log de boot com 13 jobs vs 14 no fonte) |
| 3 | GPU gateway (porta 11500) | escuta `0.0.0.0` no container, mas o compose não publica porta; inalcançável pela tailnet salvo override não versionado | `gpu-gateway.ts:188-190` × `docker-compose.prod.yml:88-115` — CONFIRMED_BY_CODE; reachability NOT_VERIFIED |
| 4 | Fila `studio-jobs` | consumida pelo studio-node físico, mas o Redis de prod não publica porta; sem túnel documentado, não há consumidor | `arquitetura.md` §3.2 — CONFIRMED_BY_CODE; uso real NOT_VERIFIED |
| 5 | Alertas operacionais (Slack) | `sendOpsAlert` é no-op silencioso sem `ALERT_SLACK_WEBHOOK_URL`; `.env.example` tem a chave vazia | `alerts.ts:24-25` — CONFIRMED_BY_CODE; estado da env NOT_VERIFIED |
| 6 | Automação horária do Bento | despacha, mas o turno morre na trava de escrita (guard lê o prompt como ordem de escrita) e `automation_runs` registra `dispatched` como sucesso | `automacoes.md` §3.1 — INFERRED com evidência forte de log (mesma conversa, 9s de distância) |
| 7 | `inference-warmth` | falha em 100% dos 276 ciclos observados; causa engolida por `.catch(() => null)` | `automacoes.md` §3.3 — CONFIRMED_IN_RUNTIME o sintoma; causa não determinada |
| 8 | Reconciliador de automações | "chora lobo": re-registra 1 automação a cada ciclo há 132 ocorrências; no-op idempotente que anula o valor diagnóstico | `automacoes.md` §3.2 — CONFIRMED_IN_RUNTIME; causa INFERRED |
| 9 | Suzy (execução de escrita) | aprovação passa pelo Gateway, mas a ação aprovada roda dentro do susy-service externo; o OS registra o pedido, nunca o resultado | `agentes.md` §1.4, §3.4 — CONFIRMED_BY_CODE |
| 10 | `registrarTempo` (time tracking ClickUp) | código e mensagem de erro prontos; ClickApp desligado no workspace (TIMEENTRY_072) | `clickup-client.ts:991-1024` — CONFIRMED_BY_CODE |
| 11 | desigual-node | README o descreve como destino de Bento/Jarbas/Suzy; o dispatch atual nunca o procura | `execute-job.ts:842-862` — CONFIRMED_BY_CODE (código morto no caminho de chat) |
| 12 | Ofertas proativas do Bento ("jogar pro dia útil seguinte", "me diz de quem é") | texto da oferta existe; o executor do "sim" não — `proximoDiaUtil` só é chamado pelo próprio teste | `bento-proatividade.ts:84,131-135` — CONFIRMED_BY_CODE |

Adicional: `integration-health` religa webhook suspenso mas lê só `webhooks[0]` — com mais de um webhook no team pode mirar o errado (`integration-health.ts:49` — CONFIRMED_BY_CODE); e não recria o túnel cloudflared se a máquina reinicia (dependência manual, `brain/99 - Pendencias.md:25`).

---

## 7. Automações duplicadas

| # | Duplicação | Evidência | Custo |
|---|---|---|---|
| 1 | **Webhook + polling/sync-on-open:** o webhook já mantém cartões e invalida caches, mas a tela de pipeline dispara sync completo ao ClickUp a cada visita (uma vez por quadro), e comentários têm polling de 60s como único refresh | `pipeline/page.tsx:977-984`; `use-client-clickup-comments.ts:24` — CONFIRMED_BY_CODE | Segundos a dezenas de segundos por abertura de quadro (`performance-fase13.md` P2) |
| 2 | **6 superfícies da mesma tarefa ClickUp:** `/tasks` (lista+kanban), `/today`, `/pipeline`, ficha em `/clients`, `/clients/[id]`, painel do inbox. Só o pipeline escreve; `/tasks` tem kanban read-only que compete com o pipeline como "quadro" sem aviso | `jornadas-web.md` §3 (P4) — CONFIRMED_BY_CODE | Confusão de capacidade; manutenção de 6 cortes de leitura |
| 3 | **Duas fichas de cliente divergentes:** `/clients` (mestre-detalhe, com aba Memória) × `/clients/[id]` (página própria, sem Memória nem Brand Kit); pipeline linka para uma, o resto para a outra | `contexto-inteligencia.md` P3 — CONFIRMED_BY_CODE | Conjuntos de abas diferentes para a mesma entidade |
| 4 | **`/knowledge` × `/memory` com o mesmo rótulo "Conhecimento":** uma é 100% fixture, a outra é real | `jornadas-web.md` P5 — CONFIRMED_BY_CODE | Rótulo duplicado; tela mock em produção |
| 5 | **Sync-por-visita × webhook (backfill):** tasks antigas e o quadro geral só entram/ativam acompanhamento via sync disparado pela visita à tela | `automacoes.md` §6.1.2-3; `sincronizar-webhook.ts:20-26,114-115` — CONFIRMED_BY_CODE | Quadro desatualizado até alguém abrir a página |
| 6 | **Dois sistemas de aprovação de brief:** "Aprovar esta versão" (direto) × "Pedir aprovação" (fila `approval_requests`) — resolver o pedido não tem efeito no brief; o funil do control center depende do sistema decorativo | `jornadas-api.md` G1/G8 — CONFIRMED_BY_CODE | Métricas de funil zeradas por design; aprovação sem efeito |
| 7 | **Dupla task no ClickUp por demanda:** task espelho na criação + task "[Brief]" no send-to-production, sem FK entre si | `jornadas-api.md` G5 — CONFIRMED_BY_CODE | Espelho sem atualização de status |
| 8 | **Dois parsers de conta de QA** (`ehQaBot` string única × `ehContaDeQa` lista) | `permissoes-seguranca.md` P2 — CONFIRMED_BY_CODE | Risco de segurança, não só duplicação (§12) |

---

## 8. Gargalos operacionais

Ordenados por impacto na operação diária:

1. **Cadeia inbox → quinzena → ClickUp → conclusão com 4 elos quebrados** (CONFIRMED_BY_CODE — `jornadas-api.md` G2–G5): thread nova nasce sem cliente e não há rota de vínculo (mensagem do inbox **não pode virar quinzena** no caso comum); prazo não vai ao ClickUp; status não volta; `done/cancelled` não tem chamador na UI — o KPI "Quinzenas abertas" cresce para sempre.
2. **Runtime desatualizado:** restart do worker é ação manual e não há sinalização de "código novo esperando restart" (CONFIRMED_IN_RUNTIME — `automacoes.md` §3.4).
3. **Tela Hoje paga varredura ao vivo do ClickUp por visita** (`/clickup/tasks/me` fora do cache, dentro do `/today/summary`) — CONFIRMED_BY_CODE (`performance-fase13.md` P1).
4. **Pool de 3 conexões Postgres × polling agregado do web** (13+ intervalos ativos, custos com 4 queries a cada 20s) — CONFIRMED_BY_CODE os intervalos; impacto INFERRED (`performance-fase13.md` P7).
5. **Proatividade sem plateia:** varredura gerou 188 sinais na 1ª execução real, mas o OS tem 2 usuários (super, qa-bot) e sinais não chegam à equipe sem contas com `clickup_email` (CONFIRMED_IN_RUNTIME — `agentes.md` §3.6).
6. **Sinais quase sem dados:** tabela tinha 1 linha de teste em 30/09; `task.overdue` e `creative.rejected` seguem sem produtor de evento (CONFIRMED_BY_CODE — `automacoes.md` §3.8, re-verificado por grep).
7. **Escritas humanas no ClickUp potencialmente bloqueadas ou desprotegidas** pela topologia desconhecida da cerca (§12, R1).
8. **429 do ClickUp sem retry em 2 dos 3 arquivos de rede** — rajada de escrita do multi-create falha sem segunda chance (CONFIRMED_BY_CODE — `clickup-gateway.md` §3.1).

---

## 9. Problemas de UX

Fonte primária: `artifacts/.../jornadas-web.md` §3 e `contexto-inteligencia.md` §2. Todos CONFIRMED_BY_CODE (análise estática; frontend não executado — fricção estimada, §18).

| # | Problema | Evidência |
|---|---|---|
| U1 | **Inbox perde mensagem em silêncio:** rascunho apagado antes do envio e falha engolida sem toast | `thread-chat.tsx:63-64` |
| U2 | **Botão "Nova conversa" morto** (sem `onClick`, parece ação principal) | `inbox/page.tsx:89-91` |
| U3 | **Aprovações de negócio bloqueadas para colaborador** — a nav registra a decisão de abrir, a tela devolve "Acesso restrito" antes da seção | `approvals/page.tsx:198-205` vs `nav-items.ts:217-223` |
| U4 | Kanban read-only em `/tasks` compete com o pipeline (mesma metáfora, capacidades diferentes, sem aviso) | `task-kanban-board.tsx` (77 linhas, zero mutação) |
| U5 | Responsável em **texto livre** na edição de cartão, apesar de select na criação | `pipeline/page.tsx:749` vs `:621-624` |
| U6 | Ficha do cliente **subconta conversas/aprovações**: filtra no navegador sobre páginas de 30, sem filtro server-side por cliente | `clients/[id]/page.tsx:96-101` × `communications/routes.ts:26` |
| U7 | Evento criado pela UI **nunca aparece na aba Calendário do cliente** (modal não envia `client_id`) | `create-event-modal.tsx:53-63` |
| U8 | Nomes de pessoas hardcoded na tela Hoje (resquício de demo em produção) | `today/page.tsx:106-108` |
| U9 | Campos `[CONFIRMAR: ...]` exibidos para todo cliente (segmento/e-mail/telefone sem fonte real) | `demo-client-info.ts:64-73` |
| U10 | Quadro geral da agência **sem caminho de criação na UI**; se apagado, ninguém recria | `pipeline/page.tsx:259-263`; `pipeline/routes.ts:506-514` — INFERRED (pode existir seed não visto) |
| U11 | Drag de cartão sem confirmação de "salvo no ClickUp" | `use-pipelines.ts:120-143` — INFERRED |
| U12 | Modo mock é o default se `NEXT_PUBLIC_API_MODE` faltar (app sobe servindo MSW) | `msw-provider.tsx:5` — CONFIRMED_BY_CODE; estado na Vercel NOT_VERIFIED |

---

## 10. Oportunidades

Resumo; o catálogo completo está em **`docs/audits/automation-opportunities.md`**. As oportunidades convergem em 5 frentes (todas CONFIRMED_BY_CODE nas fontes primárias):

1. **Fechar elos da cadeia de negócio** (`jornadas-api.md` §4): aprovação→efeito real, vínculo contato→cliente, sync de volta ClickUp→demanda, prazo ponta a ponta, uma task só por demanda, status done/cancelled na UI.
2. **Eliminar redundância cara** (`performance-fase13.md` §3): cachear `/clickup/tasks/me`, invalidar `['pipelines']` via WS em vez de sync-on-open, batch de updates, cache de status de lista, paginar GET /pipelines.
3. **Prefill com dado que o sistema já tem** (`contexto-inteligencia.md` §3): select de membros no GrantAccessForm, responsável sugerido por atribuição, Studio com cliente pré-selecionado, evento de calendário já vinculado, filtro server-side por cliente.
4. **Confiabilidade de integração** (`clickup-gateway.md` §4, `clickup-sync.md` §4): retry-429 compartilhado, cache de `getTeamMembers`, `GET /clickup/tasks/:id`, filtro de QA por ambiente em vez de nome, reconciliação agendada de pipeline.
5. **Fechar o circuito dos agentes** (§14).

---

## 11. Quick wins — os 10 melhores (impacto/esforço/risco)

Critério: maior impacto operacional por menor esforço e risco de regressão. **Não implementados** — esta auditoria é somente-leitura. Ordenados por prioridade de execução.

### QW1 — Reiniciar o worker de produção (armar Bento 3.1)
- **ANTES:** worker roda processo de 13/10 16:48 com 13 jobs; `bento-varredura`, `briefingOperacional` (8h) e o tuning de concorrência existem só no fonte (CONFIRMED_IN_RUNTIME — `automacoes.md` §3.4).
- **DEPOIS:** 14 jobs armados; proatividade e briefing passam a existir em produção (flags `BENTO_PROACTIVE_*` decidem o modo — shadow primeiro, suportado em `bento-varredura.ts:20-28`).
- **Arquivos afetados:** nenhum (ação operacional: restart do container/launchd do worker).
- **Risco de regressão:** baixo — mesmo binário já testado; risco residual é o comportamento do 14º job em produção real (mitigado pelo modo shadow).
- **Testes:** `bento-varredura.test.ts` já verde (CONFIRMED_BY_TEST — `automacoes.md` §5).
- **Critério de aceite:** log de boot lista 14 repeatables incluindo `bento-varredura`; primeiro ciclo da varredura registrado sem erro.

### QW2 — Corrigir o dedup do event store (histórico de updates)
- **ANTES:** `externalId = event:taskId:webhook_id` com `webhook_id` constante → só o primeiro `taskUpdated` de cada task é gravado; linha do tempo, proatividade e sinal de vida do integration-health perdem todos os updates seguintes (CONFIRMED_BY_CODE — `apps/api/src/clickup/routes.ts:606`, índice único em `event-store.ts:117-137`).
- **DEPOIS:** `externalId` usa `history_items[0].id` (único por mudança), com fallback `event:taskId:history_date`.
- **Arquivos afetados:** `apps/api/src/clickup/routes.ts` (~1 linha); teste `routes.test.ts:385-397` vira o alarme correto.
- **Risco de regressão:** baixo — eventos passam a gravar mais linhas (é o objetivo); dedup de reentrega do ClickUp continua coberto pelo id do history_item.
- **Testes:** ajustar o teste existente para duas mudanças na mesma task com externalIds diferentes. Disponibilidade de `history_items[].id` em payload real é INFERRED da doc oficial — validar com um payload capturado antes de subir.
- **Critério de aceite:** duas atualizações consecutivas na mesma task geram duas linhas no event store.

### QW3 — Inbox: não perder mensagem em falha de envio
- **ANTES:** rascunho limpo antes do POST; erro engolido (`catch(() => undefined)`), sem toast (CONFIRMED_BY_CODE — `thread-chat.tsx:63-64`).
- **DEPOIS:** rascunho só limpa após sucesso; falha gera toast e preserva o texto (padrão já usado em `approvals/page.tsx:56-60`).
- **Arquivos afetados:** `apps/web/src/components/inbox/thread-chat.tsx` (~5 linhas).
- **Risco de regressão:** mínimo — mudança local no handler de envio.
- **Testes:** não há teste de componente para thread-chat hoje; critério manual + fumaça e2e futura (jornada inbox é NOT_TESTED, §17).
- **Critério de aceite:** com a API fora do ar, o texto digitado permanece no campo e um erro visível é exibido.

### QW4 — Invalidar `['pipelines']` no evento WS `clickup.task_changed`
- **ANTES:** o webhook move/cria/apaga cartões, mas a tela de pipeline só reflete após navegação ou mutação local; telas adjacentes divergem (CONFIRMED_BY_CODE — `use-realtime-events.ts:68-73`; `clickup-sync.md` P3).
- **DEPOIS:** quadro aberto atualiza em tempo real; permite depois reduzir o sync-on-open (QW de performance seguinte).
- **Arquivos afetados:** `apps/web/src/hooks/use-realtime-events.ts` (~2 linhas; opcionalmente evento dedicado `pipeline.card_changed` em `sincronizar-webhook.ts` para não refazer o GET inteiro).
- **Risco de regressão:** baixo — um refetch a mais por evento; em rajadas de webhook pode gerar GETs repetidos (React Query já deduplica em voo).
- **Testes:** hook coberto por padrão de invalidação existente; validação manual com dois navegadores.
- **Critério de aceite:** mudar status de uma task no ClickUp reflete no quadro aberto sem reload.

### QW5 — Abrir a fila de aprovações de negócio para colaborador
- **ANTES:** nav liberou `/approvals` para colaborador, mas a tela devolve "Acesso restrito" antes de renderizar a seção de negócio (CONFIRMED_BY_CODE — `approvals/page.tsx:198-205`).
- **DEPOIS:** `BusinessApprovalsSection` renderiza para todos; só a seção de tool-calls fica gateada (o hook `useToolCalls(isMaster)` já recebe o flag).
- **Arquivos afetados:** `apps/web/src/app/(shell)/approvals/page.tsx` (~10 linhas).
- **Risco de regressão:** baixo no front; **dependência:** confirmar que a API já autoriza colaborador em `approvals/*` (permissões seedadas incluem `approvals:*` para colaborador — `seed.ts:86-114`; comportamento real da rota NOT_VERIFIED).
- **Testes:** `approvals/routes.test.ts:167-207` cobre resolução atômica; adicionar caso de autorização por papel se a API precisar de ajuste.
- **Critério de aceite:** colaborador abre `/approvals`, vê e resolve um pedido de aprovação de brief.

### QW6 — Responsável por select na edição de cartão do pipeline
- **ANTES:** edição pede responsável em texto livre; criação usa select de colaboradores (CONFIRMED_BY_CODE — `pipeline/page.tsx:749` vs `:621-624`). Nomes divergentes quebram agrupamentos.
- **DEPOIS:** mesmo `<select>` de `useCollaborators` na edição.
- **Arquivos afetados:** `apps/web/src/app/(shell)/pipeline/page.tsx` (~15 linhas; o hook já está importado na página).
- **Risco de regressão:** mínimo — o payload já aceita o identificador do colaborador.
- **Testes:** fumaça `telas-do-sidebar.test.tsx` segue verde; validação manual da edição.
- **Critério de aceite:** editar cartão sem digitar nome; responsável gravado casa com o agrupamento por pessoa.

### QW7 — Passar `/clickup/tasks/me` pelo cache SWR
- **ANTES:** toda visita à tela Hoje paga varredura ao vivo do ClickUp por usuário — a seção `minhas_tarefas` dita o tempo de assentamento do `/today/summary` (CONFIRMED_BY_CODE — `clickup/routes.ts:1103-1110` vs cache em `:411-470`; baseline vizinha: 7,71s mediana sem cache, `routes.ts:388-391`).
- **DEPOIS:** `tasks/me` passa por `consultarComCache` incluindo `assigneeIds` na chave; webhook já invalida o cache inteiro.
- **Arquivos afetados:** `apps/api/src/clickup/routes.ts` (chave do cache + chamada).
- **Risco de regressão:** baixo — frescura máxima de 60s para a seção pessoal, mesma que a seção agência já tem.
- **Testes:** padrão de cache já testado no caminho `/agency`; estender para a chave com assignee.
- **Critério de aceite:** segunda visita a `/today` em <60s não gera chamada ao ClickUp para a seção pessoal (observável em log/latência).

### QW8 — Teto de retenção na fila `automations`
- **ANTES:** fila sem `removeOnComplete/removeOnFail` — Redis acumula histórico sem fim com automação horária (CONFIRMED_BY_CODE — `automation-queue.ts:14-17`; o mesmo defeito já foi medido e corrigido na fila `daily-digest`, `scheduler/index.ts:70-73`).
- **DEPOIS:** `removeOnComplete: 100, removeOnFail: 500`, copiado do padrão vizinho.
- **Arquivos afetados:** `packages/orchestrator/src/automation-queue.ts` (1 linha de config).
- **Risco de regressão:** mínimo — histórico operacional permanece em `automation_runs` (Postgres); só o histórico BullMQ é podado.
- **Testes:** `run-automation.test.ts` segue verde; inspeção de `getRepeatableJobs`/contagem de jobs após N runs.
- **Critério de aceite:** fila não excede o teto após 24h de automação horária.

### QW9 — Filtrar artefatos de QA no caminho do webhook
- **ANTES:** `ehTarefaDeTeste` vale só nas leituras em massa; tasks "QA Gate ..." entram no quadro geral pelo webhook e cartões de QA acumulam em "Concluído" no sync (CONFIRMED_BY_CODE — `clickup-sync.md` P2; `quadro-geral.ts:137-143`).
- **DEPOIS:** o mesmo filtro aplicado em `sincronizarNoQuadroGeral` (o nome já chega no parâmetro) e soft delete (não mover para Concluído) no sync em massa.
- **Arquivos afetados:** `apps/api/src/pipeline/sincronizar-webhook.ts:113`, `apps/api/src/pipeline/routes.ts:1027-1031`.
- **Risco de regressão:** baixo — o filtro já tem testes nos 6 formatos reais (`quadro-geral.test.ts:117-130`); falsos positivos documentados seguem os mesmos de hoje.
- **Testes:** estender `sincronizar-webhook.test.ts` (10 testes existentes) com caso de task de QA.
- **Critério de aceite:** task "QA Gate Bento ..." criada na lista interna não vira cartão; cartão de QA pré-existente some do quadro no próximo sync sem ir para "Concluído".

### QW10 — Boot log de alertas operacionais (CONFIGURADOS/MUDOS)
- **ANTES:** `sendOpsAlert` é no-op silencioso sem `ALERT_SLACK_WEBHOOK_URL`; worker morto e falha final de job podem não chegar a ninguém (CONFIRMED_BY_CODE — `alerts.ts:24-25`; estado da env NOT_VERIFIED).
- **DEPOIS:** uma linha de boot no worker informando "alertas: CONFIGURADOS/MUDOS" — mesmo padrão do log de estado do Agentic V2 (`apps/worker/src/index.ts:222-225`).
- **Arquivos afetados:** `apps/worker/src/index.ts` (~3 linhas).
- **Risco de regressão:** nulo (log).
- **Testes:** nenhum necessário além do boot observado.
- **Critério de aceite:** log de boot do worker exibe o estado resolvido dos alertas.

Menções honrosas (fora do top-10 por esforço ou dependência): logar a causa do `inference-warmth` (`.catch(() => null)` → captura da mensagem, `inference-warmth.ts:140`); instalar ou apagar o plist de fichas (Q operacional); incluir `Otto` no `BOT_REPLY_MARKER` (`clickup/routes.ts:58`); renomear `/knowledge` (`nav-items.ts:286`).

---

## 12. Riscos de segurança

Fonte primária: `artifacts/.../permissoes-seguranca.md` (verificação executada: 29/29 write-scope, 59/59 auth, 17/17 escopo de escrita — CONFIRMED_BY_TEST).

### R1 — Cerca de escrita ativa com topologia de env desconhecida [ALTA, estado INFERRED/NOT_VERIFIED]
`CLICKUP_WRITE_SCOPE_LIST_ID` está setada na VPS (contexto fornecido). Se estiver **no processo da API**: todas as rotas humanas `/clickup/tasks` POST/PATCH/DELETE, comentários e anexos falham com `WriteScopeError` (nenhuma monta a válvula — `clickup/routes.ts:675,756,820,898,1135,1191`), e o Bento **cala nas menções** de tasks reais (erro engolido em `routes.ts:1346`). Se estiver **só no worker**: as rotas da API escrevem em produção sem cerca — o cabeçalho de `write-scope.ts:11-14` ("impossível de contornar") é falso na prática; a cerca só vale no processo que tem a variável. Nenhuma das 4 variáveis da cerca/guard existe no `.env.example` (grep confirmado). Ação: confirmar em quais processos a variável está setada e decidir o estado final (válvula padronizada por `requireAuth+permissão+tenant` em todas as rotas humanas, ou remoção da cerca — recomendação já registrada em `docs/audits/bento-controle-da-operacao.md` §3.1 e nunca executada).

### R2 — Conta `qa-motion` escreve na carteira real [ALTA, CONFIRMED_BY_CODE; runtime NOT_VERIFIED]
`ehQaBot` compara o e-mail com a string inteira de `BENTO_QA_BOT_EMAIL` (default só `qa-bot@...` — `bento-action-guard.ts:1074-1077`, re-verificado nesta redação); `ehContaDeQa` faz split por vírgula e tem dois defaults incluindo `qa-motion@agenciadesigual.com.br` (`environment.ts:77-84`, re-verificado). Sem env configurada, `qa-motion` é QA para a cognição mas "humano autorizado" para a escrita — recebe `authorizedForProduction: true` e escreve em qualquer cliente, com a cerca ligada ou não. Com a env configurada como lista (formato que `environment.ts` espera), `ehQaBot` nunca casa e **nenhuma** conta de QA é reconhecida pelo guard. O comentário de `environment.ts:61-64` que afirma impedir divergência é falso: o parsing diverge.

### R3 — Credenciais de conectores por organização em claro [MÉDIA-ALTA, CONFIRMED_BY_CODE]
`organization_connectors.credentials` é jsonb sem cifragem (`organization-connectors.ts:34`; escrita em `connectors/routes.ts:337-343`) — inclui `apiKey` do ClickUp de cada empresa cliente e tokens de WhatsApp. O cofre AES-256-GCM existe a um arquivo de distância e cobre só tokens por usuário (`token-crypto.ts:51-67`). Um dump/backup/read-replica do Supabase expõe as chaves de produção de todos os clientes; o mascaramento no GET protege a API, não o armazenamento.

### R4 — Prompt injection sem sanitização no worker [MÉDIA, CONFIRMED_BY_CODE]
`textoExternoSeguro` (a defesa estrutural criada após a auditoria de 18/09) tem **zero uso fora do context-engine** (grep confirmado). O bloco de campanha do prompt do Bento interpola nomes de tasks crus (`campaign-context.ts:213-216`); o fluxo de menção manda o comentário cru do ClickUp ao LLM (`bento-mention.ts:79-97`, `agent-mention.ts:47-59`). Raio de explosão limitado a resposta forjada/contexto poluído — os gates de escrita estão fora do LLM — mas a classe de ataque segue aberta nos caminhos do worker.

### R5 — Menção de agente sem checagem de autor [MÉDIA, CONFIRMED_BY_CODE]
O webhook valida a assinatura do ClickUp (autentica o remetente, não o autor). Qualquer membro ou convidado do workspace que comente "@Bento" dispara chamada de LLM e resposta pública postada com a chave da agência (`clickup/routes.ts:1292-1335`). `webhook-actor.ts` resolve pessoa por clickup_user_id mas não é consultado para autorizar menções. Custo: gasto de LLM + superfície de injection (R4) aberta a qualquer convidado.

### R6 — Drag do pipeline sem auditoria [MÉDIA, CONFIRMED_BY_CODE, re-verificado nesta redação]
`PATCH /pipelines/:id/cards/:cardId` escreve status no ClickUp real com a válvula (`pipeline/routes.ts:1227,1275`) e **não chama `auditarAcao`** — as 5 chamadas de auditoria do arquivo (`:586,742,929,1041,1160`) não cobrem nenhuma mutação de cartão (criar/editar/mover/deletar). A única escrita humana direta no ClickUp de produção fora do Bento não deixa rastro em `audit_logs` — justo a ação que a auditoria existe para responder ("quem moveu essa tarefa?"). No ClickUp, o autor registrado é o dono do token da organização, não a pessoa.

### Demais riscos mapeados (não repetidos aqui)
Filtro de QA por nome (frágil nas duas direções), `GET /studio/jobs/:id` com bypass de master sem checar org, webhook WhatsApp verificado por apikey no corpo (mais fraco que HMAC; nunca testado contra instância real), documentação de segurança desatualizada — detalhes em `permissoes-seguranca.md` P7–P9 e `jornadas-api.md` G9.

---

## 13. Performance

Fonte primária: `artifacts/.../performance-fase13.md`. Números são MEASURED de baselines/comentários datados ou INFERRED por contagem de round-trips — **sem medição ao vivo nesta auditoria** (§18).

| # | Problema | Evidência | Custo estimado |
|---|---|---|---|
| PF1 | `/clickup/tasks/me` fora do cache, dentro do `/today/summary` | `clickup/routes.ts:1103-1110` — CONFIRMED_BY_CODE | Casa de segundos por visita à tela Hoje (mediana vizinha sem cache: 7,71s — MEASURED 08/10, `routes.ts:388-391`) |
| PF2 | Sync-on-open do pipeline paga ClickUp ao vivo a cada visita, sem cache | `pipeline/page.tsx:977-984`; `pipeline/routes.ts:223-242,322-334` — CONFIRMED_BY_CODE | Segundos a dezenas de segundos por quadro aberto (INFERRED; quadro geral = 1.239 tarefas abertas em 15/10, comentário `routes.ts:320`) |
| PF3 | N+1 serial de writes no sync (um `db.update` por tarefa, RTT ~130ms) | `pipeline/routes.ts:1111-1128,1016-1019,918-927` — CONFIRMED_BY_CODE | 50 tarefas ≈ 6,5s; 200 ≈ 26s (INFERRED a partir de MEASURED `client.ts:24`) |
| PF4 | Drag no quadro geral = 2-3 chamadas ClickUp sequenciais antes do write local; fallback de `estagiosDaLista` baixa a lista inteira | `pipeline/routes.ts:1244-1280,209-214` — CONFIRMED_BY_CODE | UI otimista absorve o gesto; toast e refetch esperam a cadeia |
| PF5 | GET /pipelines sem paginação: todos os quadros + todos os cartões | `pipeline/routes.ts:378-409` — CONFIRMED_BY_CODE | ~0,5-0,9 MB por resposta com quadro geral cheio (INFERRED); baixado após cada drag/sync/mutação |
| PF6 | Operações de escopo pessoal: até ~17 chamadas ClickUp por request | `pipeline/routes.ts:275-286,454-474,683` — CONFIRMED_BY_CODE | Um usuário ativo consome 20-40% da cota de 100 req/min da agência (INFERRED) |
| PF7 | 13+ intervalos de polling sobre pool de 3 conexões Postgres | lista em `performance-fase13.md` P7 — CONFIRMED_BY_CODE (intervalos), INFERRED (impacto) | Piso ~270ms/rota (MEASURED 13/10); WS já cobre a maioria dos eventos |

Infraestrutura de performance que já existe e não deve ser re-auditoria: caches SWR com invalidação por webhook, `/today/summary` paralelo via `app.inject`, `queryOperationTasks` com lotes paralelos e retry-429, índices de pipeline cobrindo as where clauses (`performance-fase13.md` §1.2).

---

## 14. Oportunidades com Bento

Escopo: o que o código mostra **fora** do programa Bento 3.1 (varredura/briefing/multifonte/flags — coberto em `docs/audits/bento-3.1-progress.md` e não repetido aqui). Fonte: `agentes.md` §4.

1. **Fechar a oferta "jogar pro dia útil seguinte":** a oferta (`bento-proatividade.ts:84`) e o helper (`proximoDiaUtil`, sem chamador fora do teste) existem; falta detectar a afirmativa e executar `update_task` com read-back (CONFIRMED_BY_CODE). É o menor "sugere mas não executa" do sistema.
2. **Fechar "ficou sem responsável, me diz de quem é":** mesmo circuito — oferta em `bento-proatividade.ts:93`, executor de assignee já existe em `bento-update-executor` (CONFIRMED_BY_CODE).
3. **Unificar o caminho de delete:** usuário com token MCP tem create/update/comment por um caminho e delete pelo REST legado; unificar ou declarar na resposta qual provedor executou (`bento-mcp-executor.ts:52` — CONFIRMED_BY_CODE).
4. **Suzy auditável:** a fila de aprovação existe e notifica masters; falta um executor no repo que realize a ação aprovada — hoje `approveToolCall` marca aprovado e ninguém executa (`tool-calls/routes.ts:240-243` — CONFIRMED_BY_CODE).
5. **Aposentar ou reviver o desigual-node:** hoje só confunde (README + sonda + registro sem uso no dispatch) (CONFIRMED_BY_CODE — `execute-job.ts:842-862`).
6. **Responder perguntas operacionais sem código novo:** com as 4 flags ligadas, o multifonte (agenda, inbox, aprovações, mídia) já entra no prompt; a lacuna é de dados (0 registros em aprovações/demandas/inbox), não de capacidade (CONFIRMED_BY_CODE — `contexto-multifonte.ts`; contagens NOT_VERIFIED, citadas de `bento-3.1-progress.md:277-279`).

---

## 15. Priorização P0–P3

| Prioridade | Item | Justificativa |
|---|---|---|
| **P0** | QW1 (restart do worker) | Código entregue que não existe em produção; ação operacional |
| **P0** | QW2 (dedup do event store) | Perda permanente de histórico a cada update; 1 linha |
| **P0** | QW3 (mensagem do inbox) | Perda de dado em tela de atendimento a cliente |
| **P0** | R1 (topologia da cerca) + R2 (qa-motion) | Segurança de escrita indefinida em produção; conta de QA com válvula |
| **P1** | QW4 (WS → pipelines), QW5 (aprovações), QW7 (cache tasks/me), QW8 (retenção), QW9 (filtro QA no webhook), QW10 (boot log de alertas) | Quick wins com risco baixo |
| **P1** | R6 (auditoria do drag), R4 (sanitização no worker), R5 (autor de menção) | Rastro e defesa em superfícies ativas |
| **P1** | Elo G2 (vínculo contato→cliente) | Desbloqueia o caso comum inbox→quinzena |
| **P2** | R3 (cifragem de credenciais de conectores — exige migração de dados) | Trabalho pesado já pronto em `token-crypto.ts`; falta aplicação + re-envelopagem |
| **P2** | Elos G1/G3/G4/G5 (aprovação→efeito, sync de volta, prazo ponta a ponta, uma task só) | Fechamento da cadeia de negócio |
| **P2** | Retry-429 compartilhado + cache de `getTeamMembers`; `GET /clickup/tasks/:id`; testes de rota do pipeline | Robustez de integração e cobertura do caminho de escrita |
| **P2** | PF2–PF5 (pipeline: sync-on-open, batch, paginação) | Depende de QW4 para não regredir frescura |
| **P3** | Renomes/limpeza: `/knowledge`, comentários que mentem (`mocks/pipeline.ts:18`, `brain/03`, CI), código morto (`removeTaskFromList`/`createFolder`/`createList`/`groupTasksByClient`, desigual-node), testes para `node-protocol`/`token-engine` | Higiene; nenhum bloqueia operação |

---

## 16. Roadmap

O roadmap detalhado (sprints, dependências e sequenciamento) está em **`docs/audits/automation-implementation-roadmap.md`**. Resumo executivo:

- **Sprint 1 (agora):** os 3 primeiros itens nomeados na resposta à Q10 (QW1–QW3) + decisão da cerca (R1/R2) + QW4/QW5. Tudo de 1 dia ou menos cada, exceto a decisão de segurança que é deliberativa.
- **Sprint 2:** R4/R5/R6 (higiene de segurança das superfícies ativas), QW6–QW10, elo G2.
- **Sprint 3:** fechamento da cadeia de negócio (G1/G3/G4/G5), cifragem de credenciais (R3), retry-429 + caches, testes de rota do pipeline.
- **Contínuo:** itens P3 e instrumentação de tempo-por-etapa (lacuna Q1).

---

## 17. Resultados dos testes

Fonte primária: `artifacts/.../testes-fase-11.md` (execução em 15/10/2026, HEAD `419dd4d`, `npx vitest run` nos 18 alvos com script `test`).

- **Total: 348 arquivos, 4.712 testes, 4.661 passando, 51 skipados, 0 falhas** (CONFIRMED_BY_TEST). Destaques: apps/worker 1.689 testes; packages/otto 405; context-engine 351; suites do pipeline refeito no dia da auditoria verdes (`quadro-geral` 13, `sincronizar-webhook` 10, webhook-mudancas 12, webhook-actor 5).
- **51 skips auto-excluídos** por falta de `TENANT_TEST_DATABASE_URL` — incluem **calendar cross-tenant (12 testes skipados)**, relatórios PDF, isolamento de ads/workspace e sync de calendário (CONFIRMED_BY_CODE — `calendar/routes.test.ts:48` e demais; NOT_TESTED na prática).
- **Jornadas sem cobertura:** `conversations/`, `messages/`, `notifications/` (inbox inteiro), `tool-calls/` (execução pós-aprovação), `ws/`, `uploads/` — 0 arquivos de teste (CONFIRMED_BY_CODE — `testes-fase-11.md` §4). **`PATCH /pipelines/:id/cards/:cardId` — o handler que escreve no ClickUp via drag — não tem nenhum teste de rota**: a válvula é testada na borda (write-scope, 29 testes), o handler que a invoca não (CONFIRMED_BY_CODE — §3 do artefato).
- **Playwright E2E: NOT_TESTED** — 39 specs existem mas exigem stack rodando + credenciais `QA_USER_EMAIL/QA_USER_PASSWORD` e batem em ambiente real; fora do mandato somente-leitura. O portão `000-credenciais.spec.ts` existe para impedir skip silencioso, mas não está agendado onde haja credenciais.
- **Flakiness:** `docs/audits/flakiness-suite-worker-20260930.md` (4 testes intermitentes do worker) **permanece válido** — uma execução verde hoje não fecha o issue (o próprio doc registra "3 execuções, 0 falhas" como insuficiente).
- `node-protocol` e `token-engine`: zero testes, sem script `test` (CONFIRMED_BY_CODE).

---

## 18. Limitações da auditoria

1. **Sem acesso a env, VPS, banco ou provedores externos** (política de segredos e mandato somente-leitura). Todos os estados de flags em produção (`BENTO_OPENAI_CORE_ENABLED`, `BENTO_PROACTIVE_*`, `OTTO_MOTION_ENABLED`, `ALERT_SLACK_WEBHOOK_URL`, `JARBAS_V2_URL`, `AGENT_LOOP_V2`) são NOT_VERIFIED.
2. **Env por processo desconhecida:** não se sabe se `CLICKUP_WRITE_SCOPE_LIST_ID` está no container da API, do worker ou em ambos — R1 e R2 dependem disso para severidade final; a leitura de código é conclusiva sobre o que acontece em cada combinação, não sobre qual está ativa.
3. **Inscrição do webhook ClickUp NOT_VERIFIED:** não há script/código no repo que registre `taskCreated/taskUpdated/taskDeleted` em produção; se a inscrição não os cobre, o caminho inbound inteiro está morto e o quadro só anda pelo sync manual.
4. **RLS do Supabase não inspecionado:** toda a fronteira de tenant observada está na aplicação; não se sabe se Row Level Security existe como segunda camada.
5. **Fricção de UI estimada, não medida:** o frontend não foi executado; contagens de clique e latências de tela são INFERRED de análise estática.
6. **"DEPLOYED" significa "no caminho de build/deploy versionado"**, não "processo verificado no ar" — exceção: `/health` da API confirmado no SHA `419dd4d` (CONFIRMED_IN_RUNTIME).
7. **Sem medição ao vivo de performance** (§13); baselines citados são de 08/10–13/10 e podem estar melhores ou piores hoje.
8. **Serviços externos são caixa-preta:** bento-qa, susy-service, agentes-desigual (internos não auditáveis do repo).
9. **Disponibilidade de `history_items[].id`** em payloads reais do ClickUp é INFERRED da documentação oficial, não de captura real.
10. **Uma única execução por suíte de testes:** flakiness intermitente não seria detectada.

---

## 19. Conclusão

O Desigual OS passou da fase de "promessa conectada" para a fase de "sistema operacional com dívida de fechamento". A arquitetura é sólida e as partes caras — cadeia de autorização de escrita, webhook com HMAC, caches com invalidação, reconciliadores, 4.661 testes verdes — já estão pagas. O custo operacional atual vem de três fontes:

1. **Elos fechados pela metade** na cadeia de negócio (inbox→quinzena→ClickUp→conclusão) e nas automações que parecem ligadas mas não produzem efeito (§6) — 12 casos confirmados.
2. **Duplicação de superfícies** (§7) que divide atenção do usuário e do time de manutenção: 6 visões da mesma tarefa, 2 fichas de cliente, 2 "Conhecimento", 2 sistemas de aprovação, 2 tasks por demanda.
3. **Drift código/runtime/config** — worker velho, env por processo desconhecida, inscrição de webhook não verificada, docs canônicas vencidas — que faz o sistema real divergir do sistema descrito.

Nenhum dos problemas de maior impacto exige arquitetura nova. Os 10 quick wins (§11) são todos de 1 linha a 1 dia, e a decisão de segurança mais urgente (R1/R2) é deliberativa, não de engenharia.

---

## 20. Recomendação final

**Executar a Sprint 1 imediatamente (§16, Q10), nesta ordem:** restart do worker (QW1), correção do dedup do event store (QW2), blindagem do envio no inbox (QW3) — e, em paralelo, a verificação deliberativa da topologia da cerca de escrita e da identidade das contas de QA (R1/R2), que é a única item da lista com potencial de escrita indevida na carteira real de clientes.

**Antes de qualquer expansão de superfície** (novas telas, novos agentes, Motion Engine em produção): fechar os elos G1–G5 da cadeia de negócio e instrumentar tempo-por-etapa (lacuna Q1), porque hoje não é possível medir o ganho de nenhuma automação nova.

**Não implementar** nada da §11 sem antes validar os dois pontos NOT_VERIFIED que mudam o desenho: a inscrição real do webhook ClickUp (§18.3 — se estiver incompleta, QW4/QW9 e todo o tempo real dependem dela) e o destino real do worker de produção (VPS Docker × launchd local — `automacoes.md` §4.8), que determina onde o restart da QW1 precisa acontecer.

---

## As 10 perguntas

### Q1 — Quanto do fluxo está automatizado?

**Não há base para uma porcentagem honesta.** Não existe instrumentação de tempo-por-etapa nem contagem de ações manuais por jornada — nenhuma tabela registra "tempo humano gasto" ou "ação manual vs automática" (CONFIRMED_BY_CODE: ausência verificada nos schemas e nas rotas de métricas). O que existe de matéria-prima: `automation_runs` (dispatches de automações agendadas), `audit_logs` (ações sensíveis, com cobertura parcial — o drag do pipeline não está lá, R6) e `operational_events` (eventos ClickUp, com o histórico de updates mutilado pelo defeito de dedup, QW2). Uma porcentagem calculada sobre essas fontes mediria atividade do sistema, não trabalho humano evitado.

**Leitura qualitativa por jornada** (fundamentada nos mapas de jornada, CONFIRMED_BY_CODE):

| Jornada | Leitura |
|---|---|
| Espelho ClickUp → telas | Majoritariamente automática (webhook + caches + reconciliador), com a ressalva da inscrição NOT_VERIFIED e do backfill manual de quadros |
| Quinzena → ClickUp | Semi-automática: criação espelha sozinha; prazo, status de volta e conclusão são manuais ou inexistentes (G3/G4) |
| Inbox → quinzena | Manual: conversão exige thread com cliente (que não tem rota de vínculo) + redigitação do título (G2) |
| Briefing | Manual com andaime: rascunho automático é concatenação de mensagens, campos estruturados ficam vazios (G7) |
| Aprovação → efeito | Manual/decorativa: resolver o pedido não age no recurso (G1) |
| Monitoramento operacional | Automática em desenho (14 jobs, watchdog, integration-health) com eficácia limitada em runtime: alertas possivelmente mudos, worker velho, varredura sem plateia (§6, §8.5) |
| Fichas/memória do Bento | Manual: o agendamento diário não está instalado em lugar nenhum (§6.1) |
| Ações do Bento no ClickUp | Automática com supervisão estrutural (cadeia RBAC+válvula+cerca), mas as ofertas proativas não executam (§6.12) |

**O que falta para responder com número:** timestamps de início/fim por etapa da quinzena, contagem de intervenções humanas por fluxo (já existe `requestedBy`/autor na maioria das tabelas — falta a métrica), e o `automation_runs` gravando outcome real em vez de `dispatched` (`automacoes.md` §4.2).

### Q2 — As 10 atividades manuais mais desnecessárias

"Tarefa que a pessoa faz hoje e o sistema já tem o dado ou o código para fazer por ela":

1. **Rodar `sincronizar-fichas.sh` na mão** — o agendamento 06:30 existe só no papel (plist não instalado) — CONFIRMED (`automacoes.md` §6.1.1).
2. **Abrir a tela de pipeline para o quadro se atualizar** — sync-on-open por visita; o webhook já traz os eventos — CONFIRMED (`pipeline/page.tsx:977-984`).
3. **Redigitar o título ao converter mensagem do inbox em quinzena** — a 1ª mensagem inbound já está gravada e disponível via `listMessages` — CONFIRMED (`client-demands-panel.tsx:51-58`; `jornadas-api.md` §4.3).
4. **Digitar e-mail de membro no GrantAccessForm** — `useCollaborators` já alimenta um select da mesma população no painel ao lado — CONFIRMED (`grant-access-form.tsx:24-31` vs `client-team-panel.tsx:33`).
5. **Digitar responsável em texto livre na edição de cartão** — select existe na criação do mesmo objeto — CONFIRMED (`pipeline/page.tsx:749`).
6. **Escolher o cliente do zero no Studio** mesmo vindo da ficha dele — o deep link só entende `?asset=`, mas o form já reage a clientId — CONFIRMED (`job-form.tsx:382-393`; `studio-content.tsx:125`).
7. **Recriar/religar o webhook do ClickUp manualmente** quando o túnel cai — `integration-health` religa suspensão, mas não recria túnel — CONFIRMED (`brain/99 - Pendencias.md:25`; `automacoes.md` §6.1.5).
8. **Reiniciar o worker à mão para código novo existir em produção** — não há sinalização nem automação de restart pós-deploy — CONFIRMED_IN_RUNTIME (`automacoes.md` §3.4).
9. **Concluir/cancelar quinzena por fora da UI** (API direta ou ClickUp) — `PATCH /demands/:id/status` existe, é testado e não tem chamador na interface — CONFIRMED (`jornadas-api.md` G3).
10. **Vincular contato do WhatsApp a cliente por fora do sistema** — nenhuma rota escreve `contacts.clientId`; o painel de quinzenas do inbox está pronto esperando o vínculo — CONFIRMED (`jornadas-api.md` G2).

### Q3 — Funcionalidades que existem mas não estão conectadas

- `registrarTempo` (time tracking ClickUp): código + erro prontos, ClickApp desligado — `clickup-client.ts:991-1024`.
- `getTask` completo sem rota: não existe `GET /clickup/tasks/:id` (re-verificado nesta redação — só DELETE/PATCH/comments/attachments em `clickup/routes.ts`); o frontend não consegue abrir detalhe de tarefa.
- `approval_requests` sem efeito no recurso aprovado (G1).
- `PATCH /demands/:id/status` sem chamador na UI (G3).
- `GET/PUT /clients/:id/brand-kit` sem aba na ficha completa (só editável pelo painel do chat).
- `ClientDemandsPanel` pronto, esperando `clientId` que nenhuma rota grava (G2).
- 4 operações ClickUp mortas: `removeTaskFromList`, `createFolder`, `createList`, `groupTasksByClient` (zero callers — `clickup-gateway.md` §3.3-4).
- desigual-node: fora do dispatch de chat (`execute-job.ts:842-862`).
- Ofertas proativas do Bento sem executor (§6.12).
- "Nova conversa" do inbox: botão sem `onClick` (U2).
- Tela `/knowledge`: 100% fixture.
- GPU gateway e fila `studio-jobs`: provavelmente inalcançáveis na topologia Docker (§6.3-4).

Todas CONFIRMED_BY_CODE nas fontes citadas; estados de uso real em produção NOT_VERIFIED.

### Q4 — Onde o ClickUp está subutilizado

1. **`getTask` sem rota** — descrição, checklists, anexos e watchers são lidos pelo cliente mas não servidos ao frontend (acima).
2. **Comentários sem tempo real** — `taskCommentPosted` sem menção é descartado (não grava evento, não publica WS); a aba de conversas depende de polling de 60s — CONFIRMED_BY_CODE (`clickup/routes.ts:1292-1295`; `use-client-clickup-comments.ts:24`).
3. **Checklists e custom fields sem UI** — o executor do Bento sabe criar checklist e setar custom field (`bento-update-executor.ts:589,574`), mas nenhuma tela expõe isso ao humano.
4. **`registrarTempo` pronto sem ClickApp ligado** — zero código novo necessário; falta ligar "Time Tracking" no workspace ClickUp (CONFIRMED_BY_CODE — `clickup-client.ts:991-1000`).
5. **Dependências, tags e watchers** idem: primitivas wired no executor, invisíveis na UI.

### Q5 — Onde o OS duplica o ClickUp sem agregar

- **`/tasks` × `/pipeline`:** dois kanbans da mesma tarefa ClickUp; um read-only, outro escreve — o read-only não agrega nada que o pipeline não tenha (CONFIRMED_BY_CODE — `jornadas-web.md` P4).
- **Espelho de demanda sem volta:** a task espelho criada com a quinzena não recebe status nem prazo, e a conclusão no ClickUp não conclui a quinzena — duplicação que gera divergência, não valor (G3/G4/G5).
- **Espelho `pipeline_cards` sem histórico:** o event store perde todos os updates após o primeiro por task (QW2) — o espelho local existe mas não responde "o que mudou hoje?", que era sua justificativa (`webhook-mudancas.ts:1-18`).
- **Caches por lista × cache agregado:** justificados por performance, mas ambos são esvaziados inteiros por qualquer webhook — duplicação de invalidação sem granularidade (CONFIRMED_BY_CODE — `clickup/routes.ts:499-502`).

### Q6 — Ações que poderiam ter menos cliques

Estimativa estática (frontend não executado — INFERRED salvo evidência citada):

1. **"Gerar peça" a partir da ficha do cliente** → `/studio?client=<id>`: hoje 4+ interações com seleção manual; passa a 1 clique (O3 de `contexto-inteligencia.md`).
2. **"Marcar reunião" na ficha** com cliente e participantes pré-vinculados: hoje o evento nasce órfão (U7); passa a 1 clique + confirmação (O4).
3. **"Virar quinzena" no inbox** com título pré-preenchido da 1ª mensagem: elimina a redigitação (hoje bloqueado para contatos novos — G2).
4. **Responder "sim" às ofertas do Bento** ("jogar pro dia útil seguinte", "me diz de quem é"): hoje o "sim" cai no classificador genérico; com o circuito fechado, 1 mensagem executa (§14.1-2).
5. **Criar o quadro geral da agência pela UI**: hoje não há caminho (U9); uma opção no select resolve (`pipeline/routes.ts:969-992` já sabe organizar).
6. **Concluir quinzena**: hoje impossível pela UI (Q2.9); um botão no header de `/demands/[id]` resolve.

### Q7 — Preenchimentos automáticos possíveis (dado já existe no sistema)

1. **Responsável do novo cartão** pela atribuição `account`/`manager` do cliente (`GET /clients/:id/assignments` já existe) ou o próprio usuário em quadro pessoal — CONFIRMED (`contexto-inteligencia.md` O2).
2. **Owner da quinzena** — já automático via `resolveAccountOwner` (CONFIRMED_BY_TEST); estender o mesmo para o responsável da task de produção no ClickUp (hoje nasce sem assignee — G6).
3. **Título da quinzena** a partir da 1ª mensagem inbound da thread (Q6.3).
4. **`client_id` no modal de evento** quando aberto a partir da ficha (corrige U7 na raiz).
5. **Prazo no ClickUp**: `dueDate` da demanda no espelho e no send-to-production (hoje omitido — G4); a UI já mostra o prazo, só não o envia (`use-briefs.ts:65`).
6. **E-mail ClickUp do usuário**: já automático no primeiro uso via casamento único (`vinculo-clickup.ts:15-29`) — o prompt manual virou exceção, como deve ser.
7. **Membro a receber acesso** via select em vez de e-mail digitado (Q2.4).

### Q8 — Automações que eliminam trabalho recorrente

1. **Reconciliação agendada de pipeline** (a cada N minutos, reusando a lógica idempotente do sync do quadro geral): fecha a janela de eventos perdidos do webhook e aposenta o sync-por-visita — `clickup-sync.md` §4.6.
2. **Sync de volta ClickUp→demanda**: status fechado no ClickUp → `demands.status='done'`; o mapa de status já existe (`quadro-geral.ts:categoriaDoStatus`) — `jornadas-api.md` §4.4.
3. **Aprovação com efeito**: resolver `approval_requests` de brief marca a versão aprovada automaticamente — uma query no service (`approvals/service.ts:113-124`).
4. **Fichas diárias do Bento de fato agendadas**: instalar o plist (ou movê-lo para cron na VPS) — elimina a rotina manual diária.
5. **Retry-429 compartilhado** no `fetchClickUp`: elimina a re-execução manual de comandos que falham sob rate limit — o código de espera já existe testado em `clickup-operation.ts:225-265`.
6. **Cache curto de `getTeamMembers`**: elimina N GETs `/team` por comando do Bento (a chamada mais repetida do sistema) — `clickup-gateway.md` §4.2.
7. **Restart pós-deploy do worker** (hook de deploy ou watchdog de SHA): elimina o drift código/runtime — o `/health` já expõe `release_sha` para comparar.
8. **Religação de túnel + webhook** no boot: hoje metade é automática (webhook), metade manual (túnel).

### Q9 — O que teria maior impacto diário

**Fechar a jornada inbox → quinzena → ClickUp → conclusão (G2+G3+G4+QW3).** Justificativa: é o fluxo que a operação executa todos os dias, por cliente; hoje ele combina o pior defeito funcional (mensagem perdida em silêncio, U1), o elo que bloqueia o caso comum (contato novo não vira demanda, G2) e o KPI que mente para sempre ("Quinzenas abertas" só cresce, G3). As alternativas fortes — frescura do pipeline em tempo real (QW4+QW7) e a cerca de escrita (R1) — têm impacto maior em risco/conforto, mas menor em trabalho diário repetido. INFERRED como ranking (sem instrumentação de frequência de uso, Q1); a ordenação interna deve ser confirmada com quem opera.

### Q10 — O que implementar primeiro (Sprint 1)

Sprint 1 = P0 + o restante dos quick wins de risco baixo, nesta ordem. **Os 3 primeiros itens, nomeados:**

1. **QW1 — Reiniciar o worker de produção** (armar `bento-varredura` + briefing das 8h; flags em modo shadow). Zero código; pré-requisito: confirmar onde o worker de produção roda (§20).
2. **QW2 — Corrigir o dedup do event store** (`externalId` ← `history_items[0].id`, `apps/api/src/clickup/routes.ts:606`). Uma linha + um teste que vira alarme; estanca perda diária e permanente de histórico.
3. **QW3 — Blindar o envio de mensagem no inbox** (rascunho só limpa no sucesso + toast no erro, `thread-chat.tsx:63-64`). ~5 linhas; elimina a perda silenciosa de mensagem para cliente.

Em seguida na Sprint 1: a decisão deliberativa R1/R2 (cerca + contas de QA — inclui confirmar a env por processo e uniformizar o parsing de `BENTO_QA_BOT_EMAIL`), QW4 (WS→pipelines) e QW5 (aprovações). Critério de saída da sprint: worker no SHA corrente com 14 jobs, event store gravando todo update, inbox sem perda silenciosa, cerca com topologia documentada e conta `qa-motion` sem válvula de produção.

---

*Relatório consolidado a partir de 11 investigações somente-leitura. Nenhum arquivo de produção foi alterado; a única escrita desta frente é este documento.*
