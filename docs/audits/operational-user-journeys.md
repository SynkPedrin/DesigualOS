# Auditoria — Jornadas Operacionais

Data da auditoria: 15/10/2026 · HEAD auditado: `419dd4d` (branch `feat/otto-motion-engine`) · Deploy: API `419dd4d` na VPS, web na Vercel.
Fontes: `artifacts/auditoria-2026-10-15/jornadas-api.md`, `artifacts/auditoria-2026-10-15/jornadas-web.md`, `artifacts/auditoria-2026-10-15/contexto-inteligencia.md` (lidos integralmente).
Método: consolidação dos três achados + re-verificação pontual no código dos pontos G1, G2 e G3 (detalhes na seção 2). Análise estática; frontend não executado; produção não acessada.

Nota de nomenclatura: na UI, "demanda" aparece como **"Quinzena"** (`apps/web/src/components/clients/client-demands-panel.tsx:68,96`). Não existe modelo separado — quinzena == `demands`. CONFIRMED_BY_CODE.

Legenda de elo: **conectado** (funciona ponta a ponta no código), **parcial** (existe mas com restrição que quebra o caso comum), **inexistente** (sem caminho no código), **n/a** (o papel não atravessa o elo).

---

## 1. Jornadas por papel

### 1.1 Cadeia de referência (estado dos elos, independente de papel)

| Elo | Estado | Evidência | Etiqueta |
|---|---|---|---|
| SOLICITAÇÃO (WhatsApp → inbox) | Conectado | `apps/api/src/communications/routes.ts:188-235` | CONFIRMED_BY_CODE; em produção NOT_VERIFIED (webhook nunca testado contra Evolution real, BLOCKED_EXTERNAL declarado em `routes.ts:174-186`) |
| INBOX → DEMANDA | Parcial: conversão manual com redigitação de título; impossível para contato novo | `client-demands-panel.tsx:51-58`; gap G2 | CONFIRMED_BY_CODE |
| DEMANDA → CLIENTE | Conectado (`clientId` NOT NULL) | `packages/database/src/schema/demands.ts:24` | CONFIRMED_BY_CODE |
| CLASSIFICAÇÃO | Parcial: prioridade manual; sem classificação automática; contato sem cliente não classifica | `communications/routes.ts:220` | CONFIRMED_BY_CODE |
| DEMANDA → BRIEFING | Conectado (manual ou rascunho-andaime) | `apps/api/src/briefs/service.ts:50` | CONFIRMED_BY_CODE |
| RESPONSÁVEL | Conectado com fallback `null` | `apps/api/src/demands/service.ts:22-29` | CONFIRMED_BY_CODE + CONFIRMED_BY_TEST (`demands/routes.test.ts:210-223`) |
| PRAZO → CLICKUP | Inexistente | gap G4 | CONFIRMED_BY_CODE |
| DEMANDA → CLICKUP (espelho) | Conectado só na criação | `demands/service.ts:93-130` | CONFIRMED_BY_CODE |
| BRIEF → CLICKUP (produção) | Conectado, como 2ª task sem vínculo | `briefs/service.ts:238-251` | CONFIRMED_BY_CODE |
| APROVAÇÃO → EFEITO | Inexistente (decorativa) | gap G1 | CONFIRMED_BY_CODE |
| CLICKUP → DEMANDA (volta) | Inexistente | gap G3 | CONFIRMED_BY_CODE |
| ACOMPANHAMENTO | Conectado (eventos por demanda + KPIs do control center) | `apps/api/src/agency-control-center/routes.ts:88-140` | CONFIRMED_BY_CODE; KPIs degradados por G3/G8 |

### 1.2 ATENDIMENTO

Fluxo real: WhatsApp do cliente → webhook → thread no `/inbox` → painel de contexto da thread (abas Visão geral / Quinzenas / Tarefas / Arquivos) → resposta no chat.

| Elo | Estado | Evidência |
|---|---|---|
| SOLICITAÇÃO | Conectado | `communications/routes.ts:188-235` (CONFIRMED_BY_CODE; runtime NOT_VERIFIED) |
| CLIENTE | **Inexistente para contato novo** — thread nasce com `clientId: null` e o painel renderiza `<SemCliente />` | `communications/routes.ts:220`; `thread-context-panel.tsx:115-118` (CONFIRMED_BY_CODE) |
| CLASSIFICAÇÃO | Inexistente | nenhuma automação de triagem no caminho do webhook (CONFIRMED_BY_CODE por ausência) |
| BRIEFING | n/a neste papel | — |
| RESPONSÁVEL | Conectado para a conversa (`assignedToUserId`) | `communications/service.ts:93-97` (CONFIRMED_BY_CODE) |
| PRAZO / CLICKUP | n/a neste papel | — |
| ACOMPANHAMENTO | Parcial: painel mostra demandas/tarefas do cliente **somente quando a thread já tem `clientId`** | `thread-context-panel.tsx:115-118` (CONFIRMED_BY_CODE) |

Riscos específicos do papel: perda silenciosa de mensagem no envio (rascunho apagado antes do POST, erro engolido — `apps/web/src/components/inbox/thread-chat.tsx:63-64`, CONFIRMED_BY_CODE) e botão "Nova conversa" morto (`apps/web/src/app/(shell)/inbox/page.tsx:89-91`, CONFIRMED_BY_CODE). Para o caso comum (contato novo), a jornada inbox → demanda **não existe** (gap G2).

### 1.3 CRIAÇÃO

Fluxo real: recebe demanda com brief → redige versões em `/demands/[id]` → "Aprovar esta versão" → "Enviar para produção" → task no ClickUp → peças no `/studio`.

| Elo | Estado | Evidência |
|---|---|---|
| SOLICITAÇÃO | n/a (recebe via demanda, não origina) | — |
| CLIENTE | Conectado (herda `clientId` da demanda) | `demands.ts:24` (CONFIRMED_BY_CODE) |
| CLASSIFICAÇÃO | Parcial (prioridade manual) | — |
| BRIEFING | Conectado, mas o rascunho automático é concatenação de mensagens em `notes` — campos estruturados ficam vazios (G7) | `briefs/service.ts:121-151` (CONFIRMED_BY_CODE) |
| RESPONSÁVEL | **Parcial: task de produção nasce sem assignee no ClickUp** (G6) | `briefs/service.ts:232-237` (CONFIRMED_BY_CODE, declarado no próprio código) |
| PRAZO | **Inexistente ponta a ponta** (G4): UI chama send-to-production com `{}` | `apps/web/src/hooks/use-briefs.ts:65` (CONFIRMED_BY_CODE) |
| CLICKUP | Conectado como 2ª task, sem vínculo com o espelho da demanda (G5) | `briefs/service.ts:238-251` (CONFIRMED_BY_CODE) |
| ACOMPANHAMENTO | **Aprovação sem efeito** (G1); e a fila `/approvals` é inacessível a não-master na tela (P1 das jornadas-web) | `approvals/service.ts:89-125`; `apps/web/src/app/(shell)/approvals/page.tsx:198-205` (CONFIRMED_BY_CODE) |

Atrito adicional: o Studio exige escolher o cliente do zero — não há deep link da ficha (`apps/web/src/components/studio/job-form.tsx:382-393`; deep link só entende `?asset=`, `studio-content.tsx:125`). CONFIRMED_BY_CODE.

### 1.4 TRÁFEGO PAGO

Fluxo real mapeado: carteira em `/midias` (Meta; Google parcial) via `useMediaOverview`; tarefas operacionais no `/pipeline` (quadros por cliente) com escrita no ClickUp.

| Elo | Estado | Evidência |
|---|---|---|
| SOLICITAÇÃO / CLIENTE | Conectado: quadros de pipeline por cliente, listas ClickUp reais | `apps/web/src/app/(shell)/pipeline/page.tsx:9-23` (CONFIRMED_BY_CODE) |
| CLASSIFICAÇÃO / BRIEFING | n/a (não há trilha de brief de campanha mapeada nesta auditoria) | dados insuficientes |
| RESPONSÁVEL | Parcial: criação de cartão usa select de colaboradores; **edição usa texto livre** (ver seção 4) | `pipeline/page.tsx:621-624` vs `:749` (CONFIRMED_BY_CODE) |
| PRAZO / CLICKUP | Conectado para status (drag escreve no ClickUp); demais campos não auditados aqui | `pipeline/page.tsx:1382-1383` → `use-pipelines.ts:120-121` (CONFIRMED_BY_CODE) |
| ACOMPANHAMENTO | Parcial: visão em `/midias`; funil de aprovação de campanha/budget existe no tipo mas sem consumidor (G1/G8) | `packages/types/src/approval.ts:5`; `agency-control-center/routes.ts:128-140` (CONFIRMED_BY_CODE) |

**Dados insuficientes**: os três artefatos-fonte não detalham o fluxo de criação/edição de campanha, orçamento e publicação em `/midias`. Falta uma frente de auditoria sobre `useMediaOverview` e as rotas de mídia para mapear essa jornada com o mesmo rigor.

### 1.5 GESTÃO (gerente de conta)

Fluxo real: cria a quinzena em `/demands` (ou a partir do inbox, se a thread tiver cliente) → sistema atribui dono pela atribuição `account` do cliente → informa prioridade e prazo → acompanha em `/demands`, `/clients` e no control center.

| Elo | Estado | Evidência |
|---|---|---|
| SOLICITAÇÃO | Parcial: depende do elo inbox → demanda (G2) | `client-demands-panel.tsx:51-58` (CONFIRMED_BY_CODE) |
| CLIENTE | Conectado (obrigatório na criação) | `demands.ts:24` (CONFIRMED_BY_CODE) |
| CLASSIFICAÇÃO | Parcial: prioridade manual; nada automático | (CONFIRMED_BY_CODE por ausência) |
| BRIEFING | Conectado (criação de brief move status para `briefing`) | `briefs/service.ts:50` (CONFIRMED_BY_CODE) |
| RESPONSÁVEL | Conectado: `ownerId` = responsável `account` do cliente; `null` se ninguém atribuído — "nunca um palpite" | `demands/service.ts:22-29,44` (CONFIRMED_BY_CODE + CONFIRMED_BY_TEST) |
| PRAZO | **Parcial: existe na demanda, não chega ao ClickUp** (G4) | `demands/service.ts:105-108` (CONFIRMED_BY_CODE) |
| CLICKUP | Conectado só na criação (espelho); sem volta (G3) | `demands/service.ts:93-130` (CONFIRMED_BY_CODE) |
| ACOMPANHAMENTO | **Parcial: a quinzena nunca chega a `done` pela interface** (G3); KPI "Quinzenas abertas" cresce indefinidamente | `agency-control-center/routes.ts:117` (CONFIRMED_BY_CODE; crescimento INFERRED da ausência de caminho para `done`) |

### 1.6 DIREÇÃO (dono / master)

Fluxo real: `/` (Visão geral) e `/agencia` → control center (KPIs, funil, previstas para hoje) → `/signals` → `/approvals`.

| Elo | Estado | Evidência |
|---|---|---|
| (a cadeia operacional é indireta neste papel — consome os KPIs dela) | | |
| ACOMPANHAMENTO | Parcial: funil depende de `approval_requests` sobre briefs (G8) — como o pedido de aprovação é opcional e decorativo (G1), colunas "revisão"/"aprovação" zeram quando ninguém clica "Pedir aprovação" | `agency-control-center/routes.ts:128-140` (CONFIRMED_BY_CODE; sub-reporte INFERRED do design) |
| SINAIS | Parcial: sistema nunca disparou em produção até 30/09 (1 linha de teste); sem evidência de disparo real desde então | `apps/api/src/signals/routes.ts:25-29` (CONFIRMED_BY_CODE quanto ao histórico; estado atual NOT_VERIFIED) |
| APROVAÇÕES | Conectado para master (a tela bloqueia não-master, P1) | `approvals/page.tsx:198-205` (CONFIRMED_BY_CODE) |

A direção lê números que os gaps G1, G3 e G8 degradam na fonte: quinzenas abertas só sobem, funil sub-reporta, sinais mudos.

### 1.7 OPERAÇÕES / ADMIN

Fluxo real: `/people` (acessos, convites, papéis) → `/permissions` (papéis × ferramentas) → ficha do cliente, aba de equipe (`ClientTeamPanel`, atribuições `account`/`traffic`/…) → `/settings` (e-mail ClickUp).

| Elo | Estado | Evidência |
|---|---|---|
| Atribuição pessoa ↔ cliente | Conectado e bem resolvido: select de colaboradores, sem redigitação; é a fonte do `ownerId` das demandas | `apps/web/src/components/clients/client-team-panel.tsx:31-96`; `apps/api/src/clients/routes.ts:484-560` (CONFIRMED_BY_CODE) |
| Vínculo usuário ↔ ClickUp | Conectado: auto-vínculo no primeiro uso; prompt manual só no 409 (casamento ambíguo/inexistente) | `apps/api/src/lib/vinculo-clickup.ts:15-29`; callers em `auth/routes.ts:141`, `clickup/routes.ts:1055`, `pipeline/routes.ts:228` (CONFIRMED_BY_CODE) |
| Concessão de acesso a cliente | Parcial: `GrantAccessForm` pede **e-mail digitado** para a mesma população que o select ao lado já lista (ver seção 4) | `apps/web/src/components/clients/grant-access-form.tsx:24-31` (CONFIRMED_BY_CODE) |

---

## 2. Gaps de cadeia confirmados

Re-verificação pontual desta redação (working tree de `feat/otto-motion-engine`): G1, G2 e G3 foram re-conferidos no código e **permanecem vigentes** — ver notas em cada item.

### G1 — Aprovação decorativa; dois sistemas paralelos na mesma tela
`/demands/[id]` tem "Aprovar esta versão" (PATCH `/briefs/:id/approve-version` → `brief.approvedVersionId`) **e** "Pedir aprovação" (POST `/approvals` → `approval_requests`). Resolver o pedido como `approved` não marca versão nem status do brief; `rejected` não bloqueia nada — `sendBriefToProduction` só checa `approvedVersionId`. Nenhum consumidor reage a `approval.resolved` além do event store (grep em apps/api, apps/worker, packages).
Evidência: `apps/api/src/approvals/service.ts:89-125` (só atualiza a linha + evento); `apps/api/src/briefs/service.ts:209` (único gate é `approvedVersionId`); `apps/web/src/app/(shell)/demands/[id]/page.tsx:561-623`.
**Re-verificado nesta redação**: `resolveApproval` segue tocando apenas `approvalRequests` + `recordOperationalEvent`, e o gate de produção segue sendo só `approvedVersionId`. CONFIRMED_BY_CODE.
Efeito secundário: o funil do control center sub-reporta (G8 em jornadas-api.md).

### G2 — Inbox → demanda quebrado para contato novo
Webhook cria contato com `clientId: null` (`communications/routes.ts:220`) e a thread herda null (`:221`). Não existe rota que escreva `contacts.clientId` ou `conversationThreads.clientId`. Consequência: a aba "Quinzenas" do painel do inbox renderiza `<SemCliente />` (`thread-context-panel.tsx:116`) e mensagem de contato novo — o caso comum — não pode virar demanda. Quando a thread tem cliente, a conversão exige redigitar o título (`client-demands-panel.tsx:51-58`).
**Re-verificado nesta redação**: os únicos `UPDATE` em `conversationThreads` escrevem `assignedToUserId`, `lastMessageAt` e `status` (`communications/service.ts:93,154,260`); não há nenhum `UPDATE` em `contacts` em `apps/api/src`. CONFIRMED_BY_CODE.

### G3 — Demanda nunca chega a `done`
Sem sincronização de volta ClickUp → demanda: o webhook do ClickUp (`apps/api/src/clickup/routes.ts:491-559` + `pipeline/sincronizar-webhook.ts`) só move cartões de pipeline; `demands.status` nunca é tocado por evento do ClickUp. Na direção oposta, `updateDemandStatus` (`demands/service.ts:178-199`) também não atualiza a task espelhada. Status `done|cancelled` só existe via PATCH `/demands/:id/status` — **que não tem chamador na UI**.
**Re-verificado nesta redação**: `apps/web/src/hooks/use-demands.ts` (187 linhas) contém list/get/create/files/activity e **nenhuma mutação de status**. CONFIRMED_BY_CODE.
Consequência: quinzenas transitam `new → briefing → in_production` (pelos briefs) e nunca saem disso pela interface; o KPI "Quinzenas abertas" (`agency-control-center/routes.ts:117`) cresce para sempre. CONFIRMED_BY_CODE (crescimento do KPI: INFERRED).

### G4 — Prazo não chega ao ClickUp no espelho da demanda
`espelharNoClickUp` envia só título/descrição (`demands/service.ts:105-108`) — `dueDate` não vai junto. No send-to-production, a rota aceita `dueDate` (`briefs/routes.ts:30`, `service.ts:243`) mas a UI chama com `{}` (`use-briefs.ts:65`) e o campo `deadline` do BriefContent nem entra na descrição montada (`service.ts:216-227`). CONFIRMED_BY_CODE.

### G5 — Dupla task no ClickUp por demanda, sem vínculo
Criação da demanda gera task espelho (`demands/service.ts:73`); send-to-production gera **outra** task "[Brief] ..." (`briefs/service.ts:238-251`). Nenhuma FK liga as duas; a task espelho não recebe atualização quando o brief vai para produção. CONFIRMED_BY_CODE.

### G6 — Task de produção nasce sem assignee
Falta mapeamento `user.id` → assignee numérico do ClickUp, declarado no próprio código (`briefs/service.ts:232-237`). Documentado, não bug silencioso — mas o elo RESPONSÁVEL → CLICKUP fica aberto. CONFIRMED_BY_CODE.

### G7 — Rascunho de brief por concatenação
`draftBriefFromDemand` joga todas as mensagens inbound em `notes` (`briefs/service.ts:121-151`); campos estruturados (objective/deliverable/channel…) ficam sempre vazios no rascunho — a pessoa redige tudo. Declarado como andaime no cabeçalho do código: limitação conhecida, não defeito escondido. CONFIRMED_BY_CODE.

*G9 das jornadas-api (verificação do webhook WhatsApp por apikey no corpo) pertence ao documento de segurança da série — ver `artifacts/auditoria-2026-10-15/permissoes-seguranca.md`.*

---

## 3. A mesma tarefa em 6 superfícies — só uma escreve

A mesma tarefa ClickUp aparece em seis telas com cortes diferentes. Apenas `/pipeline` escreve status.

| # | Superfície | Fonte de dados | Escreve status? | Evidência |
|---|---|---|---|---|
| 1 | `/tasks` (lista + kanban) | `/clickup/tasks/agency\|me` | **Não** — kanban read-only, zero mutação/drag | `apps/web/src/components/tasks/task-kanban-board.tsx` (CONFIRMED_BY_CODE) |
| 2 | `/today` | `GET /today/summary` | Não | `apps/web/src/hooks/use-today-summary.ts:56-57` (CONFIRMED_BY_CODE) |
| 3 | `/pipeline` (quadros tipo=tarefas) | `/pipelines` real | **Sim** — drag → PATCH → ClickUp | `pipeline/page.tsx:1382-1383`; `use-pipelines.ts:120-121` (CONFIRMED_BY_CODE) |
| 4 | Ficha em `/clients` (mestre-detalhe) | `ClientTasksPanel` | Não | `apps/web/src/app/(shell)/clients/page.tsx:19` (CONFIRMED_BY_CODE) |
| 5 | `/clients/[id]` (ficha completa) | `GET /clients/:id/overview` | Não | `apps/api/src/clients/routes.ts:900-977` (CONFIRMED_BY_CODE) |
| 6 | Painel de contexto do inbox | aba "Tarefas" da thread | Não | `thread-context-panel.tsx:117` (CONFIRMED_BY_CODE) |

Problema composto: (1) e (3) usam a mesma metáfora (quadro Kanban) sobre o mesmo objeto com capacidades diferentes e sem aviso — nada na UI distingue o kanban read-only do kanban que escreve (P4 de jornadas-web). E o cliente tem **duas fichas** (`/clients` mestre-detalhe e `/clients/[id]`, linkadas entre si em `clients/page.tsx:426`) com conjuntos de abas divergentes: a completa não tem Memória nem Brand Kit (`clients/[id]/page.tsx:67`), embora GET/PUT `/clients/:id/brand-kit` existam (`clients/routes.ts:546+`). CONFIRMED_BY_CODE.

---

## 4. Onde o usuário digita o que o sistema já sabe

| Ponto | O que se digita | O que o sistema já tem | Evidência | Etiqueta |
|---|---|---|---|---|
| Edição de cartão do pipeline | Responsável em **texto livre** | Select de colaboradores reais na **criação** do mesmo cartão (`useCollaborators` já importado na página). Nomes divergentes ("Matheus" vs "Matheus Rial") quebram agrupamento por responsável | `pipeline/page.tsx:749` vs `:621-624` | CONFIRMED_BY_CODE |
| Conceder acesso a cliente (`GrantAccessForm`) | E-mail digitado à mão | `useCollaborators` lista a mesma população (membros da org) no painel ao lado; backend valida membership — typo vira 404 | `grant-access-form.tsx:24-31`; `client-team-panel.tsx:33,65-76` | CONFIRMED_BY_CODE |
| Studio (geração de peças) | Cliente escolhido do zero | Ficha do cliente tem CTAs e `BrandKitSummary` já reage a `clientId`; falta deep link `/studio?client=<id>` | `studio/job-form.tsx:382-393`; `studio-content.tsx:125` (só `?asset=`) | CONFIRMED_BY_CODE |
| Evento de calendário (`CreateEventModal`) | Sem campo de cliente; payload montado sem `client_id` | POST `/calendar/events` aceita e valida `client_id` contra o tenant; a aba Calendário da ficha filtra por `clientId` — evento criado pela UI **nunca aparece na ficha do cliente** | `create-event-modal.tsx:53-63`; `apps/api/src/calendar/routes.ts:39,154-158`; `clients/[id]/page.tsx:112` | CONFIRMED_BY_CODE |
| Novo cartão em quadro de cliente | "Responsável" abre vazio com select de todos | GET `/clients/:id/assignments` já devolve quem é `account`/`manager` daquele cliente (`board.clientId` conhecido) | `pipeline/page.tsx:578-625`; `clients/routes.ts:484-508` | CONFIRMED_BY_CODE (sugestão: INFERRED como oportunidade) |
| Ficha `/clients/[id]` — contagens | — | O sistema sabe o `clientId`, mas as rotas `/inbox/threads` e `/approvals` não aceitam filtro por cliente: a tela busca páginas de 30 e filtra no navegador — StatCard e abas **subcontam** qualquer cliente fora das 30 mais recentes | `clients/[id]/page.tsx:96-101`; `communications/routes.ts:26`; `use-approvals.ts:7-8` | CONFIRMED_BY_CODE |
| Título da demanda a partir do inbox | Redigitado | O texto da 1ª mensagem inbound já está gravado (`listMessages`) | `client-demands-panel.tsx:51-58` | CONFIRMED_BY_CODE (pré-preenchimento: oportunidade INFERRED) |

Caso contrário, positivo: `ClientTeamPanel` (atribuições) usa select de colaboradores e o vínculo de e-mail ClickUp é automático no primeiro uso — dois pontos onde o sistema **não** pede o que já sabe (`client-team-panel.tsx:31-96`; `vinculo-clickup.ts:15-29`). CONFIRMED_BY_CODE.

---

## 5. Fricção estimada por fluxo principal

**ESTIMATIVA** — o frontend não foi executado nesta auditoria (limitação declarada em jornadas-web); contagens derivadas da análise estática dos handlers, não de medição.

| Fluxo | Caminho | Interações estimadas | Fricção dominante |
|---|---|---|---|
| Responder cliente no inbox | sidebar → Inbox (1) → thread (1) → digitar → Enter | ~3 cliques | Risco, não contagem: falha de envio perde a mensagem em silêncio (`thread-chat.tsx:63-64`) — cada envio é uma aposta |
| Mover tarefa no pipeline | sidebar → Pipeline (1) → escolher quadro se houver vários (1) → arrastar (1 gesto) | ~2–3 interações | Ausência de confirmação de escrita: o PATCH invalida a query, mas nada na UI diz que o ClickUp aceitou (INFERRED de `use-pipelines.ts:120-143`) |
| Inbox → demanda, contato novo | — | **Impossível na UI atual** (G2) | Não há rota de vínculo contato → cliente; o caminho exigiria sair do inbox e criar/vincular por fora — workaround real: dados insuficientes |
| Inbox → demanda, thread com cliente | painel da thread → aba Quinzenas → nova quinzena → redigitar título | ~4 interações + 1 campo redigitado | Redigitação de título já disponível na 1ª mensagem |
| Ciclo completo da demanda (criar → brief → aprovar → produção) | `/demands` → `/demands/[id]` → criar brief → redigir versão → aprovar versão → enviar produção | ~2–3 telas, ~15–25 campos/cliques | Brief inteiro digitado à mão (rascunho só preenche `notes`, G7); prazo digitado não propaga (G4); "Pedir aprovação" é trabalho extra sem efeito (G1) |
| Conceder acesso a cliente | ficha → painel de acesso → digitar e-mail → confirmar | ~3 interações + 1 campo | E-mail digitado para população já listada ao lado; typo = 404 (seção 4) |
| Marcar reunião para cliente | `/calendar` → modal → preencher | ~4–6 campos | Evento nasce sem `client_id` e não aparece na ficha do cliente — retrabalho ou registro órfão (seção 4) |

---

## 6. Limitações

- **Produção não verificada**: sem acesso à VPS/Supabase. DEPLOYED aqui significa "registrado em `server.ts` e commitado no HEAD auditado"; USED_IN_PRODUCTION é NOT_VERIFIED para todos os fluxos. O cabeçalho de `signals/routes.ts:25-29` (sinais nunca dispararam em produção até 30/09) sugere pouco uso real de inbox/demands — INFERRED.
- **Webhook WhatsApp** nunca validado contra instância Evolution real (BLOCKED_EXTERNAL declarado em `communications/routes.ts:174-186`). NOT_VERIFIED.
- **Frontend não executado**: fricção da seção 5 é ESTIMATIVA; comportamento de drag, toasts e estados vazios descrito por análise estática.
- **Estado do banco desconhecido**: não se sabe se existe quadro geral da agência em produção nem como nasceu (não há caminho de criação na UI — INFERRED da ausência de opção no modal + rejeição no POST, `pipeline/routes.ts:506-514`).
- **TRÁFEGO PAGO sub-mapeado**: falta auditoria das rotas de mídia para a jornada completa (seção 1.4).
- Verificações locais de apoio (feitas pelos agentes de origem, 15/10/2026): apps/api `vitest run src/demands src/briefs src/approvals src/communications src/signals` — 40/40 verdes; apps/web `telas-do-sidebar.test.tsx` — 35/35; packages/context-engine — 351/351. CONFIRMED_BY_TEST, com DB mockado — não provam integração real com ClickUp/Evolution.
