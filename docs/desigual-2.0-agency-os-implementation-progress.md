# Desigual OS 2.0 → Agency Operating System — Progress Log

Registro contínuo por fase, per master prompt §117. Nunca substitui histórico
anterior — só acrescenta.

---

## FASE P0-A/B/C — 06/10/2026

### STATUS

**P0 DEVELOPMENT GATE: READY**

**MULTI-TENANT RELEASE GATE: PARTIAL**

Motivo: os caminhos agregados de ClickUp (`bento-action-guard.ts`, 11 call
sites, e as rotas de `clickup/routes.ts`/`clients/routes.ts` que consultam
múltiplos clientes de uma vez — 8 call sites de `resolveClickUpAccess`
no total) ainda usam uma credencial única para consultar clientes que
podem pertencer a múltiplas organizações. Isso não bloqueia P1 (nenhuma
feature de P1 depende desses caminhos). **Bloqueia release multi-tenant**
até o redesenho descrito em §19 do prompt master (resolver provider POR
organização, consultar cada um, mesclar preservando proveniência) ser
implementado e testado com 2 tenants reais em ClickUp. Revisitar
obrigatoriamente antes do FINAL RELEASE GATE — não é dívida que se carrega
silenciosamente.

### IMPLEMENTADO

**P0-A — security/tenant isolation, itens restantes do inventário:**
- `GET /clickup/members` (`apps/api/src/clickup/routes.ts`) — lia `CLICKUP_API_KEY`/
  `CLICKUP_TEAM_ID` globais sem checar `organization_connectors` da empresa de
  trabalho do chamador. Agora resolve via `resolveClickUpCredentials`
  (canônico, packages/tool-gateway) e só cai pro fallback global quando a
  empresa não tem conector próprio; conector quebrado → 409, nunca o
  workspace de outra empresa.
- `POST /nodes/:node_id/command` (`apps/api/src/nodes/routes.ts`) — tinha
  `nodes:write` mas não `exigirProvedor()`, ao contrário do `GET /nodes`
  irmão. Corrigido (1 linha).
- **Admin Audit Completeness**: as 4 mutações de `admin/routes.ts`
  (role/status/rename/delete) agora gravam `audit_logs` usando o helper
  canônico `auditarAcao` (estendido com `resourceType`/`resourceId`/
  `oldValue`/`newValue` — colunas que já existiam no schema e não eram
  usadas). `rename` e `delete` não gravavam NENHUM audit log antes desta
  fase.
- **Authorization Denial Audit**: tentativa de mutação cross-tenant numa
  rota privilegiada (as 4 de admin) agora grava `authorization.denied` em
  `audit_logs`, sem flood (só esta rota estreita, não permissões rotineiras).

**P0-B — TaskProvider single authority:**
- `apps/mcp/src/server.ts`: `montarProviders(organizationId)` ignorava o
  próprio parâmetro e lia env global. Corrigido via
  `resolveClickUpCredentials`; conector quebrado agora responde 503 em vez
  de derrubar o processo MCP inteiro (não havia try/catch nem handler de
  `unhandledRejection` — um throw aqui crashava o servidor pra TODAS as
  empresas, não só a afetada).
- Novo export canônico `resolveClickUpCredentials` em
  `packages/tool-gateway/src/task-provider-resolver.ts` — credencial crua
  (não um `TaskProvider` montado), pra código que ainda não fala a
  interface `TaskProvider` (listar membros do workspace, por ora).
- **Conscientemente NÃO migrados nesta fase** (ver seção própria abaixo):
  `apps/worker/src/processors/bento-action-guard.ts` (11 call sites) e as
  rotas agregadas de `apps/api/src/clickup/routes.ts`
  (`tasks/agency`/`tasks/me`/comments) e `apps/api/src/clients/routes.ts`
  (3 call sites de `resolveClickUpAccess`).

**P0-C — Client Assignment:**
- `client_users` ganhou coluna `responsibility` (nullable, texto livre
  validado por `CLIENT_RESPONSIBILITIES` em `packages/types`) e a unique
  constraint passou de `(client_id, user_id)` para
  `(client_id, user_id, responsibility)` — permite múltiplas
  responsabilidades da mesma pessoa no mesmo cliente, preserva linhas
  antigas (`responsibility = NULL` = "não definida", nunca inferida).
- Novas rotas: `GET/PUT/DELETE /clients/:id/assignments` (responsáveis por
  cliente) e `GET /team/members/:id/assignments` (clientes de um
  colaborador) — todas com auditoria (`audit_logs`) e evento
  (`operational_events`, `source: 'system'`).
- Corrigido de quebra: `POST /clients/:id/access` (rota pré-existente de
  concessão de acesso) usava `onConflictDoUpdate` com o alvo de 2 colunas
  antigo — atualizado pro alvo de 3 colunas, senão quebraria assim que a
  migration 0056 rodasse.

### REUTILIZADO DO SISTEMA ATUAL

- `requireTenant`/`clientBelongsToTenant` (tenant-context.ts) — reaproveitado
  sem alteração pelas novas rotas de assignment.
- `auditarAcao` (lib/auditoria.ts) — estendido (campos opcionais novos),
  não substituído.
- `recorteDePessoasVisiveis` (lib/escopo-de-organizacao.ts) — reusado tal
  qual em `GET /team/members/:id/assignments`.
- `resolveTaskProvider`/`loadConnectorRows`/`ConnectorConfigError`
  (task-provider-resolver.ts) — a nova `resolveClickUpCredentials` reusa a
  MESMA fonte, não lê `organization_connectors` uma segunda vez.

### MIGRATIONS

- `0056_chief_jack_murdock.sql` — **gerada e revisada, NÃO aplicada.**
  `BLOCKED_DATABASE_TARGET`, com evidência verificada, não inferida:
  - único `DATABASE_URL` configurado (`.env`) aponta pro pooler do Supabase
    (`aws-0-us-east-1.pooler.supabase.com`) — host remoto, não local;
  - o próprio projeto já tem a convenção de segurança pra isto, em código:
    `apps/api/src/automations/tenant-postgres.test.ts` só roda teste de
    integração contra banco real quando `TENANT_TEST_DATABASE_URL` aponta
    pra `127.0.0.1`, e lança erro explícito (`'Tenant integration tests
    require an isolated local PostgreSQL'`) pra qualquer outro host —
    exatamente o critério que este `DATABASE_URL` NÃO satisfaz;
  - `TENANT_TEST_DATABASE_URL` não está definida nesta sessão (confirmado:
    `tenant-postgres.test.ts` roda com os 3 casos `skipped`, não `passed`);
  - auditorias anteriores do próprio repositório (`desigual-2.0-inventario-*`)
    descrevem medições feitas "ao vivo... contra o banco de produção"
    usando este mesmo `DATABASE_URL` — ou seja, há indício direto (não só
    ausência de indício de segurança) de que este é o banco de produção.

  Nenhuma dessas migrations/validações (journal, runtime proof das
  assignments) foi executada. Quando um ambiente comprovadamente seguro
  existir (local, dev ou staging com `TENANT_TEST_DATABASE_URL` ou
  equivalente explícito), rodar: gerar journal, `db:migrate`, validar
  schema, rodar suíte, provar as 3 rotas de assignment com dado real.

### ENDPOINTS NOVOS/ALTERADOS

| Método | Rota | O que mudou |
|---|---|---|
| GET | `/clickup/members` | credencial por organização, fallback documentado |
| POST | `/nodes/:node_id/command` | exige provedor |
| PATCH | `/admin/users/:id/role\|status` | audit completo (old/new/resourceId) |
| PATCH | `/admin/users/:id` | ganhou audit (não tinha) |
| DELETE | `/admin/users/:id` | ganhou audit da própria exclusão |
| GET/PUT/DELETE | `/clients/:id/assignments` | novo |
| GET | `/team/members/:id/assignments` | novo |

### TESTS

Novos/estendidos nesta fase: `admin/routes.test.ts` (15→23),
`clickup/routes.test.ts` (18→22), `nodes/routes.test.ts` (novo, 2),
`clients/assignments.test.ts` (novo, 11), `team/routes.test.ts` (novo, 2),
`task-provider.test.ts` (13→19), `execute-job.test.ts` (slice anterior),
`bento-panorama.test.ts` (slice anterior).

**Contagem exata, suíte completa, rodada ao final desta fase:**

| Pacote | Testes |
|---|---|
| api | 302 passed, 3 skipped |
| auth | 63 passed |
| worker | 1577 passed |
| mcp | 86 passed |
| tool-gateway | 124 passed |
| database | 21 passed |
| types | 32 passed |
| orchestrator | 205 passed |
| router | 110 passed |

Typecheck limpo em: api, mcp, tool-gateway, database, types, worker,
orchestrator, router, context-engine, bento-core, agent-runtime, otto,
otto-motion.

### RUNTIME

NOT RUNTIME VALIDATED. Nenhum ambiente de staging/QA com 2 organizações
reais foi usado nesta sessão — toda prova é de suíte automatizada contra
banco mockado.

### KNOWN LIMITATIONS (P0-B, deliberadamente adiado)

`bento-action-guard.ts` (11 call sites) e as rotas agregadas de
`clickup/routes.ts`/`clients/routes.ts` (`resolveClickUpAccess`, 8 call
sites no total) ainda montam credencial sem considerar
`organization_connectors`. **Isto não é um vazamento de dado ativo hoje**
(confirmado: há 1 organização real no banco, e mesmo com uma segunda, o
ClickUp isola por workspace no próprio token — credencial errada produz
"não encontrado", não dado de outro tenant). É uma lacuna de correção
funcional para quando uma segunda empresa configurar ClickUp próprio: ela
receberia resultado vazio nessas views agregadas em vez do dado dela. Não
corrigido nesta fase porque: (1) são rotas que varrem clientes de QUALQUER
organização visível ao usuário numa única credencial — o modelo
"1 organização = 1 credencial" do resolver não encaixa sem redesenho; (2)
`bento-action-guard.ts` é o arquivo mais testado do worker (centenas de
testes), e uma migração malfeita ali tem o maior raio de dano do
inventário inteiro. Registrado para decisão explícita antes de tocar.

### NEXT

P1-A (Communications Domain schema) é o próximo item sem bloqueio externo.
P1-B (WhatsApp adapter) tem decisão de fornecedor pendente — ver stop
condition do plano de execução.

---

## FASE P1-A/B/C — Communications Domain + WhatsApp + Inbox — 06/10/2026

### STATUS: READY (backend + frontend, provider real BLOCKED_EXTERNAL)

### IMPLEMENTADO

**Schema (P1-A):** `contacts`, `conversation_threads`, `thread_messages`
(`packages/database/src/schema/communications.ts`) — deliberadamente
separado de `conversations`/`messages` (chat interno com Bento). 4 enums
novos (`communication_channel`, `conversation_status`, `message_direction`,
`message_delivery_status`), tipos em `packages/types/src/communication.ts`.
`organization_id` direto em toda tabela de alto volume. Idempotência de
webhook via `unique(channel, external_message_id)`.

**Decisão de fornecedor (P1-B) — pesquisada, não escolhida do zero:** o
legado `agentes-desigual`/susy-service já roda **Evolution API** em
produção para WhatsApp/Instagram real (confirmado em
`DESIGUAL_OS_CONTEXT_RECOVERY.md`). Reaproveitada aqui, não re-decidida —
exatamente o que o prompt master pede (§7). `CommunicationProvider`
(`packages/tool-gateway/src/communication-provider.ts`) + adapter Evolution
(`evolution-client.ts`, contrato verificado contra documentação pública
real, não lembrado de memória — `sendText`, webhook `messages.upsert`) +
resolver (`communication-provider-resolver.ts`, reusa
`organization_connectors` via `loadConnectorRows` extraído de
`task-provider-resolver.ts` para um módulo compartilhado,
`organization-connector-store.ts` — refatoração sem mudar comportamento,
19→19 testes do resolver de ClickUp continuam verdes). **Sem fallback
global**: diferente de ClickUp, WhatsApp nunca teve credencial
compartilhada fazendo sentido — sem conector próprio, `null`.

**BLOCKED_EXTERNAL, explícito:** nenhuma credencial de instância Evolution
real existe nesta sessão — o adapter nunca foi testado contra uma
instância de verdade. Código genuinamente funcional (contrato real,
19 testes unitários cobrindo parse de webhook/envio/health/resolver), mas
a CONEXÃO real é prova pendente.

**Domínio + API (P1-A/C):** `apps/api/src/communications/service.ts`
(listThreads/getThread/listMessages/assignThread/sendOutboundMessage —
sempre grava a mensagem mesmo quando o envio falha, nunca silencioso/
findOrCreateContactByPhone/findOrCreateOpenThread/recordInboundMessage
idempotente). Rotas `/inbox/threads*` (autenticadas, `requireTenant`) +
`POST /webhooks/whatsapp` (público, verificado por apikey do payload
contra o conector gravado — mecanismo best-effort documentado, não HMAC
dedicado; revisitar quando houver acesso a uma instância real). Permissão
nova `communications.read/write` (seed.ts). Auditoria em assign; eventos
operacionais em send/receive.

**Extensão do conector (reuso, não nova tabela):** `whatsapp` adicionado a
`CREDENCIAIS_POR_PROVIDER` em `connectors/routes.ts` — mesma tela "conecte
sua integração" já existente, mesma máscara de secret.

**Frontend:** `/inbox` (lista + chat + painel de contexto), reaproveitando
`PageHeader`/`EmptyState`/`Skeleton`/`useCollaborators` já existentes.
Fixture MSW (`src/mocks/inbox.ts` + handlers) — nunca ativa em
`NEXT_PUBLIC_API_MODE=live`. Nav item adicionado.

### MIGRATIONS

`0057_nervous_warlock.sql` — gerada, revisada (puramente aditiva: 4 enums +
3 tabelas + índices), **NÃO aplicada** (mesmo `BLOCKED_DATABASE_TARGET` do
0056 — ver seção P0 acima).

### TESTS

- `packages/tool-gateway`: +15 (parse de webhook, sendText, health,
  resolver — 139 no total, suíte completa verde).
- `apps/api`: +11 (`communications/routes.test.ts` — cross-tenant,
  envio sem/com provider configurado, assign, webhook idempotente/
  apikey-inválida/fromMe/instância-desconhecida) + 1 novo caso em
  `connectors/routes.test.ts` (314→ confirmar contagem abaixo).
- `apps/web`: typecheck limpo; suíte unitária 326/326 (3 asserções de
  `nav-visibility.test.ts` atualizadas para incluir `/inbox` — mudança de
  navegação intencional, não regressão).

**Contagem exata, suíte completa, fim desta fase:**

| Pacote | Testes |
|---|---|
| api | 314 passed, 3 skipped |
| tool-gateway | 139 passed |
| web (unit) | 326 passed |
| web (typecheck) | limpo |

### RUNTIME / BROWSER E2E

**EXECUTED — prova real, não simulada.** Dev server local
(`NEXT_PUBLIC_API_MODE=mock`, override de sessão — o `.env.local` deste
ambiente está configurado para `live` contra `localhost:3001`, que não
está rodando; não alterei esse arquivo), login real via Supabase com a
conta QA (`QA_USER_EMAIL`), Playwright headless dirigindo o navegador:

- `/inbox` renderiza lista com fixture (thread "Maria Cliente", badge
  "NÃO ATRIBUÍDA");
- abrir a thread carrega as mensagens no painel central;
- painel de contexto mostra cliente (Instituto Almada), canal+telefone,
  status, dropdown de responsável (populado com colaboradores reais);
- enviar mensagem nova aparece no thread imediatamente;
- atribuir responsável persiste e remove o badge "não atribuída";
- zero erros de console em qualquer uma das interações.

**Achado operacional durante a prova, não uma falha do meu código:**
`src/proxy.ts` (o middleware renomeado do Next 16) não exclui `.js` sob
`/public` do seu matcher — numa sessão SEM cookie de sessão ainda,
`/mockServiceWorker.js` é redirecionado pro `/login`, o registro do
Service Worker falha, e `MswProvider` (que envolve o app INTEIRO,
inclusive `/login`) trava renderizando `null` para sempre. Isto bloqueia
o modo mock a partir de uma sessão zerada, em QUALQUER tela, não só
`/inbox` — pré-existente, não introduzido por este trabalho. Contornado
para esta prova reaproveitando um cookie de sessão real (login via UI
rodando o servidor no modo `live` padrão deste ambiente, cookie salvo e
reinjetado numa sessão nova do navegador contra o servidor em modo
mock) — não editei `proxy.ts`, `.env.local` nem nenhum arquivo do
projeto para isso. Vale um fix separado (excluir `.js` do matcher, ou
mover `MswProvider` pra dentro do grupo autenticado) — registrado aqui,
não meu a fazer nesta fase.

### KNOWN LIMITATIONS

- Webhook do WhatsApp verificado por `apikey` no corpo do payload, não por
  assinatura HMAC dedicada — mecanismo best-effort até confirmar contra
  uma instância real qual verificação a Evolution API efetivamente aceita.
- `findOrCreateContactByPhone`/`findOrCreateOpenThread` não têm vínculo
  automático cliente↔telefone (nenhum matching por telefone foi pedido
  nesta fase) — contato novo nasce sem `clientId`, alguém assume
  manualmente depois (via atribuição de responsabilidade, P0-C).

### NEXT

P1-D (Demand).

---

## FASE P1-D/E/F/G/I/J — Demand, Brief+Versioning, AI Draft, Brief→Task, Approval Engine, Approval UI — 06/10/2026

### STATUS: READY (backend + frontend, runtime provado em mock; ver achado de navegação abaixo)

### IMPLEMENTADO

**Schema:** `demands` (`packages/database/src/schema/demands.ts`) — elo entre
comunicação e trabalho, nunca depende do adapter de WhatsApp estar pronto
(nasce de `conversation_thread_id` OU manual). `briefs`/`brief_versions`
(`briefs.ts`) — conteúdo NUNCA sobrescrito, toda mudança é linha nova em
`brief_versions`; `approved_version_id` referencia a versão vigente.
`approval_requests` (`approvals.ts`) — genérico por
`resource_type`/`resource_id`, deliberadamente separado da fila de
tool-call da IA (`packages/tool-gateway/src/gateway.ts`), que resolve outro
problema (ação crítica de agente vs. aprovação de peça/briefing).
`database/migrations/0058_secret_omega_sentinel.sql` gerada, aditiva,
**NÃO aplicada** — mesmo `BLOCKED_DATABASE_TARGET` do P0-C, sem banco
provadamente seguro disponível.

**Domain + API:**
- `demands/service.ts`+`routes.ts` — CRUD + `PATCH /demands/:id/status`;
  resolve `ownerId` automaticamente por `client_users.responsibility`
  quando disponível (P0-C), nunca por palpite.
- `briefs/service.ts`+`routes.ts` — `POST /briefs` (manual),
  `POST /demands/:id/draft-brief` (extração por IA a partir das
  `thread_messages` da conversa vinculada — monta um rascunho com
  evidência rastreável, `409` claro se a demanda não tem conversa
  vinculada, nunca inventa conteúdo sem fonte), `POST /briefs/:id/versions`
  (nunca apaga a anterior), `PATCH /briefs/:id/approve-version` (só aceita
  versão do PRÓPRIO brief), `POST /briefs/:id/send-to-production` (exige
  versão aprovada, cria task via `TaskProvider.createTask` — nunca
  ClickUp direto — com `{authorizedForProduction: true}`).
- **Novo nesta fase:** `GET /demands/:id/briefs` — a tela de detalhe da
  demanda não tinha como achar o brief dela (schema não tem FK
  `demand → brief`, de propósito: uma demanda pode ter mais de uma
  tentativa de brief). `listBriefsByDemand` já existia em
  `briefs/service.ts` e não estava exposta por nenhuma rota; exposta
  agora, testada (2 casos novos, incluindo "nunca devolve brief de outra
  demanda").
- `approvals/service.ts`+`routes.ts` — `createApprovalRequest`,
  `listApprovals` (filtros `status`/`mine`/`requestedByMe`),
  `resolveApproval` **atômico** (`UPDATE ... WHERE resolved_at IS NULL`,
  mesmo padrão de `approveToolCall`; dois aprovadores simultâneos — só um
  vence, o outro recebe 409, nunca um 500 nem dupla resolução).

**Frontend (premium, não adiado pra depois):**
- `/demands` — lista com filtro por status, estados de carregamento/vazio/
  erro reais (sem dado inventado), abre `/demands/:id`.
- `/demands/:id` — ficha da demanda (status/prioridade/origem/prazo) +
  seção Briefing (gerar rascunho da conversa OU escrever manualmente,
  versões com conteúdo completo, aprovar versão, nunca esconde versão
  anterior) + seção Produção (aparece só quando há versão aprovada; mostra
  a task criada quando enviado) + seção Aprovação (pedir aprovação,
  resolver — aprovar/pedir ajustes/rejeitar — mostra o resultado e o
  comentário quando houver).
- Botão **"Criar demanda"** no painel de contexto do Inbox
  (`thread-context-panel.tsx`) — fecha o elo CONVERSA→DEMANDA que o
  prompt master exige ficar visível desde P1, não só no P3. Desabilitado
  com tooltip quando a conversa não tem cliente vinculado (nunca cria
  demanda órfã).
- `/approvals` — **duas filas na mesma tela, nunca misturadas:** a fila de
  tool-call da IA (já existia, só master) e a nova fila de aprovação de
  recurso de negócio (brief/peça/campanha — qualquer colaborador com
  `approvals:read/write`, que é o papel padrão desde o `seed.ts` do P1-A).
  `masterOnly` saiu do item de navegação porque escondia a segunda fila de
  quem precisa aprovar um briefing — item mudou de seção `interno` pra
  `dia`, e item `/demands` novo entrou ao lado de Inbox.
- Hooks novos: `use-demands.ts`, `use-briefs.ts` (+`useBriefsByDemand`,
  `useCreateBrief`), `use-approvals.ts` (+`useCreateApprovalRequest`).
  Mocks: `mocks/demands.ts` (1 fixture demanda), handlers MSW completos
  para todo o fluxo.

**Bug real encontrado e corrigido durante esta fase (não um achado
cosmético):** `useDraftBriefFromDemand`/`useCreateBrief` chamavam
`queryClient.setQueryData(['brief', id], brief)` com a resposta CRUA da
mutação (`{...brief, draft_version}`), que tem formato DIFERENTE do que
`useBrief` espera (`{...brief, versions: [...]}`). Isso deixava a tela de
detalhe do brief mostrando zero versões até um refetch incerto. Corrigido
trocando `setQueryData` por `invalidateQueries(['brief', id])` — a tela
busca a forma certa sempre, nunca um cache poluído com formato errado.
Encontrado só porque rodei o fluxo de verdade no navegador, não só
typecheck/teste unitário — exatamente o motivo da regra de "nunca READY
só com backend".

### TESTES

| Pacote | Testes |
|---|---|
| api | 336 passed, 10 skipped (3 `tenant-postgres` + 7 `meta-accounts`, não
desta fase) |
| tool-gateway | 139 passed |
| web (unit) | 326 passed |
| web (typecheck) | limpo |

`briefs/routes.test.ts`: 8 → 10 testes (`GET /demands/:id/briefs` com e
sem brief, e isolamento entre demandas).
`nav-visibility.test.ts`: 3 arrays de hrefs esperados atualizados para
incluir `/demands` e a nova posição de `/approvals` — mudança de
navegação intencional, registrada e testada, não regressão silenciosa.

### RUNTIME / BROWSER E2E

**EXECUTADO — prova real, Playwright dirigindo Chromium, mesma técnica de
cookie-reuse do P1-A/C** (login real via Supabase com a conta QA contra o
servidor em modo `live` padrão deste ambiente, cookie salvo, reinjetado
numa sessão nova do navegador contra o servidor reiniciado com
`NEXT_PUBLIC_API_MODE=mock`):

- `/demands` renderiza a fixture ("Campanha de lançamento — outubro");
- abrir a demanda mostra cliente, status, prioridade, origem, "pedida há
  X";
- "Gerar rascunho a partir da conversa" cria a versão 1 e ela aparece
  com o conteúdo completo;
- "Aprovar esta versão" marca a versão como aprovada (confirmado visual:
  tag "· aprovada");
- "Enviar para produção" mostra a task criada (`clickup-mock-brief-mock-2`
  no `clickup`);
- "Pedir aprovação deste briefing" abre o estado pendente com os três
  botões de resolução;
- "Aprovar" (aprovação de negócio) resolve e mostra "Resolvida como
  Aprovada";
- zero erro de console em qualquer uma dessas interações.

**Achado operacional durante a prova — real, não do meu código, e não
pode acontecer em produção:** criar uma demanda a partir do Inbox e
navegar programaticamente para `/demands/:id` com um id NUNCA visitado
antes (`router.push`, sem `<Link>` correspondente pré-renderizado) faz o
App Router do Next cair para uma navegação completa (documento HTML cru
servido, confirmado pelo corpo da resposta — não é um `_rsc` flight
payload) em vez de uma transição client-side. Contra o MOCK, isso reseta
o array em memória que faz as vezes de banco (`mockDemands` etc.),
fazendo o `GET /demands/:id` seguinte devolver 404 — não um bug de
produto, e sim do harness de teste: contra o backend real, a linha já
está persistida no Postgres antes do `router.push`, e uma navegação dura
buscaria os MESMOS dados reais via SSR. Confirmado isolando a variável:
`<Link>` para uma rota já visitada (`demand-1`) faz transição client-side
consistente, toda vez; `router.push` para uma rota NUNCA visitada antes é
o único caso que degrada. Registrado aqui como achado de ambiente, não
corrigido (não é meu a mexer no roteador do Next por causa de uma
limitação do harness de mock) — vale nota para quem construir E2E contra
este app: para ids recém-criados, prefira `<Link>`/aguardar prefetch, ou
teste contra um backend real.

### KNOWN LIMITATIONS

- `listBriefsByDemand` não tem índice único por `(organization_id,
  demand_id)` — uma demanda pode ter mais de um brief se `POST /briefs`
  for chamado duas vezes; a tela usa o primeiro da lista. Comportamento
  correto para o caso real (uma tentativa por demanda), mas não impede
  duplicata por chamada repetida — nenhum cliente da API faz isso hoje.
- `GET /approvals` não filtra por `resourceId` — a tela de detalhe do
  brief busca a lista geral (até 30, paginação futura) e filtra no
  cliente. Funciona para o volume esperado de P1; merece índice/filtro
  dedicado se o volume de aprovações pendentes crescer.

### NEXT

P1-H (Kanban / Fila pessoal de trabalho sobre TaskProvider).

---

## FASE P1-H — Kanban / Fila pessoal de trabalho sobre TaskProvider — 06/10/2026

### STATUS: READY

### IMPLEMENTADO

**Achado antes de construir:** a "Fila pessoal de trabalho sobre
TaskProvider" que o prompt master pede **já existia** —
`apps/web/src/app/(shell)/tasks/page.tsx`, a "Central de Tasks"
(`useAgencyTasks`/`useMyTasks`, `AgencyTaskRow`), com as duas visões
"Todas as tarefas"/"Minhas tarefas", busca, filtro por cliente e por
status, vínculo de e-mail do ClickUp inline. Não refiz o que já estava
certo — duas lacunas reais, as duas fechadas nesta fase:

1. **Invisível para quem mais precisa dela.** `administracao: true`
   escondia `/tasks` em Configurações → Administração — exatamente o
   oposto do que Design/Tráfego (as personas que vivem de "o que eu
   preciso fazer hoje") precisam. `requirePermission('clickup','write')`
   já era liberado pra colaborador desde sempre; só a navegação estava
   fechada. Promovido pra seção `dia`, ao lado de Equipe e Aprovações.
2. **"Kanban" do nome da fase não existia** — só a lista. Adicionado
   `components/tasks/task-kanban-board.tsx`: agrupa as MESMAS tarefas já
   buscadas/filtradas por `status` cru do ClickUp (nunca um enum nosso —
   cada lista do ClickUp define os próprios status; inventar colunas
   padronizadas mostraria coluna vazia pra quem usa nomes diferentes).
   Toggle Lista/Kanban na mesma tela, reaproveitando 100% da busca e dos
   filtros já existentes — sem rota nova, sem fetch duplicado.

**Mock/dev coverage que não existia:** `/clickup/tasks/agency` e
`/clickup/tasks/me` não tinham handler MSW nenhum — a tela, mesmo já
existindo, nunca tinha sido demonstrável em modo mock (só contra o
ClickUp real). Como a mudança desta fase torna a tela visível pra muito
mais gente, corrigido: `mocks/clickup-tasks.ts` (6 tarefas fixture, 4
status diferentes, 2 clientes, 1 sem responsável, 1 atrasada) +
2 handlers novos, incluindo o 409 real quando `clickupEmail` não está
vinculado (mesmo contrato do backend, não inventa sucesso).

### TESTES

`tsc --noEmit` limpo, suíte web 326/326 (sem teste novo dedicado ao
Kanban — a tela não tinha testes unitários antes desta fase e não é
regressão introduzir o componente sem eles; registrado como dívida
pontual, não bloqueia por ser visualização pura sobre dado já validado
pela Central de Tasks existente).

### RUNTIME / BROWSER E2E

**EXECUTADO** — Playwright + reaproveito do cookie de sessão real
(mesma técnica das fases anteriores), modo mock:

- "Tarefas" aparece na navegação principal (antes só em Administração);
- lista mostra as 6 tarefas fixture;
- toggle para Kanban mostra 4 colunas (Para fazer/Em produção/Revisão/
  Concluído) com as tarefas certas em cada uma, atraso e "sem
  responsável" preservados do card original;
- "Minhas tarefas" sem e-mail do ClickUp vinculado mostra o prompt de
  vínculo (409 esperado, não um erro quebrado).

### NEXT

P1-K (Client 360).

---

## FASE P1-K — Client 360, incremento de aba — 06/10/2026

### STATUS: READY (incremento — não é a ficha completa do prompt master)

### IMPLEMENTADO

**Achado antes de construir:** o Client 360 do prompt master (Overview→
Tasks→Team→Conversations→Demands→Briefs→Approvals→History) **já existe
como conceito** — `client-detail-overlay.tsx`, o card de cliente que "sobe
e vira" a ficha inteira, com abas ClickUp (tasks), Visão Geral, Memória,
Conversas (comentários de task do ClickUp — **não** é o Inbox novo, nome
preexistente, não mexi), Studio, Mídia (Meta Ads, entregue por outra
sessão em paralelo nesta mesma tarde) e Acesso. Incremento desta fase,
sem reconstruir o que já funcionava: duas abas novas, as duas 100% sobre
endpoint real já testado em fases anteriores, nenhuma dado inventado.

- **Equipe** (`client-team-panel.tsx`) — `client_users.responsibility`
  (P0-C): quem responde por este cliente (atendimento/tráfego/design/...),
  atribuir e remover, nunca confundido com a aba Acesso (permissão de
  workspace). Tipos (`ClientAssignmentWire`, `CLIENT_RESPONSIBILITIES`) e
  hook (`use-client-assignments.ts`) não existiam no frontend até agora —
  o backend do P0-C nunca tinha ganho tela.
- **Demandas** (`client-demands-panel.tsx`) — lista as demandas deste
  cliente (`useDemands({clientId})`, já existente desde P1-D), link pra
  `/demands/:id` pro resto do fluxo (briefing/aprovação/produção) em vez
  de duplicar aquela tela inteira dentro de uma aba apertada, e um atalho
  pra lançar demanda manual direto daqui.
- Mocks novos: `mocks/client-assignments.ts` (2 atribuições fixture) +
  handlers `GET/PUT/DELETE /clients/:id/assignments`.

**Decisão explícita de escopo, registrada para não virar dívida
silenciosa:** Briefs, Aprovações e Histórico como abas PRÓPRIAS do
Client 360 **não foram feitos nesta fase** — hoje alcançáveis a partir da
aba Demandas (que linka pra `/demands/:id`, onde brief e aprovação já
vivem por completo) e da tela `/approvals` separada. "Evoluir aba a aba"
é a instrução do prompt master; forçar 3 abas a mais, finas, só pra bater
a lista completa de uma vez seria o oposto do espírito da regra.

**Risco verificado e aceito conscientemente:** `/clients/:id/assignments`
depende da migration 0056 (`BLOCKED_DATABASE_TARGET`, não aplicada) — a
MESMA situação de risco de TODA feature construída nesta sessão a partir
de P1-A (communications/demands/briefs/approvals também dependem de
migrations não aplicadas). Não é risco novo introduzido por esta aba;
é o risco já aceito e documentado do P1 inteiro, revisitado aqui só pra
não ficar implícito.

### TESTES

`tsc --noEmit` limpo, suíte web 326/326 (painéis novos sem teste unitário
dedicado — mesma nota do P1-H: visualização sobre dado já validado pelos
endpoints que os alimentam).

### RUNTIME / BROWSER E2E

**EXECUTADO** — Playwright + cookie de sessão real, modo mock: abrir o
card "Instituto Almada" em `/clients`, abrir aba Equipe (mostra Beatriz
Souza · atendimento, Rafael Lima · design), abrir aba Demandas (mostra a
fixture "Campanha de lançamento — outubro"), zero erro de console.

### NEXT

P1-L (Today).

---

## FASE P1-L — Today ("Hoje") — 06/10/2026

### STATUS: READY

### IMPLEMENTADO

`/today` — responde "o que eu preciso fazer agora", nunca "como está o
sistema" (essa pergunta já tem dona: `/` continua sendo o Control Plane,
voltado a quem supervisiona a operação inteira; "Hoje" é pessoal, pra
quem produz). Decisão explícita: **não substitui `/`** — entra como item
novo de navegação, primeiro da lista, porque é a pergunta mais imediata
do dia, mas a home de supervisão continua existindo exatamente como
estava, sem remover nem reposicionar nada dela.

Quatro filas, cada uma sobre um hook que já existe e já é testado em
outra tela — nenhum fetch novo, nenhum número inventado:

- **Minhas tarefas** (`useMyTasks`, de P1-H) — some inteira, sem mostrar
  card quebrado, quando o e-mail do ClickUp ainda não foi vinculado (409
  esperado, não um erro).
- **Conversas atribuídas a você** (`useInboxThreads({assigned:'me'})`, de
  P1-C).
- **Aprovações pendentes** (`useApprovals({status:'pending'})`, de P1-I) —
  nota de escopo: a API tem `mine`/`requestedByMe`, mas `mine` hoje só
  bate aprovação já RESOLVIDA por quem pede (ver `approverId` só é
  setado em `resolveApproval`) — pendente sempre tem `approverId: null`,
  então `mine:true` numa aprovação pendente devolveria vazio, não o que o
  nome promete. Não é bug desta fase (o código do filtro é do P1-I,
  inalterado); usei `status:'pending'` sem filtro de dono, que é o
  comportamento real e verificável, documentado aqui pra quem for
  arrumar o filtro `mine` não descobrir pelo retrabalho.
- **Demandas em briefing** (`useDemands({status:'briefing'})`, de P1-D).

Cada seção tem contagem real, estado de carregamento, estado vazio
(frase específica, nunca "0"), e link "Ver tudo" pra tela completa.

### TESTES

`tsc --noEmit` limpo, suíte web 326/326. `nav-visibility.test.ts`: `/today`
adicionado como primeiro item esperado nas duas listagens reais (barra do
tenant e barra da provedora) — mudança de navegação intencional, testada.

### RUNTIME / BROWSER E2E

**EXECUTADO** — Playwright + cookie de sessão real, modo mock: "Hoje"
aparece primeiro na navegação; conversas atribuídas mostra "João
Paciente · há 3h"; aprovações pendentes mostra o estado vazio correto
("Nenhuma aprovação pendente no momento" — não havia nenhuma pendente na
fixture neste ponto do fluxo); demandas em briefing mostra "Campanha de
lançamento — outubro"; "Minhas tarefas" corretamente ausente (e-mail do
ClickUp não vinculado nesta sessão); zero erro de console além do 409
esperado do ClickUp.

### KNOWN LIMITATIONS

- Grid fixo em 2 colunas: com só 2-3 seções populadas (e.g. ClickUp não
  vinculado), sobra espaço vazio à direita. Cosmético, não um defeito de
  dado — registrado pra um polish futuro, não bloqueia o gate.

### NEXT

Gate de aceitação do P1.

---

## Bento conectado ao core workflow (parte do P1-L/gate) — 06/10/2026

### STATUS: READY (leitura; escrita adiada, registrada abaixo)

### IMPLEMENTADO

`apps/mcp/src/tools/demand-engine.ts`, 3 tools novas, registradas em
`server.ts` ao lado das demais:

- `get_demands` — o que foi pedido e em que pé está, por cliente/status.
- `get_demand_brief_status` — status do briefing de UMA demanda (versões,
  aprovação, se já virou task).
- `get_pending_business_approvals` — fila de aprovação de negócio
  pendente (brief/peça/campanha).

**Cuidado de nome deliberado:** `get_approvals` já existe (v2.ts) e é
heurística de TEXTO sobre status de task do ClickUp — outro dado, outra
tabela. `get_pending_business_approvals` tem nome e descrição que dizem
explicitamente a diferença, pra não repetir a confusão que a tela já
tinha evitado (duas filas, nunca misturadas).

Mesmo molde de toda tool do MCP (`registrarTool`/kit.ts): porta de scope
antes do corpo (`tasks.read`, reaproveitado — já cobre leitura
operacional em todo papel, criar scope novo pra 3 tools de leitura seria
estrutura antes de precisar), telemetria em toda chamada, erro sem stack.
`ctx.principal.organizationId` em toda query — nenhuma tool lê
atravessando organização.

**Adiado conscientemente, não esquecido:** criar task a partir de brief
aprovado e resolver aprovação pelo chat (`approve_business_approval`,
`send_brief_to_production`) — as duas ações de ESCRITA que o prompt
master pede. "Progressivamente" é a palavra do próprio prompt; entregar
só leitura nesta rodada reduz a superfície de uma ação irreversível (criar
task real no ClickUp, resolver aprovação em nome de alguém) vinda de um
agente, antes de testar o lado de leitura em uso real. Fica como
KNOWN LIMITATION explícita abaixo, não placeholder silencioso.

### TESTES

`tsc --noEmit` limpo (`@desigual-os/mcp`), suíte MCP inteira 87/87 sem
regressão. **Sem teste unitário dedicado às 3 tools novas** — mesma
situação de TODA tool de domínio já existente neste arquivo (`v1.ts`,
`v2.ts`, `identity-clients.ts`, `tasks.ts`, `operation.ts`): zero delas
tem teste próprio hoje, só o framework (`kit.ts`, `telemetria.ts`,
auth, invariantes de arquitetura) é testado. Segui a convenção real do
código em vez de inventar um padrão novo só para este arquivo — registrado
aqui para não virar dívida silenciosa, não escondido atrás de "testado".

### RUNTIME

**NÃO EXECUTADO contra um servidor MCP real nesta fase** — mesma
decisão de escopo que as tools-irmãs (nenhuma delas tem prova de
navegador/MCP real neste repositório hoje); exigiria handshake OAuth
completo, fora do que as fases anteriores fizeram para `v1`/`v2`. `tsc`
limpo + suíte verde é a mesma barra que toda tool deste arquivo já
passa antes de ir ao ar.

### KNOWN LIMITATIONS

- Sem ação de escrita (criar task, resolver aprovação) via Bento ainda.
- Sem teste unitário dedicado (consistente com o resto do arquivo, não
  consistente com o padrão do resto do P1, que teve teste em toda rota
  HTTP nova).

---

## GATE DE ACEITAÇÃO — P1 — 06/10/2026

### VERDICT: **P1 READY**

### Evidência, item por item do prompt master

| Elo da cadeia | Onde vive | Prova real |
|---|---|---|
| CLIENTE | `/clients` (pré-existente) | — |
| CONVERSA | `/inbox` (P1-A/C) | Playwright, zero erro de console |
| DEMANDA | `/demands`, botão "Criar demanda" no Inbox e no Client 360 (P1-D, P1-K) | Playwright, fluxo completo |
| BRIEFING | `/demands/:id`, rascunho por IA ou manual, versionamento (P1-E/F) | Playwright |
| TASK | `send-to-production` via `TaskProvider` (P1-G) | Playwright (task `clickup-mock-brief-mock-2` criada) |
| PRODUÇÃO | `/tasks`, lista e Kanban sobre o mesmo `TaskProvider` (P1-H) | Playwright |
| APROVAÇÃO | `/approvals`, fila de negócio ao lado da fila de IA (P1-I/J) | Playwright, pedir+resolver |
| HISTÓRICO | `/activity` → `operational_events` — **achado, não construído**: todo evento novo (`demand.created`, `brief.*`, `approval.*`, `client.assignment_set`) já aparece na timeline existente, com `summary` real (nunca o nome técnico cru) | Verificado por leitura de código (`apresentarAtividade`'s `default` usa `e.summary`, que todo `recordOperationalEvent` desta fase preenche) — não exercitado no navegador nesta rodada |
| BRAIN/CONHECIMENTO | `/memory` (provedora) e aba Memória do Client 360 — infraestrutura pré-existente do P0, não um entregável desta fase | — |
| BENTO CONECTADO | 3 tools MCP novas de leitura (`get_demands`, `get_demand_brief_status`, `get_pending_business_approvals`) | `tsc`+suíte verde, sem prova de servidor real (ver seção acima) |

### Por que READY, com que ressalvas

1. **Todo o frontend de P1 foi verificado em navegador real**, não só
   tipo/teste unitário — a régua que o prompt master pediu
   ("nenhuma feature pronta só com backend") foi seguida em P1-A até
   P1-L, com Playwright + reaproveito de cookie de sessão real em cada
   fase, screenshots e zero erro de console registrados.
2. **Nenhuma migration foi aplicada** (`0056` a `0058`, todas aditivas,
   todas `BLOCKED_DATABASE_TARGET`) — o P1 inteiro roda contra o mock no
   navegador porque não há prova de que o único `DATABASE_URL` configurado
   é ambiente seguro. Isto significa que, em modo `live` HOJE, contra o
   banco real, TODA feature de P1 (communications/demands/briefs/
   approvals/client_users.responsibility) falharia em runtime com erro de
   coluna/tabela inexistente. Não é um defeito de código — é a mesma
   cautela que bloqueou a migration desde o P0, mantida consistente.
   **Isto não impede o P1 de ser READY como entrega de desenvolvimento**
   (a instrução explícita do usuário foi "isso não bloqueia P1"), mas é
   a condição que precisa ser resolvida (banco seguro identificado,
   migrations aplicadas e testadas em runtime real) antes de qualquer
   uso por pessoas de verdade, mock ou não.
3. **Bento só lê, ainda não age** no core workflow novo — registrado como
   KNOWN LIMITATION, não bloqueia P1 (o prompt master pede conexão
   "progressiva").
4. **Dívida de teste unitário em 3 lugares**, todas documentadas no lugar:
   Kanban de tarefas (P1-H), painéis novos do Client 360 (P1-K) e as 3
   tools MCP novas — nenhuma delas por falta de atenção, todas por seguir
   convenção real já estabelecida no código (visualização sobre dado já
   testado, ou arquivo de tool de domínio que nunca teve teste próprio).

### MULTI-TENANT RELEASE GATE

Continua **PARTIAL**, sem mudança nesta fase — os 8 caminhos agregados
de ClickUp (P0) seguem sem o redesenho multi-org, e **o P1 não piorou
nem melhorou essa situação** (nenhuma feature nova depende de consulta
agregada multi-organização).

### STOP CONDITION real, não um adiamento por preguiça: P2/P3 não têm especificação disponível

A instrução era continuar automaticamente para P2 e, na sequência, P3,
"onde dependências externas permitirem". Antes de escrever uma única
linha de P2, preciso registrar com a mesma honestidade do resto deste
documento: **o texto detalhado de P2 e P3 do MASTER FULL PRODUCT
IMPLEMENTATION não está disponível nesta sessão.** A conversa foi
resumida (compactação de contexto) antes deste ponto, e o resumo que
sobrou preserva P0 e P1 em detalhe — a instrução de "continuar para P2 se
READY, depois P3" ficou registrada, mas o CONTEÚDO de P2/P3 (que seções,
que entidades, que telas) não ficou.

Inventar 20+ seções de especificação de produto a partir daqui seria
exatamente o que a regra "NÃO DECLARE PRODUTO PRONTO PREMATURAMENTE" e
"não invente dado" existem para impedir — só que aplicado à ESPECIFICAÇÃO
em vez de ao dado de cliente. Escrever "FASE P2-A" com conteúdo
inventado e marcar como entregue seria pior que parar e dizer que não
tenho a informação.

**Achado que torna isto mais que uma lacuna técnica:** durante este
trabalho, outra sessão do Claude Code neste mesmo repositório (mesma
branch) avisou estar executando um prompt mestre diferente, recebido do
mesmo usuário na mesma tarde — "DESIGUAL OS — FINAL PRODUCT REFINEMENT"
— cobrindo Agency Control Center, Client 360 mais completo, Meta
Ads/Google Ads por cliente, Evolution API/WhatsApp, relatórios PDF e
Workspace Builder. Isto se sobrepõe, no espírito, ao que P2/P3 deste
prompt provavelmente cobririam (integrações externas, telas adicionais
do Client 360 como Calendário/Campanhas/Criativo). Continuar a inventar
P2/P3 aqui corre o risco real de duplicar ou contradizer trabalho que já
está sendo feito, de propósito, na outra sessão.

**Decisão:** parar aqui, não por bloqueio técnico, mas porque a próxima
linha de trabalho depende de uma decisão que só o usuário pode tomar —
exatamente o tipo de parada que as instruções do usuário prevêem
("só pare se uma STOP CONDITION real ocorrer"). Perguntei de volta, no
chat, em vez de adivinhar.

**Resolvido, com decisão do usuário:** o usuário respondeu pedindo para
verificar com a outra sessão e usar julgamento. A outra sessão confirmou,
citando seções específicas do próprio prompt ("FINAL PRODUCT
REFINEMENT"): Calendário como aba do Client 360 (§22), drilldown de
Campanha→AdSet→Ad→Creative (§40-41), relatório PDF cross-canal Meta+Google
com insights (§46-51) — e descreveu o próprio prompt como "o estado final
do produto", não uma fatia incremental. **P2/P3 deste documento ficam
formalmente absorvidos pelo trabalho da outra sessão** — não serão
reimplementados aqui, para não duplicar nem contradizer. O que continua
sendo trabalho MEU, sem sobreposição confirmada pela outra sessão: o
redesenho multi-org do ClickUp (abaixo) e a honestidade do veredito final.

---

## RELATÓRIO CONSOLIDADO — fim desta rodada autônoma, 06/10/2026

### VERDICT: **AGENCY OS NOT READY FOR INTERNAL OPERATION**

Não é uma formalidade — é o estado real, com evidência:

1. **Nenhuma migration foi aplicada a nenhum banco.** `0056` (client
   assignment), `0057` (communications), `0058` (demands/briefs/
   approvals) existem como SQL gerado, nunca rodado, porque o único
   `DATABASE_URL` configurado neste ambiente não tem prova de ser
   ambiente seguro (não-produção) — a convenção do próprio repositório
   (`tenant-postgres.test.ts` exige `127.0.0.1`) foi usada como evidência
   objetiva, não inferência. **Isto significa que hoje, em modo `live`,
   contra o banco real: Inbox, Demandas, Briefings, Aprovações de negócio
   e atribuição de responsabilidade por cliente — tudo que foi construído
   do P1-A ao P1-L — erraria em runtime** (coluna/tabela inexistente).
   Todo o trabalho foi verificado contra `NEXT_PUBLIC_API_MODE=mock` em
   navegador real, nunca contra produção.
2. **P2 e P3 não foram executados** — não por recusa, mas porque a
   especificação detalhada não sobreviveu à compactação de contexto desta
   sessão, e inventá-la correria o risco real de contradizer o trabalho
   que uma segunda sessão paralela já está fazendo sob um prompt mestre
   mais recente do mesmo usuário ("FINAL PRODUCT REFINEMENT").
3. **O redesenho multi-org do ClickUp foi feito PARCIALMENTE, depois
   deste relatório ter sido escrito pela primeira vez** (ver seção
   dedicada, mais abaixo neste mesmo documento): os 2 agregados de
   LEITURA mais expostos (`tasks/agency`, `tasks/me` — a Central de
   Tasks/Kanban que ficou visível pra toda a equipe nesta mesma sessão)
   estão redesenhados e testados com 2 tenants reais, exatamente o
   cenário que o prompt master pediu. Sobra 1 agregado de ESCRITA
   (`executeSelectionMutation`, no worker do Bento) — deliberadamente não
   tocado por ser caminho de escrita, em subsistema que esta sessão nunca
   tinha mexido, perto do fim de uma rodada já muito longa. `MULTI-TENANT
   RELEASE GATE: PARTIAL` continua, mas com escopo muito mais preciso do
   que "8 call sites" — ver a seção dedicada para o item exato que falta.
4. **Bento só lê o core workflow novo, ainda não age** (criar task,
   resolver aprovação pelo chat ficaram para uma rodada futura,
   deliberadamente).

### O que ESTÁ pronto, com prova real (não é pouco)

P0 (segurança/tenant/RBAC) e P1 inteiro (Communications/Inbox,
Demand, Brief+versionamento, extração por IA, Brief→Task,
Approval Engine + UI, Kanban/fila pessoal de tarefas, três abas novas no
Client 360, página Hoje, três tools de leitura do Bento) — todos com
schema, migration gerada, domínio, API, autorização, auditoria/evento,
frontend completo (loading/vazio/erro), testes automatizados
(ver contagem exata abaixo) e PROVA EM NAVEGADOR REAL via Playwright +
reaproveito de cookie de sessão autenticada, não só typecheck.

**Contagem de testes, fim desta rodada (já incluindo o redesenho multi-org
do ClickUp, seção abaixo):**

| Pacote | Testes |
|---|---|
| api | 343 passed, 21 skipped (3 `tenant-postgres`, meus, mesmo `BLOCKED_DATABASE_TARGET` de sempre; os outros 18 — `meta-accounts` 7, `google-ads-accounts` 6, `agency-control-center` 5 — são testes de integração contra Postgres real da sessão paralela, não meus, e mudam de contagem a cada vez que rodo porque ela segue commitando em paralelo) |
| mcp | 87 passed |
| tool-gateway | 139 passed |
| web (unit) | 326 passed |
| web (typecheck) | limpo |

---

## REDESENHO MULTI-ORG DO CLICKUP — pré-condição de release, 06/10/2026

### STATUS: PARTIAL → mais preciso, não mais fechado (ver o que ficou de fora, abaixo)

### O que o inventário original dizia, e o que uma investigação dedicada achou

O P0 registrou "8 call sites de `resolveClickUpAccess`" como os caminhos
agregados de risco. Antes de redesenhar, mandei uma investigação (agente
de exploração, somente leitura) mapear os 8 com precisão — e a
caracterização original **não estava certa**: dos 8, só **2 são agregados
de verdade** (consultam clientes de organizações potencialmente
diferentes com UMA credencial). Os outros 6 são rotas de UM cliente só
(`POST/GET .../tasks/:id/comments`, `/attachments`, e as 3 de
`clients/:id/...`) que usam a credencial pessoal/compartilhada de quem
pergunta em vez da credencial da organização DONA daquele cliente — um
bug real, mas de uma classe diferente: como o ClickUp isola por
workspace no próprio token, errar aqui falha como "tarefa não encontrada"
NUM client só, nunca mistura dado de dois clientes. Registrar isso
separado não é suavizar o problema — é não tratar dois bugs de gravidade
diferente como um só.

Além disso, `bento-action-guard.ts` ("11 call sites" no inventário
original) na verdade usa uma TERCEIRA fonte de credencial
(`getClickUpConfigOrNull()`, variável de ambiente pura, zero consciência
de organização) — nem `resolveClickUpAccess` nem `resolveClickUpCredentials`.
Dentro dele, só **1 ponto é agregado de verdade**:
`executeSelectionMutation` (`bento-selection-executor.ts`), que executa
briefing+atribuição sobre uma SELEÇÃO de tarefas que pode vir de uma
listagem multi-organização — usando a mesma credencial única pra todas.

### O que foi CORRIGIDO, com teste real

Os 2 agregados verdadeiros via `resolveClickUpAccess`:
**`GET /clickup/tasks/agency`** e **`GET /clickup/tasks/me`**
(`apps/api/src/clickup/routes.ts`).

- `packages/tool-gateway/src/task-provider-resolver.ts` —
  `resolveClickUpCredentialsForOrganizations(organizationIds)`: a mesma
  pergunta de `resolveClickUpCredentials`, para várias empresas de uma
  vez, nunca lança (config quebrada de uma organização vira `error`
  naquela entrada, não derruba as outras).
- `clientsByClickUpListId` passou a reter `organizationId` por cliente;
  `agruparListIdsPorOrganizacao` + `resolverCredenciaisPorOrganizacao`
  (novos, `clickup/routes.ts`) agrupam, resolvem a credencial de CADA
  organização (caindo na chave compartilhada só para quem não tem
  conector próprio — nunca para quem tem um conector quebrado, mesma
  regra de sempre) e devolvem também os NOMES dos clientes afetados por
  organização indisponível — nunca um id de organização no fio (o
  vocabulário do produto não expõe tenant ao navegador).
- As duas rotas agora consultam CADA organização com a credencial dela
  (`Promise.all`, em paralelo) e mesclam os resultados preservando
  proveniência por CLIENTE.
- `GET /clickup/tasks/me` ganhou o cuidado extra que só apareceu na
  investigação: o id numérico de membro do ClickUp é POR WORKSPACE — a
  mesma pessoa pode ter ids diferentes (ou nem existir) em workspaces de
  organizações diferentes. `findMemberByEmail` agora roda por
  organização; não ser membro de UM workspace específico é silencioso
  (zero tarefas daquela organização), só vira 409 se não bater em
  workspace NENHUM.
- Frontend: `AgencyTasksResponseWire.unavailable_clients?` (novo, aditivo)
  e aviso na tela de Tarefas quando alguma organização ficou de fora.

**Teste real, os cenários exatos pedidos:** `apps/api/src/clickup/
multi-org-aggregation.test.ts` (7 testes, novo arquivo) — Tenant A com
ClickUp A, Tenant B com ClickUp B, consulta agregada de quem vê os dois
devolve A+B com a credencial certa para cada um; organização com conector
quebrado some do resultado sem derrubar as outras (`unavailable_clients`,
nunca o id da organização); nenhuma credencial utilizável → 400 em vez de
usar a de outra organização; organização sem conector próprio cai na
chave compartilhada (comportamento de sempre, não regressão); "/me" com
ids de membro diferentes por workspace; "/me" sem ser membro de um
workspace específico devolve só as tarefas de onde é membro, sem erro;
"/me" sem ser membro de workspace nenhum → 409, nunca 500.

`tsc --noEmit` limpo em `tool-gateway`/`api`/`web`. Suíte completa sem
regressão: api 343 passed + 16 skipped (336 anteriores + 7 novos), demais
pacotes inalterados.

### O que FICOU DE FORA, deliberadamente, e por quê

1. **Os 6 call sites de UM cliente só** (`resolveClickUpAccess` em
   comentários/anexos de task) continuam usando a credencial
   pessoal/compartilhada em vez da credencial da organização dona do
   cliente. Bug real, classe diferente (funcional — pode falhar em
   encontrar a task se a organização tiver conector próprio distinto —
   não de segurança, pela isolação por workspace do próprio ClickUp).
   Fora do escopo desta rodada porque o pedido explícito do usuário era
   sobre caminhos AGREGADOS; migrar os 6 é mecânico mas é outro problema.
2. **`executeSelectionMutation`** (`apps/worker/src/processors/
   bento-selection-executor.ts`, via `bento-action-guard.ts`) é o ÚNICO
   agregado verdadeiro que sobra — e é um caminho de ESCRITA (briefing +
   reatribuição em lote), exatamente o que "escrita nunca atravessa
   tenant" mais protege. **Decisão deliberada de NÃO mexer agora:**
   corrigi-lo exigiria introduzir resolução de credencial por organização
   dentro do worker do Bento pela primeira vez (hoje ele só conhece
   `getClickUpConfigOrNull()`, variável de ambiente pura, sem nenhuma
   noção de organização) — uma mudança de escopo maior, numa parte viva
   do pipeline de execução de agente que esta sessão nunca tinha tocado,
   perto do fim de uma rodada já muito longa. O risco de uma pressa aqui
   é desproporcional ao ganho de fechar o item nesta mesma sessão. A
   investigação já deixou o formato exato do fix esboçado (resolver
   credencial por organização ANTES do loop por task, resolver o membro
   alvo por organização também, já que o id de membro é por workspace) —
   registrado como NEXT, não esquecido.

   **Atualização (sessão paralela, mesma tarde, 06/10/2026):** auditoria
   dedicada confirmou o comportamento exato de
   `resolveTaskClientAuthorization` — quando a seleção é verdadeiramente
   multi-organização (`activeOrganizationId` nulo), a checagem cai em
   `'unknown'`, tratado como mismatch, e a ESCRITA É BLOQUEADA. Ou seja:
   o risco real não é "escreve silenciosamente na organização errada" —
   é FALHA FECHADA — é "não consegue fazer briefing/atribuição em lote
   numa seleção multi-organização hoje", uma limitação funcional, não um
   vazamento de tenant. Corrigir de verdade exige duas mudanças
   acopladas (credencial por organização dentro de
   `executeSelectionMutation` + `resolveTaskClientAuthorization` aceitando
   um CONJUNTO de organizações autorizadas, não uma só) — a mesma decisão
   de não mexer nesta rodada foi mantida pela sessão paralela, pelo mesmo
   motivo (cirurgia grande numa pipeline de execução viva, perto do fim
   de uma rodada já longa). Registrado aqui porque muda a gravidade do
   item no MULTI-TENANT RELEASE GATE: debt funcional conhecida, não um
   buraco de segurança silencioso.

### MULTI-TENANT RELEASE GATE: continua PARTIAL, agora com escopo exato

Antes: "8 call sites" vago. Agora: **1 agregado real pendente**
(`executeSelectionMutation`, caminho de escrita, worker do Bento) +
**6 sites de credencial errada em rota de cliente único** (funcional, não
de segurança). Os 2 agregados de leitura mais expostos (as duas rotas que
alimentam a Central de Tasks/Kanban que ficaram visíveis pra toda a
equipe nesta mesma sessão, P1-H) estão corrigidos e testados com 2
tenants reais, como o prompt master pediu explicitamente.

### O que falta para "AGENCY OS READY FOR INTERNAL OPERATION", em ordem

1. Identificar/provisionar um banco provadamente seguro, aplicar `0056`–
   `0058`, rodar as suítes e fazer prova de runtime real (não mock) —
   sem isto, nada do P1 é usável por uma pessoa de verdade.
2. Decidir, com o usuário, o que P2/P3 deste prompt cobrem que a sessão
   paralela ("FINAL PRODUCT REFINEMENT") ainda não cobre — para não
   duplicar nem deixar lacuna por as duas sessões assumirem que a outra
   cobre.
3. **Parcialmente feito nesta sessão** (ver seção dedicada acima): os 2
   agregados de leitura do ClickUp (`tasks/agency`, `tasks/me`) foram
   redesenhados e testados com 2 tenants reais. Falta o único agregado de
   ESCRITA que sobrou (`executeSelectionMutation`, no worker do Bento) e,
   com menor urgência, migrar os 6 sites de credencial errada em rota de
   cliente único.
4. Fechar Bento de leitura para ação (criar task de brief aprovado,
   resolver aprovação pelo chat).

---

## Workspace Builder — fechando a última milha nas minhas rotas — 06/10/2026

A sessão paralela construiu o Workspace Builder (prompt de refinamento
§5-13/§79: template por colaborador + módulos habilitados, com
enforcement real — "esconder menu não basta, API: 403"). Avisou que os
módulos `demandas`/`aprovacoes`/`inbox` já existem no vocabulário e já
escondem o item de navegação, mas as ROTAS de `demands`/`approvals`/
`communications` ainda aceitavam a chamada direta. Como são meus
arquivos, pediram que eu fechasse — feito:

- `requireModule('demandas')` no hook de `demands/routes.ts` e de
  `briefs/routes.ts` (briefing não tem item de navegação próprio, vive
  dentro da ficha da demanda — mesmo módulo).
- `requireModule('aprovacoes')` no hook de `approvals/routes.ts`.
- `requireModule('inbox')` no hook `authed` de `communications/routes.ts`
  — nunca no webhook público, que fica fora desse bloco de propósito.
- 4 arquivos de teste existentes precisaram de um mock de
  `../auth/require-module` (a real bate em `workspace_configs`, que os
  mocks desses arquivos não simulavam) — feito com a mesma régua aberta
  já usada pra `requirePermission` nesses arquivos. 1 teste novo
  (`demands/routes.test.ts`) prova o 403 de verdade quando o módulo está
  desabilitado, não só mocka o caminho feliz.

`tsc --noEmit` limpo, suíte completa 344 passed (+1 deste fix) + 26
skipped (nenhum destes skips é meu).

---
