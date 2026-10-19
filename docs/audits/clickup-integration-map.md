# Mapa de Integração ClickUp — Desigual OS

Auditoria de 15/10/2026 · HEAD auditado: `419dd4d` (branch `feat/otto-motion-engine`; API `419dd4d` na VPS, web na Vercel).
Fontes: `artifacts/auditoria-2026-10-15/clickup-gateway.md` e `artifacts/auditoria-2026-10-15/clickup-sync.md`, com verificação pontual no código nesta sessão (itens marcados).
Escopo: credenciais e permissões, as 30 operações do gateway, sincronização bidirecional, integridade, filtro de QA (Fase 5.5) e lacunas. Auditoria SOMENTE-LEITURA; nada foi executado contra o ClickUp real.

Verificação executada pelas investigações de origem: 106/106 testes do pacote `tool-gateway` verdes e 125/125 testes de `apps/api/src/clickup` + `src/pipeline` verdes — todos com fetch/banco/Redis mockados (CONFIRMED_BY_TEST).

---

## 1. Mapa da integração

### 1.1 Credenciais por organização + fallback da casa

Modelo implementado em `packages/tool-gateway/src/task-provider-resolver.ts` (CONFIRMED_BY_CODE):

- **Por organização**: tabela `organization_connectors` guarda a credencial ClickUp de cada empresa. `resolveTaskProvider` (resolver:104) e `resolveClickUpCredentials(ForOrganizations)` (resolver:135,184) são as portas de entrada; callers: `mcp/server.ts`, `connectors/routes.ts`, `demands/service.ts`, `briefs/service.ts`, `clickup/routes.ts`, schedulers do worker.
- **Fallback da casa**: variáveis `CLICKUP_API_KEY`/`CLICKUP_TEAM_ID` da agência. Regra dura: config existente porém quebrada **nunca** cai no fallback (resolver:36-39) — erro explícito em vez de misturar workspaces.
- **Exceção deliberada**: `credenciaisClickUpDaEmpresa` (resolver:215-227, regra de 14/10/2026) cai no provedor da casa; é a porta de credencial de **todo** o Pipeline (pipeline/routes.ts ×10 ocorrências: :348,435,458,517,552,840,976,1065,1210,1257).
- **Status do conector**: aceita `'ativa'` **e** `'active'` (`conectorAtivo`, resolver:11-13) — dupla grafia é bug real de produção contornado por tolerância, não corrigido (CONFIRMED_BY_CODE).
- **`CLICKUP_BOT_API_KEY` deliberadamente fora** do resolver (resolver:41-43): o bot de QA não herda credencial de organização.

### 1.2 OAuth e leituras estruturais

`packages/tool-gateway/src/clickup-oauth.ts` concentra leituras estruturais por token de organização: `getAuthorizedTeams` (:103), `getSpaces` (:122, só uso interno :188), `getClientLists` (:186) e `getTasksInList(Paged)` (:317,351) com paginação de teto 20 páginas + flag `truncated` (:304,342-347). Callers: `integrations/routes.ts:116`, `integrations/clickup-sync.ts:41`, `clients/routes.ts:813,882,944` (CONFIRMED_BY_CODE, WIRED).

**Dados insuficientes**: o fluxo OAuth de conexão (autorização, callback, troca de código por token, refresh) não foi auditado — as fontes cobrem apenas as funções de leitura do arquivo. Falta auditoria do armazenamento e rotação dos tokens OAuth por organização.

### 1.3 MCP

O servidor MCP (`apps/mcp`) resolve credenciais pelo mesmo resolver (`resolveTaskProvider` em `mcp/server.ts`) e expõe ferramentas que delegam ao gateway: `mcp/tools/tasks.ts` chama `createTask`, `mcp/providers` usa `resolveMemberByName`, e `getTask`/`updateTask`/`deleteTask`/comentários são alcançáveis via MCP (callers listados na tabela da seção 2). MCP é consumidor do gateway, não caminho paralelo (CONFIRMED_BY_CODE).

### 1.4 Permissões e cercas (camadas)

| Camada | Mecanismo | Evidência |
|---|---|---|
| Rota HTTP | `requireAuth` + `requirePermission('clickup','write')` em todas as rotas autenticadas de `/clickup/*` | apps/api/src/clickup/routes.ts:673,949,993,1053,1132,1187 (CONFIRMED_BY_CODE, verificado nesta sessão) |
| Kill switch | `BENTO_WRITE_ENABLED` (ligado por default; desligar é env + restart) | packages/tool-gateway/src/write-scope.ts:49-63 (CONFIRMED_BY_CODE, verificado) |
| Cerca de lista | `CLICKUP_WRITE_SCOPE_LIST_ID`/`CLICKUP_TEST_LIST_ID`: só a lista cercada aceita escrita | write-scope.ts:70-73,92-108,118-143 (CONFIRMED_BY_CODE, 29 testes) |
| Válvula de produção | `authorizedForProduction: true` fura a cerca **só** para humano autenticado com `clickup:write` e organização batendo (provado rio acima por `bento-action-guard.ts`); bot de QA nunca recebe `true` | write-scope.ts:76-108,126; callers pipeline/routes.ts:1227,1275 (CONFIRMED_BY_CODE) |
| Fail-closed | Falha ao descobrir a lista da task **bloqueia** a escrita | write-scope.ts:130-136 (CONFIRMED_BY_CODE, verificado) |
| Fila de aprovação | DELETE/PATCH passam pelo Tool Gateway (`requestToolCall`/`approveToolCall`/`listPendingToolCalls`) | packages/tool-gateway/src/gateway.ts:36,169,120; clickup/routes.ts:755-809,818-886; tool-calls/routes.ts; approvals/service.ts (CONFIRMED_BY_CODE) |
| Anti-SSRF em anexo | `uploadTaskAttachment` valida URL fail-closed, teto 25MB, `redirect: 'error'` | clickup-client.ts:32-52,433,441 (CONFIRMED_BY_CODE, CONFIRMED_BY_TEST) |

Estado de deploy da cerca na VPS: NOT_VERIFIED (a investigação de origem não acessou a env da VPS; o código da cerca existe e está testado, e o arrastar-cartão passa `authorizedForProduction: true`, consistente com cerca ativa não bloquear produção).

---

## 2. Operações ClickUp do gateway

Estados: IMPLEMENTED = código existe · WIRED = tem caller em produção fora do pacote · TESTED = coberto por vitest · DEPLOYED = exposto em rota pública · USED_IN_PRODUCTION não pode ser provado sem logs da VPS (NOT_VERIFIED em todos; WIRED é o teto da evidência).

Coluna "Recurso" indica o suporte da operação a comentários/anexos/checklists/custom fields/subtasks/tags/prioridades/prazos.

| # | Operação | Local | Quem chama (produção) | Permissão/cerca | Testes | Estado | Recurso |
|---|---|---|---|---|---|---|---|
| 1 | getTeamMembers | clickup-client.ts:111 | collaborators/routes.ts, clickup/routes.ts:949, integrations/access.ts, lib/vinculo-clickup.ts | leitura | sim | IMPLEMENTED, WIRED, TESTED | — |
| 2 | findMemberByEmail | :129 | pipeline/routes.ts, clickup/routes.ts, bento-openai-core.ts | leitura | não | IMPLEMENTED, WIRED | — |
| 3 | resolveMemberByName | :182 | bento-update-executor, multi-create-executor, bento-mcp-executor, mcp/providers | leitura | sim (incl. caso "Gui/Guilherme") | IMPLEMENTED, WIRED, TESTED | responsável |
| 4 | findMemberByName | :237 | lib/operational-context.ts, bento-action-guard.ts | leitura | não | IMPLEMENTED, WIRED | responsável |
| 5 | createTask | :312 | clickup/routes.ts:673 (POST, idempotencyKey :702), mcp/tools/tasks.ts, adapter→demands/briefs, multi-create-executor | kill switch + cerca de lista | sim | IMPLEMENTED, WIRED, TESTED, DEPLOYED; idempotente só na rota HTTP | nome/descrição/responsáveis/prioridade/prazo |
| 6 | updateTask | :354 | pipeline/routes.ts:1227,1275 (arrastar cartão, `authorizedForProduction: true`), clickup/routes.ts:818 (PATCH), mcp, tool-calls/routes.ts | kill switch + cerca por task | sim | IMPLEMENTED, WIRED, TESTED, DEPLOYED; erro 400 lista status válidos (:384-391) | status/nome/responsável/prioridade/prazo |
| 7 | listStatusesForList | :403 | só interno (:424) + teste | leitura | sim | IMPLEMENTED, TESTED, sem caller externo | status |
| 8 | listStatusDetailsForList | :408 | pipeline/routes.ts:210,282 (quadro geral 4 categorias) | leitura | não | IMPLEMENTED, WIRED | status |
| 9 | listStatusesForTask | :422 | bento-action-guard, bento-update-executor; interno no updateTask (:385) | leitura | não | IMPLEMENTED, WIRED | status |
| 10 | getTaskListId | :567 | clickup/routes.ts, bento-action-guard, multi-create-executor; write-scope.ts:129 | leitura (base da cerca) | não | IMPLEMENTED, WIRED | — |
| 11 | getTaskResumo | :550 | clickup/routes.ts (linha do tempo do webhook) | leitura | não | IMPLEMENTED, WIRED | nome/status |
| 12 | getTask (read-back) | :653 | mcp, tool-calls/routes.ts, executors, adapter | leitura | sim (prioridade objeto, :585) | IMPLEMENTED, WIRED, TESTED | descrição/checklists/anexos/watchers/prioridade/prazo |
| 13 | uploadTaskAttachment | :435 | clickup/routes.ts:894 (POST attachments), bento-task-briefing, executors | kill switch + cerca + anti-SSRF + teto 25MB | sim | IMPLEMENTED, WIRED, TESTED, DEPLOYED | anexos |
| 14 | deleteTask | :476 | clickup/routes.ts:755 (DELETE), mcp, tool-calls, guard com confirmação | kill switch + cerca + fila de aprovação | não | IMPLEMENTED, WIRED, DEPLOYED | exclusão |
| 15 | getTaskComments | :504 | clickup/routes.ts:1132 (GET comments), clients/routes.ts, guard | leitura | não | IMPLEMENTED, WIRED, DEPLOYED | comentários |
| 16 | createTaskComment | :699 | clickup/routes.ts:1187 (POST comments), mcp, guard, executors | kill switch + cerca + dono da lista | não | IMPLEMENTED, WIRED, DEPLOYED | comentários |
| 17 | replyToComment | :719 | clickup/routes.ts, bento-openai-core | kill switch + cerca | não | IMPLEMENTED, WIRED; id retornado para anti-loop (:729-731) | comentários |
| 18 | addTaskTag | :745 | bento-update-executor.ts:534 | kill switch + cerca | não | IMPLEMENTED, WIRED; erro traduz "tag não existe no space" (:753-759) | tags |
| 19 | removeTaskTag | :763 | bento-update-executor.ts:547 | kill switch + cerca | não | IMPLEMENTED, WIRED | tags |
| 20 | addTaskDependency | :778 | bento-update-executor.ts | kill switch + cerca | não | IMPLEMENTED, WIRED | dependências |
| 21 | listCustomFields | :818 | bento-update-executor.ts:562 | leitura | não | IMPLEMENTED, WIRED | custom fields |
| 22 | setCustomFieldValue | :838 | bento-update-executor.ts:574 | kill switch + cerca | não | IMPLEMENTED, WIRED | custom fields |
| 23 | createChecklist | :854 | bento-update-executor.ts:589 | kill switch + cerca | não | IMPLEMENTED, WIRED | checklists |
| 24 | addChecklistItem | :868 | bento-update-executor.ts:592 | kill switch + cerca | não | IMPLEMENTED, WIRED | checklists |
| 25 | updateTaskWatchers | :886 | bento-update-executor.ts:628 | kill switch + cerca | não | IMPLEMENTED, WIRED (endpoint não-oficial, conferido ao vivo 28/09) | watchers |
| 26 | addTaskToList | :917 | bento-update-executor.ts | kill switch + cerca | não | IMPLEMENTED, WIRED; nome honesto ("mover" não existe na v2, :906-916) | listas/subtasks (estrutura) |
| 27 | removeTaskFromList | :934 | **nenhum** | kill switch + cerca | não | IMPLEMENTED, **NÃO WIRED** | listas |
| 28 | createFolder | :955 | **nenhum** | **sem cerca** (não toca task) | não | IMPLEMENTED, **NÃO WIRED**, sem cerca de escrita | estrutura |
| 29 | createList | :971 | **nenhum** | **sem cerca** | não | IMPLEMENTED, **NÃO WIRED**, sem cerca de escrita | estrutura |
| 30 | registrarTempo | :1001 | bento-update-executor.ts (import :6) | kill switch + cerca | não | WIRED mas **BLOQUEADO upstream**: workspace recusa (TIMEENTRY_072, ClickApp Time Tracking desligado, :991-1024) | tempo |
| + | casarMembroDoClickUp | :1036 | lib/vinculo-clickup.ts | leitura | sim | IMPLEMENTED, WIRED, TESTED | vínculo de pessoa |
| + | queryOperationTasks | clickup-operation.ts:268 | pipeline/routes.ts (:212,232,327,1075), clickup/routes.ts (agency/me), operational-context, mcp | leitura | sim | IMPLEMENTED, WIRED, TESTED; **único com retry 429** (:232-248) | tags/prioridade/prazo/status em massa |
| + | groupTasksByClient | clickup-operation.ts:382 | **nenhum fora do pacote** | leitura | sim | IMPLEMENTED, TESTED, **NÃO WIRED** (código órfão) | agrupamento |
| + | getTasksInList(Paged) | clickup-oauth.ts:317,351 | clients/routes.ts:813,882,944 | leitura OAuth da organização | sim | IMPLEMENTED, WIRED, TESTED; teto 20 págs + truncated (:304,342-347) | listagem por lista |
| + | getClientLists / getSpaces / getAuthorizedTeams | clickup-oauth.ts:186,122,103 | integrations/routes.ts:116, integrations/clickup-sync.ts:41 | leitura OAuth | não | IMPLEMENTED, WIRED (getSpaces só interno :188) | estrutura |
| + | resolveTaskProvider / resolveClickUpCredentials(ForOrganizations) / credenciaisClickUpDaEmpresa | resolver:104,135,184,215 | ver seção 1.1 | — | sim | IMPLEMENTED, WIRED, TESTED | credenciais |
| + | verifyClickUpSignature | webhook.ts:10 | clickup/routes.ts:1257 | HMAC timing-safe | sim | IMPLEMENTED, WIRED, TESTED, DEPLOYED (webhook público) | inbound |
| + | requestToolCall / approveToolCall / listPendingToolCalls | gateway.ts:36,169,120 | clickup/routes.ts, tool-calls/routes.ts, approvals/service.ts, execute-job.ts | RBAC do gateway | sim | IMPLEMENTED, WIRED; `checkAgentToolAccess` (:15) só interno | aprovação |

**Suporte por recurso (síntese)**: comentários (#15-17), anexos (#13), checklists (#23-24), custom fields (#21-22), tags (#18-19), prioridades e prazos (#5, #6, #12), watchers (#25), dependências (#20). **Subtasks**: não há operação dedicada de subtask (parent task); o suporte é indireto via `addTaskToList`/`removeTaskFromList` e campos de task — CONFIRMED_BY_CODE por ausência; nenhuma fonte evidencia `parent` em create/update.

Timeout de rede: 20s em **todas** as chamadas de `clickup-client.ts` (`fetchClickUp`, :13,54-63) e em `clickup-operation.ts` (:157) — CONFIRMED_BY_CODE.

---

## 3. Sincronização bidirecional

### 3.1 ClickUp → OS (inbound)

**Receiver**: `POST /clickup/webhook` — apps/api/src/clickup/routes.ts:1248-1349 (CONFIRMED_BY_CODE, DEPLOYED).

- **HMAC**: HMAC-SHA256 sobre o corpo cru com `timingSafeEqual` (packages/tool-gateway/src/webhook.ts:10-17). Parser de string crua encapsulado num plugin exclusivo do webhook (routes.ts:1238-1241) para não quebrar o JSON das demais rotas. CONFIRMED_BY_CODE + CONFIRMED_BY_TEST (routes.test.ts).
- **Resposta antes do processamento**: 200 enviado antes de processar (routes.ts:1273); processamento é inline depois do send — não há fila; um handler lento segura a promessa de um request já respondido (CONFIRMED_BY_CODE).
- **Inscrição de eventos em produção: NOT_VERIFIED.** O único registro de inscrição no repo é script de DEV (scripts/clickup-webhook-setup.sh:104) que registra **apenas `taskCommentPosted`** via cloudflared. Não há script/código que registre `taskCreated/taskUpdated/taskDeleted` em produção. Auditoria antiga (docs/audits/DESIGUAL_OS_RELEASE_READINESS_AUDIT.md:56) afirma "webhook ativo, 8 tipos de evento", sem data recente. Se a inscrição atual não cobrir eventos de task, todo o caminho `handleTaskChanged` está morto em produção e o quadro só anda pelo botão Sincronizar.
- **Pipeline do evento de task** (`taskCreated/taskUpdated/taskDeleted`): `parseTaskChangedEvent` (tool-gateway/src/webhook.ts:72-84, tolera `list_id` ausente) → `handleTaskChanged` (routes.ts:491-663):
  1. Esvazia os dois caches de leitura (routes.ts:499-502): cache da consulta agregada (`esquecerTarefasEmCache`, :468-470) e cache por lista da ficha do cliente (`esquecerTarefasDaLista`, cache-de-lista.ts:101-103).
  2. Busca nome/status/lista com cache de 60s por task (`resumoDaTarefa`, :476-489) — edição em lote não vira N GETs; `taskDeleted` não busca.
  3. Resolve cliente por `clients.clickup_list_id` (:539); lista desconhecida → evento descartado em silêncio (só log).
  4. Sincroniza cartões de pipeline: `sincronizarCartaoDaTarefa` (pipeline/sincronizar-webhook.ts:28-79) + quadro geral (:87-135). Regras: created cria cartão se o status bate com coluna; updated só **reposiciona** cartão existente (nunca cria — decisão documentada, :21-25); deleted faz soft delete. Falha aqui nunca derruba o webhook (catch com log, routes.ts:556-558).
  5. Resolve autor via entity graph (clickup_user_id → users), fallback por e-mail gravando o link (routes.ts:579-596, webhook-actor.ts:30-54).
  6. Grava no event store com dedup por índice único (source, external_id) (routes.ts:602-636; packages/orchestrator/src/event-store.ts:117-137) — **ver BUG abaixo**.
  7. Sync incremental de campanhas com janela de 5min por cliente (routes.ts:643-657; context-engine/src/campaign-sync.ts:124-139).
  8. Publica WS `clickup.task_changed` com `{client_id, task_id, event}` (routes.ts:659-662).

- **BUG do dedup (P1, alto) — CONFIRMED_BY_CODE, re-verificado nesta sessão**: `externalId = ${event}:${taskId}:${webhook_id}` (apps/api/src/clickup/routes.ts:606). `webhook_id` é o id da **inscrição**, constante para todos os eventos. O índice único grava só o **primeiro** `taskUpdated` de cada task; os seguintes voltam `status: 'duplicate'` (:634-636) e são descartados. Pipeline/WS/campanhas não são afetados, mas perdem-se para sempre: a linha do tempo (justificativa do módulo, webhook-mudancas.ts:1-18), a proatividade (`task.updated` é KNOWN_TYPE, operational-events.ts:46) e o sinal de vida do integration-health (lastEventAt, integration-health.ts:121-132). O próprio teste cristaliza o defeito: duas entregas com o MESMO externalId (routes.test.ts:396-397) — o mock esconde o índice único real. Correção concreta: usar `history_items[0].id` como externalId, caindo para `event:taskId:history_date` quando ausente (disponibilidade do campo em produção: INFERRED da doc oficial referenciada em webhook.ts:26-34, não validada em payload real).
- **taskCommentPosted**: só serve a menções de agente (routes.ts:1281-1348). Sem menção → descartado (não vira event store nem WS — comportamento, não bug; ver seção 5 do documento de sincronização de origem). Anti-loop: `BOT_REPLY_MARKER` (routes.ts:58, não cobre Otto — P4) + dedup Redis NX 7 dias por commentId (routes.ts:1308-1319), fail-open documentado se o Redis cai.
- **Anexos inbound**: não há tratamento de `taskAttachmentPosted` (não é parseado nem inscrito — CONFIRMED_BY_CODE por ausência em webhook.ts e no script).
- **Integration-health**: `apps/worker/src/scheduler/integration-health.ts:121-132` mede saúde pelo `occurred_at` do último evento clickup (afetado pelo bug do dedup); :41-57 lê saúde do webhook no ClickUp e :82-116 **religa** webhook suspenso automaticamente (com sonda 401 antes). Lê só `webhooks[0]` (:49) — com mais de um webhook no team pode mirar o errado (P5, baixo).

### 3.2 OS → ClickUp (outbound)

- **Rotas autenticadas**: POST /clickup/tasks com idempotência de intenção de 15s por `idempotencyKey` (routes.ts:702-716); DELETE e PATCH passam pela **fila de aprovação** do Tool Gateway (routes.ts:755-809, 818-886); comentários e anexos diretos com checagem de dono da lista (CONFIRMED_BY_CODE).
- **Arrastar cartão no pipeline**: `PATCH /pipelines/:id/cards/:cardId` — pipeline/routes.ts:1203-1236 (quadro por status) e :1244-1281 (quadro geral, categoria → `statusDaListaParaCategoria`, quadro-geral.ts:160-164). O ClickUp é escrito **antes** do banco; falha lá → cartão não se move aqui. Usa a válvula `writeScope.authorizedForProduction: true` (write-scope.ts:92-108,118-144 — re-verificado nesta sessão), que fura a cerca `CLICKUP_WRITE_SCOPE_LIST_ID` só para humano autenticado com permissão no quadro.
- **Kill switch**: `BENTO_WRITE_ENABLED=false` + restart do worker desliga toda escrita, sem deploy/revert/migração (write-scope.ts:40-63 — re-verificado).
- **Front otimista** com rollback em erro (apps/web/src/hooks/use-pipelines.ts:117-145).

### 3.3 Fonte autoritativa por campo

| Campo | Fonte autoritativa | Mecanismo |
|---|---|---|
| status, nome, responsável, avatar, prazo, prioridade | ClickUp | espelhados por `camposDaTarefa` (pipeline/routes.ts:245-253), gravados só quando mudam (:257-266) |
| posição, nota, valor, anexos do cartão | Desigual OS | só existem em `pipeline_cards` |
| estágio (coluna) | bidirecional, ClickUp primeiro na escrita | outbound escreve ClickUp antes do banco; inbound reposiciona via webhook |

CONFIRMED_BY_CODE (clickup-sync.md seção 1, verificado por leitura das rotas citadas).

### 3.4 O que acontece em cada evento

| Evento | ClickUp → OS | OS → ClickUp |
|---|---|---|
| Criar task | `taskCreated` → cria cartão se status bate com coluna; grava event store; WS (sincronizar-webhook.ts:28-79) | POST /clickup/tasks com idempotencyKey (15s); caminhos de agente (MCP/executor/adapter) sem chave ClickUp — proteção best-effort por `findDuplicateTask` (task-verification.ts:148) |
| Mover/mudar status | `taskUpdated` → **reposiciona** cartão existente (nunca cria); event store **perdido após o primeiro update** (bug P1) | PATCH via updateTask, escrito antes do banco; erro 400 devolve status válidos da lista (clickup-client.ts:384-391) |
| Excluir task | `taskDeleted` → soft delete do cartão; sem busca de resumo | DELETE /clickup/tasks/:id via fila de aprovação do Tool Gateway (routes.ts:755-809) |
| Comentar | `taskCommentPosted` sem menção → **descartado** (sem event store, sem WS; aba de conversas depende de polling 60s); com menção → responde agente com anti-loop | POST /clickup/tasks/:id/comments direto com checagem de dono da lista (routes.ts:1187) |
| Anexar | **não tratado** (evento não parseado nem inscrito) | POST attachments com anti-SSRF e teto 25MB (routes.ts:894, clickup-client.ts:435) |

### 3.5 Caches e invalidação no web

- Cache da consulta agregada `/clickup/tasks/agency`: 60s fresco / 10min validade, releitura em background, chave = teamId+hash(token)+listas (routes.ts:411-470); webhook esvazia tudo.
- Cache por lista (ficha do cliente): mesmo desenho (cache-de-lista.ts:29-103; consumido em clients/routes.ts:812).
- Front: `useRealtimeEvents` invalida **só** `['clients', clientId, 'clickup-tasks']` no evento `clickup.task_changed` (apps/web/src/hooks/use-realtime-events.ts:68-73). `['pipelines']` **nunca** é invalidada por evento e `usePipelines` não tem refetchInterval (use-pipelines.ts:19-24) — a tela de pipeline nunca fica sabendo do webhook (P3, médio): ficha do cliente atualiza na hora, quadro ao lado mostra o cartão na coluna velha até navegação ou mutação local.

---

## 4. Integridade

| Tema | Estado | Evidência |
|---|---|---|
| Idempotência inbound (event store) | índice único (source, external_id), mas **quebrado por externalId constante por task** (bug P1) | routes.ts:606,634-636; event-store.ts:117-137 (CONFIRMED_BY_CODE, verificado) |
| Idempotência outbound (criação) | só na rota HTTP (`idempotencyKey`, 15s); agentes/MCP sem chave — retry de rede no meio de POST /task pode duplicar tarefa | routes.ts:702-716; proteção best-effort `findDuplicateTask` (task-verification.ts:148) (CONFIRMED_BY_CODE) |
| Idempotência de menção | Redis SET NX 7 dias por commentId, fail-open se Redis cai; marker não cobre Otto | routes.ts:1308-1319, :58 (CONFIRMED_BY_CODE) |
| Duplicação de cartões | webhook created cria só se status bate com coluna; updated nunca cria — por desenho não duplica cartão | sincronizar-webhook.ts:21-25,28-79 (CONFIRMED_BY_CODE) |
| Conflitos | não há resolução de conflito: outbound escreve ClickUp **antes** do banco (ClickUp vence); inbound reposiciona sem checar versão — última escrita vence | pipeline/routes.ts:1203-1281 (CONFIRMED_BY_CODE) |
| Rate limit (429) | **só `queryOperationTasks` trata 429** (retry ×3, respeita `Retry-After`, backoff 2^n — clickup-operation.ts:232-248); `clickup-client.ts` e `clickup-oauth.ts` estouram 429 cru (grep: zero ocorrências — re-verificado nesta sessão). Impacto: `getTeamMembers` é chamado sem cache por toda resolução de nome (clickup-client.ts:130,183,238) — rajada de escrita do multi-create sob rate limit falha sem segunda chance | CONFIRMED_BY_CODE |
| Paginação | `queryOperationTasks`: MAX_PAGES=20 (:155), flag `truncated` (:148), lotes de 10 list_ids (:168), 3 lotes paralelos (:286), dedup por id (:298-301). `getTasksInList`: teto 20 páginas + truncated (clickup-oauth.ts:304,342-347) | CONFIRMED_BY_CODE + CONFIRMED_BY_TEST |
| Timezone | **dados insuficientes** — nenhuma fonte auditou conversão de timezone; `occurredAt` usa `ocorridoEm ?? new Date()` (routes.ts:632). Falta verificar se prazos (`due_date` epoch ms do ClickUp) e janelas (5min do campaign-sync, 15s do idempotencyKey) sofrem com fuso do servidor | NOT_VERIFIED |
| Falha parcial do webhook | cada etapa do `handleTaskChanged` tem catch com log; falha de pipeline não derruba o webhook | routes.ts:556-558 (CONFIRMED_BY_CODE) |
| Reconciliação | religar de webhook cobre suspensão, mas eventos perdidos na janela **não voltam**; não há job de reconciliação agendado | integration-health.ts:82-116 (CONFIRMED_BY_CODE; lacuna apontada) |

---

## 5. Filtro de QA por nome (Fase 5.5)

Implementação: `TAREFA_DE_TESTE_RE = /^(qa[ -]?gate\b|cliente teste\b|clinica teste\b|e2e[ -]|plug\d*$)/i` + `/\bpode apagar\b/i` (pipeline/quadro-geral.ts:137-143), com testes cobrindo os 6 formatos reais e nomes legítimos parecidos (quadro-geral.test.ts:117-130). CONFIRMED_BY_CODE + CONFIRMED_BY_TEST.

- **Aplicado só na leitura em massa**: `tarefasDaPessoa` (pipeline/routes.ts:241) e `tarefasDaAgencia` (:330). O caminho do webhook (`sincronizar-webhook.ts`) **não referencia o filtro** (grep vazio) — uma task "QA Gate Bento ..." criada na lista interna da agência (environment='production', com cliente vinculado) vira cartão no quadro geral pelo webhook (sincronizar-webhook.ts:113-134) mesmo sendo filtrada do sync em massa. CONFIRMED_BY_CODE.
- **"Ocultar" vira "concluir" no quadro geral**: no sync em massa, cartão cuja task não está mais entre as abertas é **movido para "Concluído"** (pipeline/routes.ts:1027-1031) em vez de removido — como as QA são filtradas de `tarefas`, cartões de QA pré-existentes acumulam em "Concluído". No quadro de cliente/pessoal o mesmo caso é soft-delete (:1150-1156). Tratamentos divergentes para o mesmo artefato. CONFIRMED_BY_CODE.
- **Falsos negativos possíveis**: qualquer artefato fora dos prefixos ("teste final", "[ENXAME] ..." — citado no próprio comentário de pipeline/routes.ts:237 — "qa bento" sem "gate", "Demo cliente") passa. O filtro é uma lista de prefixos conhecidos hoje, não uma propriedade do artefato. CONFIRMED_BY_CODE.
- **Falsos positivos possíveis**: tarefa real chamada "Cliente Teste ..." (a agência tem clientes-fixture, cf. `separarCarteira`) ou "E2E - fluxo de pagamento" (tarefa de engenharia legítima) some dos quadros sem aviso. O comentário (quadro-geral.ts:134-136) assume o risco de propósito, com teste como alarme. CONFIRMED_BY_CODE.
- **Ocultar ≠ excluir**: o filtro só tira da leitura; a task continua no ClickUp, continua entrando pelo webhook e continua contando em `operational_events`. Nada é apagado.

**Proposta por metadados (sem apagar nada)**, em ordem de custo:

1. **Tag `qa-artifact` no ClickUp**: o dado já chega — `OperationTask.tags` é lido e vai pro fio (routes.ts:362) e os executores do Bento já sabem `clickup.add_tag` (bento-update-executor.ts:535). Gates de QA passam a taggar na criação; o filtro vira `t.tags.includes('qa-artifact') || ehTarefaDeTeste(t.name)` — transição, não substituição. INFERRED (proposta, não implementada).
2. **Lista de QA vinculada a cliente `environment='qa'`**: `clients.environment = 'qa'` já existe e já é respeitado em `listasDosClientes` (pipeline/routes.ts:309) e em `sincronizarNoQuadroGeral` (sincronizar-webhook.ts:98). O buraco é só a lista interna da agência, que é production porém recebe artefatos. Apontar os gates para uma lista de QA separada resolve por estrutura, sem regex, e combina com a cerca `CLICKUP_WRITE_SCOPE_LIST_ID` já ativa (write-scope.ts:70-73). INFERRED (proposta).
3. **Lista explícita de listas de QA por organização** (coluna/tabela), se (2) for inviável por conta da cerca de lista única. INFERRED (proposta).

Correções pontuais associadas (não implementadas): aplicar `ehTarefaDeTeste(params.taskName)` em `sincronizarNoQuadroGeral` (sincronizar-webhook.ts:113 — o nome já chega no parâmetro) e soft-deletar, em vez de mover para Concluído, cartões que casam o filtro no sync do quadro geral (pipeline/routes.ts:1027-1031).

---

## 6. Lacunas

| Lacuna | Evidência | Impacto |
|---|---|---|
| `GET /clickup/tasks/:id` inexistente | únicos GET em clickup/routes.ts: members (:949), tasks/agency (:993), tasks/me (:1053), tasks/:id/comments (:1132) — re-verificado nesta sessão (CONFIRMED_BY_CODE) | o frontend não consegue abrir uma tarefa (descrição, checklists, anexos, watchers) apesar de `getTask` (clickup-client.ts:653) devolver tudo isso; o web já tem hooks de comments e row de task (apps/web/src/components/clients/clickup-task-row.tsx) sem endpoint para o corpo |
| `removeTaskFromList` órfã | clickup-client.ts:934, zero callers em apps/, packages/, nodes/ (CONFIRMED_BY_CODE) | o agente consegue adicionar task a lista (addTaskToList, :917) mas não desfazer |
| `createFolder`/`createList` órfãs e **sem cerca de escrita** | clickup-client.ts:955,971, zero callers (CONFIRMED_BY_CODE) | se uma rota um dia as chamar, escreve estrutura no workspace sem nenhuma válvula |
| `groupTasksByClient` órfã | clickup-operation.ts:382, exportada, testada, sem caller (CONFIRMED_BY_CODE) | código morto exercitado só por teste |
| Retry-429 não generalizado | só clickup-operation.ts:232-248; clickup-client.ts e clickup-oauth.ts sem tratamento (grep re-verificado nesta sessão, CONFIRMED_BY_CODE) | qualquer operação fora de `queryOperationTasks` falha sem segunda chance sob rate limit; correção concreta: extrair o retry para o `fetchClickUp` compartilhado (clickup-client.ts:54) — uma mudança cobre as 25 operações |
| `getTeamMembers` sem cache | chamado por toda resolução de nome/e-mail (clickup-client.ts:130,183,238), todo GET /collaborators, todo vínculo (CONFIRMED_BY_CODE) | 3 níveis de matching × N nomes = N GET /team por comando do Bento; cache curto (30-60s) é a otimização de maior alavanca |
| Inscrição do webhook em produção | NOT_VERIFIED — só existe script de dev com `taskCommentPosted` (scripts/clickup-webhook-setup.sh:104) | se a inscrição não cobre eventos de task, o caminho inbound de tasks está morto em produção e o quadro só anda pelo botão Sincronizar |
| Fluxo OAuth completo | **dados insuficientes** — fontes cobrem só leituras de clickup-oauth.ts | falta auditar conexão, callback, armazenamento e rotação de tokens por organização |
| Subtasks dedicadas | ausência de operação com `parent` (CONFIRMED_BY_CODE por ausência) | hierarquia de tasks só manipulável indiretamente |
| `registrarTempo` bloqueado | TIMEENTRY_072, ClickApp Time Tracking desligado no workspace (clickup-client.ts:991-1024) | zero código novo para ligar — falta só habilitar o ClickApp |

---

## 7. Limitações desta auditoria

- USED_IN_PRODUCTION não foi provado para nenhuma operação: exige logs da VPS. WIRED (caller real em código de produção) é o teto da evidência.
- Inscrição real do webhook, env da VPS (`CLICKUP_WRITE_SCOPE_LIST_ID`, `BENTO_WRITE_ENABLED`), índice único em produção e disponibilidade de `history_items[].id` em payloads reais: NOT_VERIFIED.
- Todos os 231 testes citados rodam com fetch/banco/Redis mockados — não exercitam o índice único real nem payloads reais do ClickUp.
- Documentos relacionados desta série: o inventário detalhado com evidências de teste está em `artifacts/auditoria-2026-10-15/clickup-gateway.md`; os problemas P1-P6 de sincronização, com propostas de correção, em `artifacts/auditoria-2026-10-15/clickup-sync.md`. Docs de progresso desatualizados (docs/bento-3.0-progress.md, brain/Fases/Fase 12, docs/architecture/desigual-os-mcp.md:47) estão listados nas fontes — não repetidos aqui.
