# Análise de Fricção UX — Desigual OS

- **Data da auditoria:** 15/10/2026 (documento redigido em 16/10/2026)
- **HEAD auditado:** `419dd4d` (branch `feat/otto-motion-engine`; API `419dd4d` na VPS, web na Vercel)
- **Fontes:** `artifacts/auditoria-2026-10-15/jornadas-web.md`, `artifacts/auditoria-2026-10-15/contexto-inteligencia.md`, `artifacts/auditoria-2026-10-15/performance-fase13.md`
- **Método:** consolidação dos achados brutos das três fontes + re-verificação pontual no código das afirmações mais críticas (§6). Fricção em cliques é **ESTIMADA** — nenhuma das fontes rodou o frontend nem mediu interação real (`jornadas-web.md` §5).
- **Legenda:** CONFIRMED_BY_CODE = lido no código (e re-verificado neste documento quando marcado §6); CONFIRMED_BY_TEST = suíte executada; CONFIRMED_IN_RUNTIME / CONFIRMED_IN_DEPLOY = observado em execução/deploy; INFERRED = inferência a partir do código; NOT_VERIFIED = sem verificação possível.

Documentos irmãos desta série: os achados brutos de telas estão em `jornadas-web.md`, os de contexto/prefill em `contexto-inteligencia.md` e os de latência em `performance-fase13.md`. Este documento **organiza a fricção do ponto de vista do usuário** e não repete a catalogação completa deles.

---

## 1. Telas operacionais: objetivo, real/mock, dependência ClickUp, estado degradado, fricção

Recorte: as telas que o time usa no dia a dia. Gates e público completo das 37 rotas estão em `jornadas-web.md` §1.

| Tela | Objetivo | Real vs Mock | Dependência ClickUp | Estado vazio/degradado | Fricção (ESTIMADA) |
|---|---|---|---|---|---|
| `/today` Hoje | Fila pessoal do dia | REAL (`use-today-summary.ts:56-57`) | **Alta e ao vivo**: seção `minhas_tarefas` varre ClickUp sem cache a cada visita (`apps/api/src/clickup/routes.ts:1103-1110`, §6) | Guards de 409 ClickUp (`today/page.tsx:31-35`); participantes hardcoded 'Pedro Gabriel'/'Matheus Rial'/'Tami Alves' condicionados ao título exato do evento (`today/page.tsx:106-108`) — CONFIRMED_BY_CODE | ~7,7s de referência para assentar (MEASURED vizinho, ver §4); resquício de demo invisível numa tela de produção |
| `/pipeline` | Quadros Kanban (cliente/tarefas/colaborador/geral) | REAL; importa só tipos de `@/mocks/pipeline` (`pipeline/page.tsx:34-41`) | **Total**: sync-on-open sem cache, drag escreve no ClickUp (`use-pipelines.ts:120-121`) | **Quadro geral da agência não tem caminho de criação na UI nem no POST** (`pipeline/page.tsx:259-263`; API rejeita em `apps/api/src/pipeline/routes.ts:506-514` e trata geral só em `:969-992`) — INFERRED; origem do quadro de produção NOT_VERIFIED | Sync-on-open de segundos a dezenas de segundos (§4); drag sem confirmação visual de que o ClickUp aceitou (INFERRED de `use-pipelines.ts:120-143`) |
| `/tasks` Tarefas | Central de tasks ClickUp (agência/minhas) | REAL (`/clickup/tasks/agency\|me`) | Alta, mas `/agency` passa por cache SWR | **Kanban é READ-ONLY** (`task-kanban-board.tsx`, 77 linhas, zero mutação) — o mesmo objeto que no `/pipeline` aceita drag que escreve. Nada na UI distingue — CONFIRMED_BY_CODE | Usuário aprende por tentativa-e-erro qual quadro escreve; dois Kanbans da mesma tarefa com capacidades diferentes |
| `/inbox` | Conversas WhatsApp com clientes | REAL (`useInboxThreads`), mas **WhatsApp não conectado** (declarado `inbox/page.tsx:95-97`) | Baixa | **Botão "Nova conversa" morto** — sem `onClick`, sem `disabled`, sem tooltip (`inbox/page.tsx:89-91`, §6); **rascunho apagado antes do envio com catch silencioso** (`thread-chat.tsx:63-64`, §6) — falha = mensagem ao cliente perdida sem aviso — CONFIRMED_BY_CODE | ~3 cliques para responder, mas cada envio é uma aposta (sem toast, sem retenção de rascunho) |
| `/clients` + `/clients/[id]` | Carteira + ficha do cliente | REAL, com fallback honesto: campos sem fonte exibem `[CONFIRMAR: ...]` em produção para todo cliente (`demo-client-info.ts:64-73`) | Média (painel de tarefas por lista) | **Duas fichas divergentes para a mesma entidade**: mestre-detalhe tem aba Memória (`clients/page.tsx:421`), a "ficha completa" não tem Memória nem Brand Kit (`clients/[id]/page.tsx:67`); pipeline linka para `/clients?id=` (`pipeline/page.tsx:717`), o resto para `/clients/${id}` — CONFIRMED_BY_CODE | Duas URLs e dois conjuntos de abas a decorar; StatCards e abas **subcontam** além da página de 30 (ver §2 fluxo 5) |
| `/approvals` Aprovações | Fila de tool-calls da IA + decisões de negócio | REAL | Nenhuma | **Página inteira bloqueada para não-master** (`approvals/page.tsx:198-205`, §6) **apesar da decisão de produto documentada** em `nav-items.ts:217-223`: `masterOnly` foi removido da nav justamente porque a fila de negócio (brief, criativo, campanha) é usada por colaborador — CONFIRMED_BY_CODE | Colaborador vê o item no menu e bate numa parede "Acesso restrito" antes de `BusinessApprovalsSection` (`:216`) |
| `/knowledge` vs `/memory` | "Conhecimento" (duas vezes) | `/memory` REAL (`useMemories`); **`/knowledge` 100% fixture** (`SAMPLE_KNOWLEDGE_SOURCES`, `knowledge/page.tsx:7,15,31`, com disclaimer na própria tela) | Nenhuma | Duas telas com o **mesmo rótulo "Conhecimento"** na nav (`nav-items.ts:238` e `:286`, §6), conteúdos diferentes (memórias reais vs vaults mock) — CONFIRMED_BY_CODE | Ambiguidade de rótulo; mitigada porque `/knowledge` está atrás de Configurações → Administração |
| `/demands` Quinzenas | Ciclo quinzenal por cliente | REAL (`useDemands`) | Baixa | Dono da quinzena derivado automaticamente do assignment `account` (`apps/api/src/demands/service.ts:22-29,44`) — ponto positivo: "nunca um palpite" | dados insuficientes: campos e validações do modal de nova quinzena não foram auditados |
| `/midias` | Carteira de tráfego pago | REAL (Meta; Google parcial) | Nenhuma | dados insuficientes para estado vazio/degradado além de "Google parcial" | dados insuficientes |
| `/calendar` | Semana pessoal + agenda da agência | REAL (`useCalendarEvents`) | Nenhuma | **Evento criado pela UI nunca aparece na aba Calendário do cliente**: POST aceita `client_id` (`apps/api/src/calendar/routes.ts:39`), mas `CreateEventModal` não envia o campo (`create-event-modal.tsx:53-63`) — CONFIRMED_BY_CODE | Reunião marcada "some" do ponto de vista da ficha do cliente |

Nota transversal: as 35 telas da nav renderizam com API vazia (`telas-do-sidebar.test.tsx`, 35/35 — CONFIRMED_BY_TEST em `jornadas-web.md` §1), ou seja, estado vazio **existe e renderiza**; o que a suíte não prova é se o estado vazio **orienta** o usuário (dados insuficientes — exigiria inspeção visual).

---

## 2. Fluxo atual vs fluxo proposto — os 5 fluxos mais frequentes

Contagens de cliques/telas são ESTIMADAS (nenhuma fonte mediu interação). "O sistema já sabe" refere-se a dados que já existem em API/banco, mapeados em `contexto-inteligencia.md` §1.

### Fluxo 1 — Criar demanda (quinzena) a partir de mensagem do cliente

**ATUAL (ESTIMADA):** Inbox → ler thread (2 cliques) → sair do Inbox → `/demands` ou ficha do cliente → "Nova quinzena" (`clients/[id]/page.tsx:165-182`) → preencher campos do zero → voltar ao Inbox para responder. **~4 telas, 6-8 cliques.** Não há caminho direto thread → demanda: o painel de contexto do Inbox (`thread-context-panel.tsx`) exibe o cliente da conversa, mas não oferece ação de criar demanda (NOT_VERIFIED se há algum CTA no painel — `jornadas-web.md` não o lista).

**O que o sistema já sabe:** o `clientId` da thread (usado no filtro do painel); o dono da conta via `GET /clients/:id/assignments` (`clients/routes.ts:484-508`), que vira `ownerId` da quinzena automaticamente (`demands/service.ts:44`) — CONFIRMED_BY_CODE.

**PROPOSTO:** botão "Criar quinzena" no painel de contexto da thread → modal já com cliente fixo e owner resolvido → confirmação devolve o usuário à thread. **1 tela, 2-3 cliques, zero campos obrigatórios redigitados.** Depende de dados insuficientes: a lista de campos obrigatórios do modal de quinzena não foi auditada.

### Fluxo 2 — Criar tarefa para um cliente

**ATUAL (ESTIMADA):** `/pipeline` → selecionar quadro do cliente (1 clique) → "Novo cartão" → modal (`pipeline/page.tsx:578-625`): título, descrição, **"Responsável" abre vazio** com select de TODOS os colaboradores, mesmo num quadro de um cliente (`board.clientId`). **~2 telas, 4-5 cliques, 1 campo que o sistema poderia preencher.**

**O que o sistema já sabe:** quem é `account`/`manager` daquele cliente (`/clients/:id/assignments`, `clients/routes.ts:484-508`); para quadro pessoal, o próprio usuário (`useMe`) — CONFIRMED_BY_CODE (`contexto-inteligencia.md` O2).

**PROPOSTO:** mesmo modal com responsáveis do cliente pré-ordenados/pré-selecionados. Zero dado novo — a rota já existe.

### Fluxo 3 — Designer pegar tarefa e entregar

**ATUAL (ESTIMADA):** `/today` (espera de segundos, §4) ou `/tasks` "minhas" → localizar a tarefa → para mudar status, descobrir que o kanban de `/tasks` **não escreve** (`task-kanban-board.tsx` read-only) → ir ao `/pipeline`, quadro de tarefas → drag (escreve no ClickUp, `use-pipelines.ts:120-121`) → para submeter entrega à aprovação de negócio, `/approvals` devolve "Acesso restrito" para não-master (`approvals/page.tsx:198-205`). **~4 telas, 7-10 cliques, 1 parede, 1 armadilha (kanban read-only).**

**O que o sistema já sabe:** o vínculo `users.clickupEmail` é resolvido sozinho no primeiro uso (`apps/api/src/lib/vinculo-clickup.ts:15-29`, wired em `auth/routes.ts:141`, `clickup/routes.ts:1055`, `pipeline/routes.ts:228`) — o "quais tarefas são minhas" já não exige configuração, salvo casamento ambíguo (`LinkClickUpEmailPrompt`, `tasks/page.tsx:32-81`) — CONFIRMED_BY_CODE.

**PROPOSTO:** (a) cumprir a decisão de `nav-items.ts:217-223` — renderizar `BusinessApprovalsSection` para todos e gatear só a seção de tool-calls (o hook `useToolCalls(isMaster)` já recebe o flag; mudança de ~10 linhas segundo `jornadas-web.md` §4.1); (b) unificar a semântica dos dois Kanbans — ou `/tasks` ganha o drag-que-escreve, ou a troca lista/kanban declara "somente leitura".

### Fluxo 4 — Gestor caçar atrasos

**ATUAL (ESTIMADA):** `/tasks` visão agência (já passa por cache SWR, `clickup/routes.ts:1020` + `:411-470`) **ou** `/pipeline` quadro geral — que paga sync-on-open ao vivo sobre **1.239 tarefas abertas** (comentário de 15/10/2026 em `apps/api/src/pipeline/routes.ts:320`, MEASURED-como-contagem) e baixa o GET `/pipelines` completo (~0,5-0,9 MB INFERRED, §4) **ou** ficha do cliente → aba de tarefas por status (`/clients/:id/overview`, `clients/routes.ts:900-977`, paginado com `counts_truncated`). **~3 telas candidatas, nenhuma agrega "vencidas".**

**O que o sistema já sabe:** status cru de cada tarefa (é o que agrupa o kanban de `/tasks`); datas de entrega trafegam nos payloads de task. **dados insuficientes:** nenhuma das três fontes verificou se existe filtro/ordenação por `due_date` vencido em alguma superfície — NOT_VERIFIED.

**PROPOSTO:** um recorte "atrasadas" derivado de dado já trafegado (due_date < hoje, status != fechado), na superfície que o gestor já abre — e invalidação de `['pipelines']` via WS para o quadro geral refletir o webhook sem sync manual (§4, lacuna inversa).

### Fluxo 5 — Acompanhar um cliente

**ATUAL (ESTIMADA):** `/clients` → ficha mestre-detalhe (8 abas) **ou** `/clients/[id]` "ficha completa" — conjuntos de abas **diferentes** (Memória e Brand Kit só na primeira; `contexto-inteligencia.md` P3). Na ficha completa: StatCard "Conversas" e abas Conversas/Aprovações **subcontam** qualquer coisa fora das 30 mais recentes — a tela busca `useInboxThreads({})` e `useApprovals({})` sem filtro e filtra por `clientId` no navegador (`clients/[id]/page.tsx:96-97,100-101`; rotas paginam 30: `communications/routes.ts:26`, `use-approvals.ts:7-8`) — CONFIRMED_BY_CODE. Reuniões marcadas pela UI nunca aparecem na aba Calendário (falta `client_id` no modal, §1). `cost_summary` da workspace soma só as 20 execuções mais recentes sem aviso no payload (`clients/routes.ts:402-417`). **~2 telas divergentes, números que mentem baixo, eventos que somem.**

**O que o sistema já sabe:** `clientId` em todos esses contextos — as rotas é que não aceitam o filtro (O5 de `contexto-inteligencia.md`: adicionar `client_id` a GET `/inbox/threads` e `/approvals`); `ultima_atividade` e `pedidos_30d` já saem no GET `/clients` (`clients/routes.ts:169-185`) e poderiam alimentar um sinal "cliente parado há N dias" sem chamada nova (O6).

**PROPOSTO:** uma ficha só (ou abas idênticas nas duas), filtro server-side por `client_id`, `client_id` no `CreateEventModal`, e CTA "Gerar peça" → `/studio?client=<id>` (o `BrandKitSummary` do Studio já reage a clientId, `job-form.tsx:382-393` / `studio-content.tsx:125` — hoje o deep link só entende `?asset=`).

---

## 3. Carga cognitiva: decorar vs saber

O que o usuário precisa **decorar** hoje (tudo CONFIRMED_BY_CODE):

| O usuário precisa decorar… | Evidência | O sistema já saberia… |
|---|---|---|
| Qual dos dois "Conhecimento" é o real (`/memory`) e qual é fixture (`/knowledge`) | `nav-items.ts:238` vs `:286` | — (defeito de rótulo, não de dado) |
| Qual Kanban escreve (`/pipeline`) e qual é só leitura (`/tasks`) | `task-kanban-board.tsx` (zero mutação) vs `use-pipelines.ts:120-121` | — (defeito de affordance) |
| Qual das duas fichas de cliente tem Memória/Brand Kit | `clients/page.tsx:421` vs `clients/[id]/page.tsx:67` | — (defeito de estrutura) |
| Grafia exata dos responsáveis na **edição** de cartão (texto livre) — "Matheus" vs "Matheus Rial" quebra agrupamento | `pipeline/page.tsx:749` vs select na criação `:621-624` | Lista de colaboradores (`useCollaborators` já importado na página) |
| Quem é responsável por cada cliente ao criar cartão | `pipeline/page.tsx:578-625` (select abre vazio) | `GET /clients/:id/assignments` (`clients/routes.ts:484-508`) |
| E-mail do colega ao conceder acesso a cliente (digitação livre, 404 por typo) | `grant-access-form.tsx:24-31` | Membros da org via `useCollaborators` (backend valida membership) |
| Nomes de status/listas do ClickUp no estado cru (agrupamento do kanban de `/tasks` é por status cru) | `task-kanban-board.tsx` | Mapeamento lista↔cliente já é dado (`clients.clickup_list_id`, `schema/clients.ts:23`) |
| Que reunião criada pela tela não vai para a ficha do cliente | `create-event-modal.tsx:53-63` | `client_id` já é aceito pelo POST (`calendar/routes.ts:39`) |

Ponto positivo a registrar: o vínculo usuário↔ClickUp, antes uma regra que o usuário precisava conhecer (configurar e-mail em Settings), hoje é **resolvido pelo sistema** no primeiro uso (`vinculo-clickup.ts:15-29`), com prompt manual só na exceção ambígua — CONFIRMED_BY_CODE. É o modelo que os demais itens da tabela deveriam seguir.

---

## 4. Latência percebida

Todas as latências são MEASURED-de-baselines-anteriores ou INFERRED por contagem de round-trips; **não há baseline de latência HTTP por rota** (`performance-fase13.md` §4). Detalhamento completo em `performance-fase13.md` §2.

| Superfície | Custo | Evidência | Etiqueta |
|---|---|---|---|
| `/today` | Toda visita paga varredura ClickUp **ao vivo**: `/clickup/tasks/me` chama `queryOperationTasks` direto, sem o cache SWR que `/clickup/tasks/agency` usa (assimetria no mesmo arquivo) | `apps/api/src/clickup/routes.ts:1103-1110` vs `:1020` + `:411-470`; ambas são seções do `/today/summary` (`today/routes.ts:70-71`) — §6 | CONFIRMED_BY_CODE; referência MEASURED vizinha: 7,71s mediana para a consulta de agência **sem** cache (08/10, `clickup/routes.ts:388-391`); histórico da tela: 8-11s com 13-15 req, 13/10 (`today/routes.ts:12-14`) |
| `/pipeline` (abertura) | Sync-on-open dispara `sincronizar-clientes`/`sincronizar-tarefas` **sem nenhum cache**, uma vez por quadro por visita; quadro geral varre todas as listas (1.239 tarefas abertas em 15/10) | `pipeline/page.tsx:977-984`; `pipeline/routes.ts:223-242` (pessoal), `:322-334` (geral, comentário :320) | CONFIRMED_BY_CODE; custo INFERRED em segundos a dezenas de segundos |
| `/pipeline` (drag) | 2-3 chamadas ClickUp **sequenciais** antes do write local em coluna-categoria sem `clickupStatus`; fallback de `estagiosDaLista` baixa a lista INTEIRA (com fechadas e subtarefas) se o endpoint de status falhar; depois, `onSettled` invalida `['pipelines']` → GET full | `pipeline/routes.ts:1244-1280`, `:209-214`; `use-pipelines.ts:143` | CONFIRMED_BY_CODE (caminho); INFERRED (frequência do fallback). Mitigação real: UI otimista com rollback (`use-pipelines.ts:125-142`) — o gesto não trava, mas toast e refetch esperam a cadeia |
| GET `/pipelines` | Sem paginação nem recorte: todos os boards + todos os cartões; ~0,5-0,9 MB por resposta com o quadro geral cheio, baixado na abertura, após cada drag, após cada sync e após cada mutação | `pipeline/routes.ts:378-409` | CONFIRMED_BY_CODE (shape); INFERRED (tamanho, ~400-700 bytes/cartão) |
| Sync de tarefas (writes) | N+1 serial: um `db.update` por tarefa; com RTT Supabase ~130ms: 50 tarefas ≈ 6,5s, 200 ≈ 26s, dentro da requisição que o usuário disparou ao abrir a tela | `pipeline/routes.ts:1111-1128` (também `:1016-1019`, `:918-927`); RTT em `packages/database/src/client.ts:24` | CONFIRMED_BY_CODE; multiplicação INFERRED |
| Web inteiro | **15 hooks de polling ativos** (500ms a 60s; destaque: costs 20s ×4 queries, messages 5s, studio-jobs 500ms/5s enquanto ativo) sobre **pool de 3 conexões** Postgres com piso ~270ms/rota | lista em `performance-fase13.md` §2 P7; pool em `client.ts:16` | CONFIRMED_BY_CODE (intervalos); INFERRED (impacto agregado) |
| Lacuna inversa WS | O WS já invalida messages/notifications/conversations/executions/costs/health/studio/motion/clients-clickup-tasks — mas **`clickup.task_changed` não invalida `['pipelines']`** | `apps/web/src/hooks/use-realtime-events.ts:68-74` — §6 | CONFIRMED_BY_CODE. O quadro aberto não reflete o webhook até o próximo sync manual — é parte do motivo pelo qual o sync-on-open caro existe |

Leitura executiva: as duas telas mais frequentes (`/today`, `/pipeline`) pagam ClickUp ao vivo justamente nos caminhos em que **já existem** dois caches SWR e um webhook de invalidação — o custo não é falta de infraestrutura, é não-uso dela nesses dois caminhos (`performance-fase13.md` §3.1-3.2).

---

## 5. Estados de erro: erros silenciosos e feedback insuficiente

### Erros silenciosos (CONFIRMED_BY_CODE, salvo indicação)

1. **Perda de mensagem ao cliente no Inbox** — `thread-chat.tsx:63-64` (§6): `setDraft('')` **antes** do envio e `catch(() => undefined)` sem toast. Falha do POST = texto perdido em silêncio, na tela de atendimento. O padrão correto já existe no código: toast no catch em `approvals/page.tsx:56-60`. **É o pior defeito da auditoria do ponto de vista do usuário.**
2. **Botão "Nova conversa" morto** — `inbox/page.tsx:89-91` (§6): ação principal visível, sem `onClick`, sem `disabled`, sem tooltip. Falha silenciosa por ausência: o usuário clica e nada acontece, sem feedback de que é intencional.
3. **"Acesso restrito" como parede sem saída** — `approvals/page.tsx:198-205` (§6): o early return não oferece caminho (sem "peça a um master", sem fila visível parcial). Contradiz decisão de produto registrada em `nav-items.ts:217-223`. NOT_VERIFIED se a API também bloqueia colaborador em `approvals/*` — se bloqueia, o defeito é maior que o de tela.
4. **Drag do pipeline sem confirmação de escrita no ClickUp** — o PATCH invalida a query, mas nada na UI diz que o ClickUp aceitou (INFERRED de `use-pipelines.ts:120-143`; o aviso existente em `pipeline/page.tsx:291` é genérico, não por-operação).
5. **Subcontagem silenciosa na ficha do cliente** — StatCards e abas filtram no navegador sobre páginas de 30 (§2 fluxo 5); nenhum aviso de truncamento na UI. O payload de `/clickup/tasks/me` devolve flag `truncated` (`clickup/routes.ts:1112`) e `/clients/:id/overview` devolve `counts_truncated` — **dados insuficientes**: nenhuma fonte verificou se a UI renderiza esses flags.
6. **`cost_summary` engana a partir da 21ª execução** — soma só as 20 mais recentes, `execution_count` é tamanho de página, sem aviso no payload (`clients/routes.ts:402-417`); decisão de corrigir adiada desde 09/10/2026.
7. **Fallback pesado invisível no drag** — falha transitória do endpoint de status de lista transforma um drag em varredura de lista inteira (`pipeline/routes.ts:209-214`), sem sinalização ao usuário de que a operação ficou lenta por degradação.
8. **Modo mock como default** — se `NEXT_PUBLIC_API_MODE` faltar, o app sobe servindo MSW (`msw-provider.tsx:5`, `lib/demo-mode.ts:15`), com `console.error` alto (`msw-provider.tsx:94-99`) e banner, mas **sobe**. Vigente desde `DESIGUAL_OS_RELEASE_READINESS_AUDIT.md:248`. NOT_VERIFIED em qual modo a Vercel está rodando — é o ponto mais importante a confirmar fora desta auditoria (`jornadas-web.md` §5).

### Feedback adequado já existente (para não redesenhar o que funciona)

- Guards de 409 ClickUp na tela Hoje (`today/page.tsx:31-35`) e `LinkClickUpEmailPrompt` na exceção de vínculo ambíguo (`tasks/page.tsx:32-81`).
- `/today/summary` com falha parcial que nunca derruba a tela inteira (`Promise.allSettled`, `today/routes.ts:83-107`).
- UI otimista com rollback no drag do pipeline (`use-pipelines.ts:125-142`).
- Fallback honesto `[CONFIRMAR: ...]` nos campos sem fonte da ficha (`demo-client-info.ts:64-73`) — honesto, mas permanente: em produção, todo cliente exibe placeholders (§1).
- WhatsApp não-conectado declarado em texto em vez de número fictício (`inbox/page.tsx:95-97`).

---

## 6. Re-verificações pontuais deste documento (16/10/2026)

| Afirmação | Resultado |
|---|---|
| `/approvals` bloqueia não-master antes de `BusinessApprovalsSection`, contra a decisão em `nav-items.ts` | **Confirmado sem drift**: early return em `approvals/page.tsx:198-205`, seção em `:216`; comentário de decisão em `nav-items.ts:217-223` (`masterOnly` removido intencionalmente) |
| Inbox apaga rascunho antes do envio e engole o erro; botão "Nova conversa" sem `onClick` | **Confirmado sem drift**: `thread-chat.tsx:63-64`; `inbox/page.tsx:89-91` |
| `/clickup/tasks/me` não usa o cache SWR que `/clickup/tasks/agency` usa | **Confirmado sem drift**: chamada direta a `queryOperationTasks` em `clickup/routes.ts:1103-1110` |
| WS não invalida `['pipelines']` no evento `clickup.task_changed` | **Confirmado sem drift**: `use-realtime-events.ts:68-74` invalida apenas `['clients', clientId, 'clickup-tasks']`; `['pipelines']` ausente do switch inteiro |

## 7. Limitações

- Fricção em cliques/telas é **ESTIMADA**: nenhuma fonte rodou o frontend nem mediu interação real.
- Latências são MEASURED-de-baselines-antigos ou INFERRED; não há baseline de latência HTTP por rota (`performance-fase13.md` §4).
- Não verificado em produção: modo da Vercel (mock vs live), existência/origem do quadro geral, se a API também bloqueia colaborador em `approvals/*`, contagem real de cartões no banco, tamanho real do payload de GET `/pipelines`.
- Campos obrigatórios do modal de nova quinzena e existência de filtro de tarefas vencidas: dados insuficientes (marcados nos fluxos 1 e 4).
