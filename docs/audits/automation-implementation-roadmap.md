# Roadmap de Implementação — Automação Desigual OS

- **Data:** 15/10/2026 (redigido em 16/10/2026, mesma base de código)
- **HEAD auditado:** `419dd4d` (branch `feat/otto-motion-engine`); API deployada na VPS no mesmo SHA (CONFIRMED_IN_DEPLOY via `/health`, `artifacts/auditoria-2026-10-15/agentes.md` seção 1); web na Vercel.
- **Fontes:** os 11 achados brutos de `artifacts/auditoria-2026-10-15/` (arquitetura, agentes, automacoes, clickup-gateway, clickup-sync, contexto-inteligencia, jornadas-api, jornadas-web, performance-fase13, permissoes-seguranca, testes-fase-11). Este documento ordena a execução; o diagnóstico completo de cada item está no artifact citado e a priorização relativa em `automation-priority-backlog.md` (documento irmão, escrito em paralelo).
- **Verificação pontual deste redator (16/10, CONFIRMED_BY_CODE, HEAD 419dd4d):** (a) o externalId do event store é `${event}:${taskId}:${webhook_id}` em `apps/api/src/clickup/routes.ts:606` — o defeito de dedup segue presente; (b) `/clickup/tasks/me` chama `queryOperationTasks` direto, sem `consultarComCache` (`apps/api/src/clickup/routes.ts:1103-1110`); (c) o handler WS `clickup.task_changed` invalida apenas `['clients', clientId, 'clickup-tasks']` (`apps/web/src/hooks/use-realtime-events.ts:68-73`) — `['pipelines']` de fora. As três ancoram os Sprints 1 e 2.

---

## 1. Premissas

1. **Cerca de escrita ClickUp ativa na VPS** (`CLICKUP_WRITE_SCOPE_LIST_ID` setada) — contexto fornecido à auditoria, não lido do `.env` (NOT_VERIFIED por política de segredos; `permissoes-seguranca.md` P1). O Sprint 1 trata a confirmação disso como tarefa, não como fato.
2. **Worker local do Mac está processando dados reais de produção** (automações, calendário Microsoft, eventos ClickUp) via launchd — CONFIRMED_IN_RUNTIME por logs (`automacoes.md` §1.1/§1.6). Onde roda o worker "oficial" de produção (VPS Docker vs. este Mac) é NOT_VERIFIED e vira item do Sprint 1.
3. **Capacidade de execução:** sprints sequenciais, escopo dimensionado para um time pequeno (1-2 pessoas) com deploy contínuo na VPS/Vercel. Nenhum item exige migração destrutiva de dados, exceto a re-envelopagem de credenciais (Sprint 1.6), que tem rollback próprio.
4. **Suíte de testes local verde como baseline:** 4.661 testes passando em 348 arquivos (CONFIRMED_BY_TEST, `testes-fase-11.md` §2). Qualquer sprint que derrube esse baseline não está pronto.
5. Números de latência citados (7,71s, 12,6s, ~130ms RTT) são MEASURED de baselines/comentários de código com data, não medidos nesta auditoria (CONFIRMED_BY_CODE como registro; valor atual NOT_VERIFIED — ver Sprint 5.5).

## 2. O que NÃO entra neste roadmap (e por quê)

| Excluído | Motivo |
|---|---|
| Reescrita do módulo pipeline ou do webhook receiver | O módulo foi refeito em 13–15/10 (11 commits até `419dd4d`) e tem 125 testes verdes (`clickup-sync.md` cabeçalho). Os defeitos são pontuais (dedup, filtro de QA, invalidação) — corrigir, não reescrever. |
| Novo serviço/fila para processamento de webhook | O processamento inline pós-200 (`apps/api/src/clickup/routes.ts:1273`) é uma decisão de simplicidade aceitável na carga atual; mover para fila é complexidade sem demanda medida. Reavaliar só se o baseline do Sprint 5.5 mostrar handlers lentos segurando requests. |
| Duplicar o escopo do Bento 3.1 (varredura proativa, briefing 8h, multifonte) | Já entregue em 14/10 (commits até `cea59e0e`) — o que falta é o worker rodar o código novo e as flags serem decididas (Sprint 1.5), não replanejar as features (`automacoes.md` §3.4, §4.1). |
| Executor auditável da Suzy / escrita real em Meta Ads | A execução pós-aprovação mora no susy-service externo, fora do repo (`agentes.md` §1.4, problema 4). Trazer para dentro é projeto próprio, não item de sprint. |
| GPU gateway na topologia Docker / Redis↔studio-node | Problemas de infraestrutura de deploy (`arquitetura.md` §3.1-3.2), NOT_VERIFIED em runtime; pertencem a um roadmap de infra, não ao de automação. |
| Tela `/knowledge` (100% fixture) e colisão de rótulo "Conhecimento" | Débito de UX de administração, sem impacto na operação diária (`jornadas-web.md` P5). Cosmético frente aos itens listados. |
| `registrarTempo` no ClickUp | Bloqueado upstream (ClickApp Time Tracking desligado no workspace, `clickup-gateway.md` linha 56). Zero código novo resolveria. |

---

## 3. SPRINT 1 — CONFIABILIDADE

**Objetivo:** fechar os defeitos que fazem o sistema mentir — eventos perdidos, métricas de sucesso falsas, credenciais expostas, produção rodando código velho — antes de construir automação em cima. Automação sobre base quebrada amplifica o defeito (ex.: invalidar `['pipelines']` por WS, Sprint 2.2, só é seguro quando o webhook é confiável).

### Escopo

| # | Item | Evidência | Etiqueta |
|---|---|---|---|
| 1.1 | **Dedup do event store**: trocar `externalId` de `${event}:${taskId}:${webhook_id}` para `history_items[0].id` (fallback `event:taskId:history_date`); corrigir o teste que cristaliza o defeito (`routes.test.ts:385-397` passa a exigir externalIds distintos) | `apps/api/src/clickup/routes.ts:606`; análise em `clickup-sync.md` P1 | CONFIRMED_BY_CODE (re-verificado 16/10); disponibilidade de `history_items[].id` em payload real INFERRED da doc oficial |
| 1.2 | **Inscrição de eventos do webhook**: verificar no ClickUp real se a inscrição de produção cobre `taskCreated/taskUpdated/taskDeleted` (o único script versionado, `scripts/clickup-webhook-setup.sh:104`, registra só `taskCommentPosted` e é de dev); versionar script de inscrição de produção com os eventos de task | `clickup-sync.md` §1 | NOT_VERIFIED — se a inscrição não cobrir, todo o `handleTaskChanged` está morto em produção |
| 1.3 | **Topologia da cerca de escrita**: confirmar em quais processos (API, worker) `CLICKUP_WRITE_SCOPE_LIST_ID` está setada; decidir o estado final — válvula `authorizedForProduction` nas 7 rotas `/clickup/*` + reply de menção via helper único (`clickUpConfigParaHumanoAutenticado`, proposto em `permissoes-seguranca.md` §3.1), ou remoção da cerca; documentar as 4 variáveis da cerca/guard no `.env.example` (ausentes, grep confirmado) | `permissoes-seguranca.md` P1, P9; `packages/tool-gateway/src/write-scope.ts:92-144` | CONFIRMED_BY_CODE o comportamento por combinação; combinação ativa NOT_VERIFIED |
| 1.4 | **Identidade qa-motion**: unificar o parsing de `BENTO_QA_BOT_EMAIL` — `ehQaBot` (string única, `bento-action-guard.ts:1074-1077`) vs. `ehContaDeQa` (lista, `environment.ts:77-84`) divergem; hoje `qa-motion@agenciadesigual.com.br` recebe a válvula de produção como "humano autorizado" | `permissoes-seguranca.md` P2 | CONFIRMED_BY_CODE; combinação de env em runtime NOT_VERIFIED |
| 1.5 | **Worker atualizado**: reiniciar o worker (processo local de 13/10 16:48 roda 13 jobs; o código arma 14 — falta `bento-varredura`, `briefingOperacional` e o tuning de concorrência de 14/10); depois decidir flags `BENTO_PROACTIVE_*` (shadow primeiro, suportado em `bento-varredura.ts:20-28`); documentar onde o worker de produção roda | `automacoes.md` §3.4, oportunidade 8; `apps/worker/src/scheduler/index.ts:30-45` | CONFIRMED_IN_RUNTIME (ps + log de boot + git log) |
| 1.6 | **Credenciais cifradas**: cifrar os campos secretos de `organization_connectors.credentials` (hoje jsonb em claro, `organization-connectors.ts:34`, escrita em `connectors/routes.ts:337-343`) com o `encryptToken` já existente (`token-crypto.ts:51-67`); script de re-envelopagem do que está gravado; decifrar só nos resolvers | `permissoes-seguranca.md` P3 | CONFIRMED_BY_CODE |
| 1.7 | **Aprovação ↔ brief**: em `resolveApproval` (`approvals/service.ts:113-124`), quando `resourceType='brief'` e aprovado, marcar a versão do brief (ou bloquear `send-to-production` com pedido pending/rejected); hoje resolver o pedido não tem efeito nenhum no recurso e o funil do control-center sub-reporta | `jornadas-api.md` G1/G8; `briefs/service.ts:209` | CONFIRMED_BY_CODE (zero consumers de `approval.resolved` além do event store) |
| 1.8 | **Volta de status ClickUp → demanda**: em `handleTaskChanged` (`clickup/routes.ts:491`), quando a task bate com `demands.clickup_task_id` ou `briefs.external_task_id`, mapear status fechado → `demands.status='done'`; o mapa de status já existe (`pipeline/estagios.ts`, `quadro-geral.ts:categoriaDoStatus`) | `jornadas-api.md` G3 | CONFIRMED_BY_CODE |
| 1.9 | **Testes da rota PATCH de cartão + auditoria do drag**: montar app Fastify injetando `PATCH /pipelines/:id/cards/:cardId` (`pipeline/routes.ts:1171`) com ClickUp mockado, assertando a válvula e a cerca; no mesmo handler, adicionar `auditarAcao` com old/new stage e status escrito (hoje a única escrita humana direta no ClickUp de produção sem rastro em `audit_logs`) | `testes-fase-11.md` §3 (gap); `permissoes-seguranca.md` P5 | CONFIRMED_BY_CODE (ausência de teste de rota e de `auditarAcao` no handler) |

**Adjacente absorvido (mesma fronteira, custo marginal):** o gate de tela de `/approvals` que bloqueia colaborador antes de renderizar `BusinessApprovalsSection` (`jornadas-web.md` P1, `approvals/page.tsx:198-205`) contradiz a decisão registrada em `nav-items.ts:217-223`; corrigir junto de 1.7 (CONFIRMED_BY_CODE).

### Dependências

- 1.2 e 1.3 exigem acesso ao ClickUp real e à env da VPS — única dependência externa do sprint.
- 1.1 e 1.2 bloqueiam o Sprint 2.2 (WS invalida pipelines): invalidar quadros por eventos de um webhook mal inscrito ou com eventos descartados perpetua estado divergente.
- 1.8 depende de 1.1 indiretamente: sem histórico confiável no event store, a volta de status deve ser escrita direta no handler (não via consumidor de eventos).

### Riscos

- **1.1:** se `history_items[].id` não vier em algum payload real, o fallback por `history_date` pode recolapsar dedup em edições em lote no mesmo segundo — mitigar logando quando o fallback for usado (INFERRED, payload real nunca capturado).
- **1.3:** ligar a válvula nas rotas humanas amplia a superfície de escrita em produção; o gate proposto (requireAuth + permissão + tenant) é o mesmo já usado no drag do pipeline. A alternativa (desligar a cerca) é decisão de produto já adiada uma vez (`docs/audits/bento-controle-da-operacao.md` §3.1).
- **1.6:** re-envelopagem de credenciais em produção é a única migração de dados do sprint — script idempotente, batch pequeno, com dry-run.
- **1.5:** restart do worker interrompe jobs em voo; janela de baixo tráfego.

### Testes

- 1.1: teste de rota com duas mudanças na mesma task → dois eventos gravados (inverte o teste atual).
- 1.4: teste de regressão `BENTO_QA_BOT_EMAIL="a@x,b@y"` → `ehQaBot('b@y') === true` (hoje falharia — `permissoes-seguranca.md` §3.2).
- 1.7: teste de service: aprovar pedido de brief marca versão; rejeitar bloqueia send-to-production.
- 1.8: teste de handler: `taskUpdated` com status fechado em task espelhada → demanda `done`.
- 1.9: novo teste de rota do drag (gap confirmado) + assert de insert em `audit_logs`.
- Gate do sprint: suíte completa verde (baseline 4.661 testes) + os novos.

### Critérios de aceite

1. Dois `taskUpdated` seguidos na mesma task geram duas linhas no event store (verificável em banco de teste).
2. Inscrição de produção do webhook cobre os eventos de task — confirmado na API do ClickUp, com script versionado.
3. `ehQaBot` e `ehContaDeQa` consomem a mesma função de parsing; qa-motion não recebe `authorizedForProduction`.
4. Worker em produção roda o SHA deployado e o log de boot lista 14 jobs.
5. Dump de `organization_connectors` não contém segredo legível; `resolveTaskProvider` continua funcionando (smoke de uma rota que resolve credencial).
6. Aprovar um pedido de aprovação de brief muda o estado do brief; tarefa concluída no ClickUp conclui a quinzena.
7. Arrastar cartão grava linha em `audit_logs` e o novo teste de rota passa.

### Rollback

- 1.1, 1.7, 1.8, 1.9: revert de commit (mudanças aditivas, sem migração).
- 1.3: se a válvula nas rotas causar comportamento inesperado, `BENTO_WRITE_ENABLED=false` no processo afetado volta tudo a read-only sem deploy (kill switch, `write-scope.ts:49-63`).
- 1.4: env-only; reverter a variável restaura o comportamento anterior.
- 1.6: script de re-envelopagem grava envelope novo sem apagar o campo antigo até smoke passar; rollback = restaurar backup da tabela (obrigatório antes de rodar).
- 1.5: restart anterior já é o estado anterior; se o 14º job causar ruído, desligar `BENTO_PROACTIVE_MONITORING` sem rollback de código.

---

## 4. SPRINT 2 — AUTOMAÇÕES DE ALTO IMPACTO

**Objetivo:** automações que removem trabalho manual medido hoje — redigitação no inbox, sync manual de quadros, varreduras ao vivo do ClickUp na tela Hoje — e tornam honestas as automações que já existem (resultado real de `automation_runs`, causa do `inference-warmth`).

### Escopo

| # | Item | Evidência | Etiqueta |
|---|---|---|---|
| 2.1 | **Inbox → demanda com vínculo**: rota `PATCH /inbox/threads/:id/client` (ou no contato) escrevendo `conversationThreads.clientId`/`contacts.clientId` — hoje nenhuma rota escreve esse campo e o webhook cria contato com `clientId: null` (`communications/routes.ts:220`); pré-preencher título da demanda com a 1ª mensagem inbound (já disponível via `listMessages`) | `jornadas-api.md` G2, oportunidades 2-3 | CONFIRMED_BY_CODE |
| 2.2 | **WS invalida pipelines**: adicionar `invalidateQueries(['pipelines'])` no caso `clickup.task_changed` de `use-realtime-events.ts:68-73` (ou publicar `pipeline.card_changed` dedicado em `sincronizar-webhook.ts` para não refazer o GET inteiro) | `clickup-sync.md` P3; `performance-fase13.md` P7 (lacuna inversa) | CONFIRMED_BY_CODE (re-verificado 16/10) |
| 2.3 | **Cache em `/clickup/tasks/me`**: passar a rota pelo `consultarComCache` incluindo `assigneeIds` na chave (`routes.ts:418-422`); hoje toda visita à tela Hoje paga varredura ao vivo do ClickUp por usuário dentro do `/today/summary` | `performance-fase13.md` P1; `apps/api/src/clickup/routes.ts:1103-1110` | CONFIRMED_BY_CODE (re-verificado 16/10); latência atual INFERRED |
| 2.4 | **Batch do N+1 de writes no sync**: trocar os loops seriais de `db.update` por cartão (`pipeline/routes.ts:1111-1128`, `:1016-1019`, `:918-927`) pelo padrão já usado 30 linhas abaixo (agrupar por stageId + `inArray`, como `:1032-1034`) | `performance-fase13.md` P3 | CONFIRMED_BY_CODE; custo (6,5s/50 tarefas) INFERRED de RTT ~130ms |
| 2.5 | **dueDate ponta a ponta**: enviar `dueDate` no espelho da demanda (`demands/service.ts:105-108`), defaultar para `demand.dueDate` no send-to-production quando o body vier vazio (`briefs/service.ts:202-246`), e a UI passar o valor (hoje chama com `{}` — `use-briefs.ts:65`) | `jornadas-api.md` G4 | CONFIRMED_BY_CODE |
| 2.6 | **`automation_runs` com resultado real**: hoje `dispatched` conta como sucesso no `success_rate` da tela (`automations/routes.ts:184`) mesmo quando o turno morre no kill switch do guard (log de 15/10 16:00: automação horária do Bento despachada → guard bloqueou 9s depois na mesma conversa); gravar outcome real (respondeu/esclarecimento/falha) e revisar o prompt da automação que parece ordem de escrita para o guard | `automacoes.md` §3.1 | Sintoma CONFIRMED_IN_RUNTIME; encadeamento dispatch→guard INFERRED (proximidade temporal + mesmo conversationId; confirmar lendo a conversa c13cd01b) |
| 2.7 | **`inference-warmth` com alerta**: trocar o `.catch(() => null)` (`inference-warmth.ts:140`) por captura da causa (276 falhas idênticas, `ttftMs ≈ 10s`, sem motivo logado) e alertar via `sendOpsAlert` após N falhas consecutivas; pré-requisito: confirmar que `ALERT_SLACK_WEBHOOK_URL` está configurada — sem ela o alerta é no-op silencioso (`alerts.ts:24-25`) | `automacoes.md` §3.3, §3.6; `arquitetura.md` §3.3 | Sintoma CONFIRMED_IN_RUNTIME; causa NÃO determinada; env de alerta NOT_VERIFIED |

**Adjacente absorvido (uma linha, mesma fila):** teto de retenção `removeOnComplete: 100, removeOnFail: 500` na fila `automations` (`automation-queue.ts:14-17`), copiando o que já existe na `daily-digest` (`scheduler/index.ts:70-73`) — `automacoes.md` §3.7, CONFIRMED_BY_CODE por omissão.

### Dependências

- 2.2 exige Sprint 1.1/1.2 concluídos (webhook confiável).
- 2.1 não depende de nada; o componente `ClientDemandsPanel` já está pronto esperando `clientId` (`jornadas-api.md` G2).
- 2.7 depende da confirmação da env de alerta (Sprint 1.3 cobre inventário de envs; incluir esta).
- 2.6 depende de 2.7 indiretamente: sem canal de alerta, outcome real de falha não chega a ninguém.

### Riscos

- **2.2:** invalidar `['pipelines']` dispara o GET sem paginação (Sprint 5.1) a cada evento de task — em dias de muita movimentação, custo de rede sobe antes do Sprint 5. Mitigação: evento dedicado `pipeline.card_changed` com payload mínimo, ou throttle de invalidação.
- **2.3:** cache por assignee aumenta cardinalidade de chaves; TTL de 60s fresco já limita. Webhook invalida o cache inteiro (desenho atual), então frescura piora pouco.
- **2.4:** batch por `inArray` muda a semântica de falha (uma linha ruim derruba o lote); manter log por tarefa antes do batch.
- **2.6:** mexer no que conta como sucesso vai DERRUBAR o `success_rate` exibido — esperado e desejado, mas comunicar: a métrica atual é inflada por design.

### Testes

- 2.1: teste de rota do vínculo (thread sem cliente → vinculada → painel de demandas renderiza) + teste web do prefill.
- 2.2: teste do handler WS (evento `clickup.task_changed` → query `['pipelines']` invalidada).
- 2.3: teste de rota: duas chamadas a `/tasks/me` com ClickUp mockado → 1 chamada upstream dentro da janela de frescor.
- 2.4: teste do sync com N tarefas mudadas → número de statements de update limitado (mock de db conta chamadas).
- 2.5: teste de service: demanda com `dueDate` → task criada com `due_date` no payload ClickUp.
- 2.6: teste do executor: resposta de esclarecimento → run gravado com outcome ≠ sucesso.
- Gate: baseline verde + novos testes.

### Critérios de aceite

1. Contato novo do WhatsApp pode ser vinculado a um cliente pela UI e sua mensagem vira demanda sem redigitar título.
2. Quadro de pipeline aberto reflete mudança feita no ClickUp sem navegação nem sync manual (validável com dois navegadores).
3. Segunda visita à tela Hoje dentro de 60s não chama o ClickUp para a seção pessoal (observável em log de upstream).
4. Sync de 50 tarefas mudadas executa updates em lote (≤ handful de statements, não 50).
5. Prazo da quinzena aparece como `due_date` na task do ClickUp (read-back).
6. Tela `/workflows` mostra taxa de sucesso que corresponde a respostas reais, não a dispatches.
7. Uma falha de `inference-warmth` loga a causa; N falhas consecutivas geram alerta entregue (ou log explícito de "alertas: MUDOS" no boot se a env faltar).

### Rollback

- 2.1, 2.2, 2.5, 2.6, 2.7: revert de commit; nenhum esquema novo exceto colunas/valores aditivos de outcome em `automation_runs` (default preserva comportamento antigo).
- 2.3: remover a rota do cache é revert de uma chamada; sem estado persistido.
- 2.4: revert do handler de sync; os dados gravados são os mesmos, só o padrão de escrita muda.

---

## 5. SPRINT 3 — UX CONTEXTUAL

**Objetivo:** parar de pedir ao usuário o que o sistema já sabe — responsável, cliente, vínculo de calendário — e unificar superfícies duplicadas da mesma entidade. Todos os dados necessários já existem na API; o sprint é de fio, não de capacidade.

### Escopo

| # | Item | Evidência | Etiqueta |
|---|---|---|---|
| 3.1 | **Prefill de responsável/cliente**: no `NovoCartaoModal` (`pipeline/page.tsx:578-625`), pré-selecionar/ordenar responsáveis a partir de GET `/clients/:id/assignments` quando o quadro tem `clientId`; em quadro pessoal, o responsável é o próprio usuário (`useMe`) | `contexto-inteligencia.md` O2 | CONFIRMED_BY_CODE (assignments existem e têm teste, `demands/routes.test.ts:210-223`) |
| 3.2 | **Select de colaboradores no lugar de texto livre**: edição de cartão do pipeline pede responsável em texto livre (`pipeline/page.tsx:749`) enquanto a criação usa `<select>` (`:621-624`); mesmo padrão no `GrantAccessForm` (`grant-access-form.tsx:24-31`), que pede e-mail digitado para a mesma população que `useCollaborators` já lista | `jornadas-web.md` P6; `contexto-inteligencia.md` O1 | CONFIRMED_BY_CODE |
| 3.3 | **CTA "Gerar peça" com cliente na ficha**: ficha do cliente ganha CTA → `/studio?client=<id>`; `job-form` lê o param (o `BrandKitSummary`, `job-form.tsx:112-122`, já reage ao clientId; hoje o deep link só entende `?asset=`, `studio-content.tsx:125`) | `contexto-inteligencia.md` O3 | CONFIRMED_BY_CODE |
| 3.4 | **client_id no calendário**: `CreateEventModal` monta o payload sem `client_id` (`create-event-modal.tsx:53-63`) embora POST /calendar/events aceite e valide o campo (`calendar/routes.ts:39,154-158`); sem isso, evento criado pela UI nunca aparece na aba Calendário da ficha (`clients/[id]/page.tsx:112`); adicionar CTA "Marcar reunião" na ficha com `client_id` fixo e participantes sugeridos via assignments | `contexto-inteligencia.md` P2/O4 | CONFIRMED_BY_CODE |
| 3.5 | **Fichas de cliente unificadas**: `/clients` (mestre-detalhe, com Memória) e `/clients/[id]` (sem Memória nem Brand Kit, abas diferentes — `clients/[id]/page.tsx:67`) divergem; pipeline linka para `/clients?id=` e o resto para `/clients/${id}`; unificar abas (componentes `ClientMemoryPanel` e `BrandKitEditor` prontos) e convergir os links para uma URL | `contexto-inteligencia.md` P3/O7; `jornadas-web.md` §3 (seis superfícies da mesma tarefa) | CONFIRMED_BY_CODE |
| 3.6 | **Ações inline**: (a) status `done/cancelled` de demanda na UI — o PATCH existe e é testado, mas não tem chamador no web (`use-demands.ts` só lista/cria), então quinzena nunca chega a done pela interface e o KPI de abertas cresce para sempre; (b) corrigir o envio de mensagem do inbox que engole erro e perde o rascunho (`thread-chat.tsx:63-64`); (c) remover ou implementar o botão morto "Nova conversa" (`inbox/page.tsx:89-91`) | `jornadas-api.md` G3, oportunidade 5; `jornadas-web.md` P2/P3 | CONFIRMED_BY_CODE |

### Dependências

- 3.1, 3.2 e 3.4 dependem só de dados já expostos (assignments, collaborators, calendar) — nenhum backend novo além de, no máximo, ordenação no payload.
- 3.6(a) combina com Sprint 1.8: a volta automática ClickUp→demanda reduz a necessidade do botão, mas o botão continua necessário para cancelamento e para demandas sem task.
- 3.5 é o item mais caro do sprint (decisão de navegação); pode ser fatiado: abas primeiro, URL depois.

### Riscos

- **3.5:** unificar URLs quebra links existentes (pipeline → `/clients?id=`); manter redirect da forma antiga por um ciclo.
- **3.2:** select fecha o vocabulário de responsáveis — bom para agrupamento, mas cartões antigos com nomes livres divergentes continuam divergentes; fora de escopo normalizar retroativo (dados insuficientes sobre quantos cartões têm nome livre hoje — não há contagem na auditoria).
- **3.6(b):** reter rascunho em erro muda comportamento que usuários podem ter aprendido a contornar; mudança pequena, comunicável.

### Testes

- 3.1/3.2/3.3/3.4: testes de componente (padrão vitest do web) assertando prefill e payload montado.
- 3.4: teste de rota existente de calendar cobre aceite de `client_id`; adicionar assert de que o evento aparece no filtro da ficha.
- 3.6(a): teste de hook/rota do PATCH de status via UI; (b): teste do `thread-chat` — falha do POST mantém rascunho e mostra toast.
- Estender `telas-do-sidebar.test.tsx` às rotas fora da nav (`/clients/[id]`, `/demands/[id]`) — hoje 35 testes cobrem só NAV_ITEMS (`jornadas-web.md` oportunidade 9).

### Critérios de aceite

1. Criar cartão em quadro de cliente abre com o responsável da conta pré-selecionado.
2. Nenhum campo de pessoa no pipeline e no grant-access aceita texto livre.
3. Ficha do cliente tem "Gerar peça" que abre o Studio com cliente e brand kit carregados.
4. Reunião criada pela ficha aparece na aba Calendário do mesmo cliente.
5. Uma única ficha de cliente por URL canônica, com Memória e Brand Kit; link antigo redireciona.
6. Quinzena pode ser concluída/cancelada pela interface; falha de envio no inbox não perde a mensagem digitada; não existe botão sem ação.

### Rollback

- Todos os itens são frontend ou mudanças aditivas de payload: revert de commit + invalidação de cache de CDN da Vercel. Redirect de 3.5 permanece até links antigos morrerem.

---

## 6. SPRINT 4 — INTELIGÊNCIA

**Objetivo:** fechar os circuitos em que o sistema promete e não executa, e adicionar a primeira camada de classificação por IA — sempre com confirmação humana, dentro da cadeia de autorização já existente (RBAC + válvula + cerca). Nada aqui cria novo caminho de escrita.

### Escopo

| # | Item | Evidência | Etiqueta |
|---|---|---|---|
| 4.1 | **Fechar os circuitos de oferta proativa do Bento**: a oferta "Quer que eu jogue pro dia útil seguinte?" (`bento-proatividade.ts:84`) usa `proximoDiaUtil` (:131) que **não tem chamador fora do teste** — se o usuário diz "sim", o turno cai no classificador genérico; idem "Ficou sem responsável. Me diz de quem é" (:93) com update de assignee já existente no `bento-update-executor`. Implementar a detecção da afirmativa contextual e executar o update com read-back | `agentes.md` §3.1, oportunidades 1-2 | CONFIRMED_BY_CODE (helper sem caller; executor com read-back existe e é testado) |
| 4.2 | **Classificação de inbox por IA com confirmação**: sugerir cliente para thread sem vínculo (a partir de telefone/pushName/histórico) e rascunho de classificação da demanda (prioridade/frente), exibidos como sugestão clicável — a confirmação humana grava via rotas do Sprint 2.1; nenhuma escrita automática | deriva de `jornadas-api.md` G2 ("classificação fraca", elo CLASSIFICAÇÃO da cadeia) | INFERRED como desenho — não há protótipo no código; a base de dados (pushName, mensagens, assignments) é CONFIRMED_BY_CODE |
| 4.3 | **Sugestão de responsável por carga**: ao criar demanda/cartão sem responsável óbvio, sugerir entre os assignments do cliente quem tem menos tarefas abertas (fonte: `tarefasDaPessoa`/`queryOperationTasks` já usados no pipeline e no `/today`) | deriva de `contexto-inteligencia.md` O2 e `performance-fase13.md` §1.2 | INFERRED como desenho; viabilidade de dados CONFIRMED_BY_CODE. Custo de leitura por sugestão precisa do cache do Sprint 2.3 para não pagar ClickUp ao vivo a cada sugestão |
| 4.4 | **Resumo de cliente parado**: insight "cliente X sem atividade há N dias" no `/today`, derivado de `ultima_atividade`/`pedidos_30d` que GET `/clients` já devolve (`clients/routes.ts:169-185,242-247`) e o `/today/summary` já carrega (`today/routes.ts:80`) — derivação direta, sem chamada nova | `contexto-inteligencia.md` O6 | CONFIRMED_BY_CODE a fonte; o consumo atual pelo /today precisa ser confirmado antes de implementar (verificar uso em `today/page.tsx` — a própria auditoria marca essa ressalva) |

**Explicitamente fora deste sprint:** replanejar varredura proativa, briefing das 8h ou contexto multifonte — entregues no Bento 3.1 (14/10) e cobertos aqui apenas pelo restart/flags do Sprint 1.5. O problema "proatividade sem plateia" (só 2 usuários no OS; sinais não chegam à equipe sem contas com `clickup_email` — `agentes.md` §3.6) é de onboarding de usuários, não de código: **dados insuficientes** para dimensionar como sprint técnico; falta decisão de produto sobre quem entra no sistema.

### Dependências

- 4.2 depende do Sprint 2.1 (rota de vínculo existe para a confirmação gravar).
- 4.3 depende do Sprint 2.3 (cache de `/tasks/me`/leitura de tarefas) para custo aceitável.
- 4.1 depende do Sprint 1.5 (worker rodando código atual) e das flags proativas decididas.
- Todos dependem da cadeia de autorização intacta (Sprint 1.3/1.4 não podem regredir).

### Riscos

- **4.1:** detectar "sim" contextual errado executa escrita real no ClickUp — o read-back do executor mitiga, e a oferta só deve armar o circuito por um turno (TTL curto de intenção), senão qualquer "sim" posterior dispara.
- **4.2/4.3:** sugestão errada com um clique de distância da gravação — manter a confirmação explícita; logar aceite/rejeite para medir precisão antes de qualquer passo rumo a auto-aplicar (fora de escopo aqui).
- **Risco de dados:** com a base de uso real pequena (sinais quase nunca dispararam em produção até 30/09 — `jornadas-api.md` §Signals), métricas de precisão das sugestões vão demorar a ter significância.

### Testes

- 4.1: testes do circuito completo — oferta → "sim" → `updateTask` chamado com a data certa → read-back; caso negativo: "sim" fora de contexto não executa.
- 4.2: teste de contrato da sugestão (payload com `suggested_client_id` + confiança) e da confirmação gravando via rota de vínculo.
- 4.3: teste de ranking por carga com tarefas mockadas.
- 4.4: teste de derivação (cliente com `ultima_atividade` > N dias → insight presente no summary).

### Critérios de aceite

1. "Sim" em resposta à oferta de fim de semana move a tarefa para o dia útil seguinte, com read-back confirmando, e gera linha no event store.
2. Thread sem cliente exibe sugestão de vínculo; um clique confirma e grava; rejeitar não grava nada.
3. Sugestão de responsável respeita assignments do cliente e ordena por carga; sem assignment, cai no comportamento atual (nulo, nunca palpite — invariante de `demands/service.ts:22-29`).
4. `/today` mostra clientes parados há N dias sem chamada adicional à API (payload já existente).

### Rollback

- 4.1: flag/env ou revert; sem a detecção de afirmativa, o sistema volta ao comportamento atual (oferta sem execução — estado conhecido).
- 4.2/4.3/4.4: sugestões são aditivas na UI; remover é revert de frontend. Nenhum dado novo é gravado sem confirmação, então não há estado a desfazer além das sugestões aceitas (que são gravações legítimas via rotas existentes).

---

## 7. SPRINT 5 — PERFORMANCE E ESCALA

**Objetivo:** preparar as rotas de operação para o volume real (1.239 tarefas abertas registradas em 15/10, comentário em `pipeline/routes.ts:320`) e criar o baseline de latência HTTP que não existe — hoje só há baseline de execução de agentes (`performance-fase13.md` §1.1).

### Escopo

| # | Item | Evidência | Etiqueta |
|---|---|---|---|
| 5.1 | **Paginar GET /pipelines**: hoje devolve todos os quadros + todos os cartões sem limit (`pipeline/routes.ts:378-409`); com o quadro geral cheio (~1.239 cartões), estima-se 0,5-0,9 MB por resposta, baixado a cada drag/sync/mutação; opções: boards sem cards + `GET /pipelines/:id/cards` sob demanda, ou omitir o quadro geral do payload padrão | `performance-fase13.md` P5 | CONFIRMED_BY_CODE a ausência de paginação; tamanho de payload INFERRED (sem captura real) |
| 5.2 | **Retry-429 global no ClickUp client**: extrair o retry com `Retry-After` de `fetchPage` (`clickup-operation.ts:225-265`) para o `fetchClickUp` compartilhado (`clickup-client.ts:54`) — hoje 2 dos 3 arquivos de rede estouram 429 cru pro caller, e uma rajada do executor multi-create sob rate limit falha sem segunda chance | `clickup-gateway.md` §3.1, oportunidade 1 | CONFIRMED_BY_CODE (grep: zero `429`/`Retry-After` em clickup-client.ts e clickup-oauth.ts) |
| 5.3 | **Cache de `getTeamMembers`**: chamada mais repetida do sistema (toda resolução de nome/e-mail faz 1 GET /team inteiro — `clickup-client.ts:130,183,238`); cache curto 30-60s invalidado por webhook | `clickup-gateway.md` oportunidade 2 | CONFIRMED_BY_CODE |
| 5.4 | **Revisão de polling vs WS**: intervalos ativos somam 15+ timers (infrastructure-health 15s, messages 5s/10s, costs 20s ×4 queries, etc. — lista em `performance-fase13.md` P7) sobre pool de 3 conexões (`packages/database/src/client.ts:16`); o WS já entrega a maioria desses eventos (`use-realtime-events.ts`); desligar ou espaçar polling onde o WS cobre, mantendo-o como rede de segurança onde não cobre | `performance-fase13.md` P7 | Intervalos CONFIRMED_BY_CODE; impacto agregado INFERRED (piso ~270ms/rota é MEASURED de 13/10) |
| 5.5 | **Baseline de latência das rotas de operação**: não existe baseline HTTP por rota (só de agentes); medir p50/p95 de `/today/summary`, `/pipelines`, `/clickup/tasks/agency|me`, drag de cartão, antes e depois dos Sprints 2 e 5 — é o artefato que transforma os INFERRED desta auditoria em MEASURED | `performance-fase13.md` §4 | Lacuna CONFIRMED_BY_CODE (ausência); metodologia a definir (não há harness de medição HTTP versionado — dados insuficientes para prescrever ferramenta; falta decisão) |

### Dependências

- 5.1 idealmente depois de 2.2 (WS invalidando `['pipelines']` aumenta a frequência do GET — paginar antes barateia a invalidação; se 5.1 atrasar, a mitigação do evento dedicado em 2.2 cobre).
- 5.3 e 5.2 são independentes e baratos; podem antecipar se o ClickUp rate-limitar na operação real.
- 5.4 depende do baseline de 5.5 para decidir com número, não com palpite.
- 5.5 pode começar em paralelo ao Sprint 2 (medir o "antes").

### Riscos

- **5.1:** quebra de contrato do payload — todos os hooks de pipeline (`use-pipelines.ts`) e as telas que re-filtram em memória (`page.tsx:853-881,944`) precisam migrar juntos; fazer em duas etapas (endpoint novo + migração da tela, remover o full depois).
- **5.2:** retry em escrita não-idempotente pode duplicar task (a idempotência de criação existe só na rota HTTP — `clickup-gateway.md` §3.2); aplicar retry-429 só a GETs primeiro, e a escritas com chave de idempotência depois.
- **5.4:** polling é a rede de segurança quando o WS cai; espaçar demais recria o problema que o polling resolveu (comentário em `use-realtime-events.ts:13-15`). Mudança gradual, por rota, com o WS health observado.

### Testes

- 5.1: teste de contrato do novo endpoint paginado + teste web do consumo por quadro.
- 5.2: testes de retry (429 com Retry-After → espera e repete; 429 em escrita sem idempotency → não repete) — o padrão já está testado em `clickup-operation.ts`, replicar no cliente compartilhado.
- 5.3: teste de cache (2 resoluções na janela → 1 GET /team) e de invalidação.
- 5.5: o próprio artefato de baseline (JSON em `artifacts/`, seguindo o padrão de `baseline-latencia-2026-09-*.json`).

### Critérios de aceite

1. GET /pipelines paginado; payload da abertura da tela de pipeline abaixo de teto definido a partir do baseline (número a fixar pelo 5.5 — seria inventado agora).
2. Nenhuma operação de leitura do ClickUp falha por 429 sem ao menos uma retentativa honrando `Retry-After`.
3. Resoluções de membro repetidas dentro de 60s não repetem GET /team.
4. Pelo menos as rotas cobertas por WS têm polling desligado ou espaçado, com o mecanismo de fallback documentado.
5. Baseline HTTP publicado em `artifacts/` com p50/p95 das rotas de operação, antes/depois.

### Rollback

- 5.1: endpoint antigo permanece até a migração da tela completar; rollback = a tela voltar a consumi-lo.
- 5.2/5.3: revert de uma função cada; sem estado.
- 5.4: intervalos são constantes no código; revert trivial.
- 5.5: artefato, não código — sem rollback.

---

## 8. Sequenciamento e leitura executiva

```
Sprint 1 (Confiabilidade)
  ├─ 1.1 dedup + 1.2 inscrição ──┐
  ├─ 1.3 cerca + 1.4 qa-motion   │ desbloqueiam
  ├─ 1.5 worker atual            ▼
  │                    Sprint 2 (Automações de alto impacto)
  │                      ├─ 2.1 inbox→demanda ──────────┐
  │                      ├─ 2.2 WS→pipelines            │
  │                      ├─ 2.3 cache /tasks/me ──┐     │
  │                      └─ 2.4–2.7 independentes │     ▼
  │                                               │  Sprint 4 (Inteligência)
  ▼                                               ▼  (4.2←2.1, 4.3←2.3, 4.1←1.5)
Sprint 3 (UX contextual) — independente, pode correr em paralelo ao 2
  │
  ▼
Sprint 5 (Performance e escala) — 5.5 pode iniciar no Sprint 2 (medir o "antes");
5.1 idealmente após 2.2
```

- **Sprints 1→2 são a espinha dorsal**: sem webhook confiável e worker atualizado, os Sprints 2.2 e 4.1 automatizam em cima de areia.
- **Sprint 3 é paralelizável**: todo frontend, depende só de dados já expostos; pode correr junto ao Sprint 2 com pessoa diferente.
- **Sprint 4 é o primeiro que entrega capacidade nova de IA**; os três anteriores só fazem o sistema cumprir o que já promete.
- **Sprint 5 fecha o ciclo de evidência**: o baseline de 5.5 converte os INFERRED de latência desta auditoria em MEASURED e é a régua dos critérios de aceite de performance.

## 9. Limitações deste roadmap

- Estados de env em produção (`CLICKUP_WRITE_SCOPE_LIST_ID`, `ALERT_SLACK_WEBHOOK_URL`, `BENTO_PROACTIVE_*`, flags do core MCP) são NOT_VERIFIED — Sprints 1.3, 1.5 e 2.7 começam por confirmá-los.
- Contagens de banco de produção (cartões, demandas, automation_runs) não consultadas; dimensionamentos de custo marcados INFERRED não devem ser citados como medida.
- O encadeamento "automação despacha → guard mata o turno" (Sprint 2.6) é INFERRED com evidência forte de log; confirmar lendo a conversa `c13cd01b` antes de codar a correção.
- Esforço por item: **dados insuficientes** — a auditoria mediu defeitos, não velocidade de entrega do time; estimativas de dias exigiriam histórico de velocidade que não consta nos artifacts.
- A disponibilidade de `history_items[].id` em payloads reais do ClickUp (base do Sprint 1.1) é INFERRED da documentação oficial referenciada no código (`webhook.ts:26-34`); validar com um payload capturado antes de mergear.
