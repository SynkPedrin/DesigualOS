# Engineering Execution Plan — Desigual OS → Agency Operating System

**Data:** 05/10/2026 · **Base:** `desigual-2.0-gap-analysis-agency-os.md` (05/10/2026),
`desigual-2.0-inventario-web-api.md` e `desigual-2.0-inventario-mcp-backend.md` (30/09/2026)
**Branch:** `feat/otto-motion-engine`

Este documento assume que o leitor já leu o Gap Analysis. Não repete o que já foi
decidido lá (KEEP list); detalha COMO implementar o que falta, arquivo por arquivo,
a partir do código medido — inclusive achados novos, mais precisos, encontrados na
validação profunda feita para este plano (seção 0.1).

---

## 0. Correções sobre o Gap Analysis, achadas na validação profunda

A validação arquivo-por-arquivo feita para este plano encontrou coisas mais graves e
mais específicas do que "9 módulos só checam papel". Registro aqui porque mudam a
prioridade dentro do próprio P0:

1. **`apps/api/src/admin/routes.ts` tem um bug de autorização ativo, não uma lacuna
   teórica.** As 4 rotas de mutação (`PATCH /admin/users/:id/role`, `PATCH
   /admin/users/:id/status`, `PATCH /admin/users/:id`, `DELETE /admin/users/:id`,
   linhas 221-354) checam permissão (`users:write`) mas **não checam se `:id`
   pertence à organização de quem chama**. Um master da empresa A, sabendo ou
   adivinhando o UUID, pode mudar o papel, desativar, renomear ou **deletar** um
   usuário da empresa B. A listagem (`GET /admin/users`, L114) já é recortada
   corretamente — só as mutações vazam. Isto é mais grave que qualquer outro achado
   do Gap Analysis original e deve ser o primeiro código a mudar neste plano.

2. **`apps/worker/src/processors/execute-job.ts:1488-1489`** monta o conjunto de
   `clickupListId` para a feature de "ata de reunião" com
   `db.select(...).from(schema.clients).where(isNull(schema.clients.deletedAt))` —
   **sem filtro de organização nenhum**. Toda ata de reunião de qualquer tenant
   enxerga a lista de tarefas de QUALQUER cliente de QUALQUER empresa. Live leak,
   não risco teórico.

3. **`apps/api/src/clickup/routes.ts:625` (`GET /clickup/members`)** usa
   `getClickUpConfig()` global (L94-99) e devolve o workspace inteiro do ClickUp,
   sem recorte de cliente nem de organização — outra rota que devolve PESSOAS de
   fora da empresa de quem pergunta, na mesma categoria que `collaborators`/`team`
   que o Gap Analysis já sinalizou.

4. **`apps/api/src/nodes/routes.ts:167` (`POST /nodes/:node_id/command`)** não tem
   `exigirProvedor()`, enquanto o `GET /nodes` irmão (L134) tem — inconsistência que
   permite a um não-provider comandar nós de infraestrutura.

5. **4 bypasses confirmados do `TaskProvider` resolver** (não 3 como o Gap Analysis
   estimava): `apps/api/src/clickup/routes.ts:94-99`, `apps/mcp/src/server.ts:172-176`
   (o mais estranho — `organizationId` já é parâmetro da própria função e é
   ignorado), `apps/worker/src/processors/bento-action-guard.ts:1174-1179` (chamado
   de 11 pontos do worker), e um quinto lugar não listado no Gap Analysis:
   `apps/api/src/integrations/access.ts:63-78` (`resolveClickUpAccess`/
   `resolveSharedClickUpAccess`), que alimenta `clickup/routes.ts` tasks/agency,
   tasks/me e comments com uma chave compartilhada global como fallback.

6. **`client_users` não tem coluna `organization_id` própria** — herda via
   `clients.organization_id`. Isso é aceitável (um client_user só existe se o
   client existir, e o client já carrega a organização), mas significa que
   qualquer nova tabela de responsabilidade por cliente deve seguir o mesmo
   padrão (não duplicar `organization_id`, buscar via join), para não criar uma
   segunda fonte de verdade que pode divergir.

7. **`organization_connectors` já é o resolver genérico de credencial por
   provider** (`organizationId` + `provider` + `credentials jsonb`, único por par,
   mascarado na leitura) — hoje só aceita `provider = 'clickup'` por um whitelist
   em `apps/api/src/connectors/routes.ts` (`CREDENCIAIS_POR_PROVIDER`). Isto é a
   peça que o prompt master pede para "WhatsAppAdapter"/"GoogleCalendarAdapter"
   (Integration Adapter com Auth + credential storage, §59) — **já existe**. Não
   criar nova tabela de credencial para WhatsApp ou Calendar; estender o whitelist.

---

## 1. Executive Architecture Summary

O Desigual OS já tem a fundação que o prompt master pede (tenant hierarchy,
RBAC por função, convite, audit log, TaskProvider abstraction, connector storage
genérico) — construída com um rigor que o prompt nem exige (leitura desce/escrita
nunca atravessa). O trabalho real não é "construir a Fase 1"; é:

1. **Fechar 6 buracos de isolamento já identificados e medidos** (seção 0.1) —
   nenhum precisa de desenho novo, todos reusam `escopoDeOrganizacao`/
   `hierarquiaDeOrganizacao`/`resolveTaskProvider` que já existem.
2. **Construir o único domínio que falta de verdade**: Communications
   (WhatsApp) → Demand → Brief → Task → Approval. Isto é greenfield dentro de um
   sistema brownfield — reaproveita `organization_connectors` (credencial),
   `TaskProvider` (destino), `audit_logs` (rastro), `operational_events`/
   `proactive_signals` (sinal), mas as entidades Conversation-externa, Demand,
   Brief, BriefVersion, ApprovalRequest não existem e precisam nascer.
3. **Generalizar dois mecanismos ad hoc**: a herança de permissão da IA (hoje só
   existe para Bento+ClickUp, em `bento-action-guard.ts`) e o registry de módulos
   do frontend (hoje é papel+contexto embutido em `nav-items.ts`, não
   capabilities por membro) — ambos **depois** que tiverem um segundo consumidor
   real, não antes.

Não há rewrite em lugar nenhum deste plano. Toda entrega nova é evolução aditiva
sobre uma peça que já existe.

---

## 2. Current System → Target System

```
HOJE                                    ALVO (depois deste plano)
────────────────────────────────────    ────────────────────────────────────
organizations + organization_members    (sem mudança — já é o modelo certo)
hierarquia pai/filho (agência→subconta)  (sem mudança)
RBAC por função (7 papéis, MCP_SCOPES)  +5 scopes novos (conversations/demands/
                                         briefs/approvals/calendar)
client_users (1 role por par)           client_users + responsibility tipada
                                         (mesma tabela, migração aditiva)
TaskProvider → ClickUp (parcial,        TaskProvider único caminho, 5
  5 bypasses conhecidos)                bypasses migrados
organization_connectors (só clickup)    organization_connectors (+whatsapp,
                                         +google_calendar)
conversations/messages (chat interno    conversations/messages intocados +
  Bento, userId obrigatório)            NOVAS tabelas de comunicação externa
                                         (contacts, channel_threads,
                                         thread_messages) — sem colisão de nome
agentTools (matriz estática DB,         mesma matriz + categoria de risco
  só approve/deny)                      (SAFE_READ..DESTRUCTIVE) + inheritance
                                         generalizada no gateway
bento-action-guard (inheritance ad      Tool Gateway com inheritance genérica,
  hoc, só clickup:write)                bento-action-guard delega pro gateway
nav-items.ts (papel+contexto            nav-items.ts + capabilities por membro
  embutido)                             quando role templates existirem (P3)
Nenhum Demand/Brief/Approval genérico   Demand, Brief, BriefVersion,
                                         ApprovalRequest — novas entidades
Nenhum WhatsApp                         CommunicationProvider + 1 adapter real
Nenhum Calendar                         CalendarProvider + Google Calendar
```

---

## 3. Dependency Graph

```
P0.1 (fechar scoping, inclui bugs da seção 0.1)
   ↓
P0.2 (ClickUp writes → resolver único)        P0.3 (ClientAssignment)
   ↓                                               ↓
   └──────────────────┬────────────────────────────┘
                       ↓
              P0 CHECKPOINT (gate: todos os testes, ver seção P0-GATE)
                       ↓
     P1.1 Communications schema (contacts/threads/messages)
                       ↓
     P1.2 WhatsApp adapter (reusa organization_connectors)
                       ↓
     P1.3 Inbox (frontend)
                       ↓
     P1.4 Demand ←──────────────┐
                       ↓          │ (Demand pode nascer manual, sem esperar P1.2/P1.3
     P1.5 Brief + BriefVersion   │  terminarem — ver nota de paralelismo abaixo)
                       ↓          │
     P1.6 AI brief extraction ───┘
                       ↓
     P1.7 Brief → Task (usa TaskProvider já fechado em P0.2)
                       ↓
     P1.8 Kanban views (leitura sobre TaskProvider)
                       ↓
     P1.9 Generic ApprovalRequest  ──→  P1.10 Approval UI
                       ↓
     P1.11 Client 360 (abas incrementais, cada uma lê de uma entidade acima)
                       ↓
     P1.12 Today (só depois de P1.4-P1.10 terem dado real)
                       ↓
     ═══════════ P1 ACCEPTANCE TEST (seção 12) ═══════════
                       ↓
   ┌───────────────────┼───────────────────┐
   ↓                   ↓                   ↓
P2 Calendar     P2 Tool Gateway        P2 Manager Control
(Google OAuth,  generalization         Center (lê dado real
reusa connector (categoria de risco +  de P1.4-P1.10)
pattern)        inheritance genérica)
   └───────────────────┴───────────────────┘
                       ↓
     P3 (arquitetura apenas, não implementar): Meta Ads, Suzy, Module Registry
```

**Nota de paralelismo:** P1.4 (Demand) não precisa esperar P1.2/P1.3 (WhatsApp
real) terminarem — uma Demand pode nascer manual (criada por um membro direto na
UI) desde o primeiro dia. Isso permite entregar Brief→Task→Approval e provar o
workflow de produção **antes** do adapter de WhatsApp estar pronto, reduzindo o
risco de uma integração externa (WhatsApp Business API/Evolution API, decisão em
aberto — ver P1.2) bloquear todo o resto.

---

## 4. Phase Plan

### FASE P0.1 — Fechar organization scoping (inclui os bugs da seção 0.1)

**Objective:** nenhuma rota de `apps/api` lê ou escreve dado de outra organização,
inclusive nos casos onde hoje a checagem de papel mascara a ausência de checagem
de organização.

**Current State:** ver seção 0.1 (itens 1, 3, 4) e o Gap Analysis §1.1 para os
módulos `admin`/`clickup`/`nodes`/`integrations`/`collaborators`/`team`/
`mcp-status`/`panorama`/`costs`/`data-quality`/`health`/`studio`/`chat` — a
maioria já tem recorte (ver detalhe por rota na validação, seção 0.1); os buracos
reais são pontuais, não sistêmicos.

**Target State:** toda rota de mutação valida que o recurso-alvo (`:id`, `client_id`
embutido no body, etc.) pertence à(s) organização(ões) que `orgsVisiveisParaLeitura`/
`podeEscreverNaOrganizacao` autorizam para quem chama.

**Tasks, em ordem de severidade:**

1. `apps/api/src/admin/routes.ts` L221-354 (4 rotas) — antes de aplicar `users:write`,
   carregar o `organization_members` do usuário-alvo e chamar
   `podeEscreverNaOrganizacao(orgAtivaDoChamador, orgDoAlvo)` (já existe em
   `packages/auth/src/hierarquia-de-organizacao.ts`). Se o alvo pertence a mais de
   uma organização (caso de cross-org de verdade), decidir: exigir que pelo menos
   uma das organizações do alvo seja a ativa do chamador. Retornar 404 (não 403),
   mesmo padrão já usado em `organizations/ficha.ts` (não revelar existência).
2. `apps/worker/src/processors/execute-job.ts:1488-1489` — adicionar
   `.where(and(isNull(schema.clients.deletedAt), eq(schema.clients.organizationId,
   runningExecution.organizationId)))`. `runningExecution.organizationId` já existe
   no escopo (confirmado, usado em L1928/L2512) — é thread de parâmetro, não
   descoberta de dado novo.
3. `apps/api/src/clickup/routes.ts:625` (`GET /clickup/members`) — trocar
   `getClickUpConfig()` global por `resolveTaskProvider(organizationId)` (unifica
   com P0.2) e, se o adapter não expuser "listar membros do workspace" de forma
   neutra a provider, restringir a resposta aos membros atribuídos aos clientes
   que o chamador enxerga (`recorteDePessoasVisiveis`, já usado em `admin`/
   `collaborators`/`team`).
4. `apps/api/src/nodes/routes.ts:167` — adicionar `exigirProvedor()` igual ao
   `GET /nodes` irmão.
5. `apps/api/src/integrations/access.ts:63-78` — depreciar o fallback de chave
   compartilhada quando a organização tiver `organization_connectors` próprio
   (consolida com P0.2 item 5); manter fallback só quando não há connector
   (comportamento atual, documentado, não um bug por si só).

**Files:** `apps/api/src/admin/routes.ts`, `apps/worker/src/processors/execute-job.ts`,
`apps/api/src/clickup/routes.ts`, `apps/api/src/nodes/routes.ts`,
`apps/api/src/integrations/access.ts`.

**New files:** nenhum.

**Schemas/Migrations:** nenhuma — todas as tabelas envolvidas já têm `organization_id`
(direto ou via join).

**API routes:** mesmas rotas, comportamento corrigido (não é breaking change de
contrato — era bug, response shape não muda).

**Frontend:** nenhuma mudança — a UI já assume que essas rotas são corretas.

**Permissions:** nenhuma permissão nova; aplica as que já existem com o escopo que
faltava.

**Events:** nenhum evento novo. Opcional: emitir `AUTHORIZATION_DENIED` em
`audit_logs` quando o bloqueio disparar (dado que já existe fonte — `auditoria.ts`).

**Audit:** garantir que as 4 rotas de `admin` escrevem em `audit_logs` com
`resourceType='user'`, `resourceId=:id`, `oldValue`/`newValue` — hoje escrevem
auditoria da ação mas vale confirmar que o registro inclui a organização de
destino, não só a do ator.

**Dependencies:** nenhuma (pode começar imediatamente).

**Failure modes:** se o usuário-alvo pertencer a múltiplas organizações
legitimamente (ex.: Tammy atende Desigual e Cosentino), a checagem ingênua de
"uma organização só" quebra esse caso real — testar explicitamente com um membro
multi-org antes de travar a regra.

**Tests:** estender `apps/api/src/organizations/membros.test.ts` e
`escopo-de-organizacao.test.ts` com: "master da org A não pode promover/demitir/
deletar usuário da org B"; "ata de reunião da org A não cita cliente da org B";
"GET /clickup/members não devolve pessoa de cliente que o chamador não acessa";
"POST /nodes/:id/command exige provider".

**Runtime proof:** rodar os 4 cenários acima contra o banco de staging com 2
organizações reais (não mock) — o próprio prompt master proíbe `Math.random`/mock
em prova de release (§101); aqui a prova é ainda mais crítica por ser teste de
segurance.

**Acceptance criteria:** idênticos aos do Gap Analysis §1.1, mais os 4 cenários
específicos acima.

**Complexity:** S (mudança cirúrgica, sem migration, sem schema).

---

### FASE P0.2 — ClickUp writes → TaskProvider resolver único

**Objective:** todo caminho de leitura/escrita de task passa por
`resolveTaskProvider(organizationId)`; zero lugar monta `ClickUpConfig` de env var
quando a organização tem (ou pode ter) connector próprio.

**Current State:** 5 bypasses confirmados (seção 0.1 item 5).

**Target State:**
```
organization context (já disponível em todo call site, confirmado)
   ↓
resolveTaskProvider(organizationId)
   ↓
organization_connectors (se existir linha pra essa org+provider)
   ↓ (senão, fallback documentado — não silencioso)
env global (só quando NENHUMA organização tem connector próprio;
            comportamento atual, aceitável como transição)
```

**Tasks:**
1. `apps/api/src/clickup/routes.ts:94-99` — substituir `getClickUpConfig()` por
   `await resolveTaskProvider(organizationId)` nos 2 call sites que ainda usam
   config direta (webhook em L213/L259 já resolve org pelo client — só trocar a
   fonte da credencial).
2. `apps/mcp/src/server.ts:172-176` — **o fix mais simples do plano inteiro**:
   `organizationId` já é parâmetro de `montarProviders`; trocar as duas linhas que
   leem `process.env.CLICKUP_*` por uma chamada a `resolveTaskProvider(organizationId)`.
3. `apps/worker/src/processors/bento-action-guard.ts:1174-1179` e os 11 call sites
   em `execute-job.ts`, `bento-openai-core.ts`, `selection-read.ts`,
   `agentic-dispatch.ts` — como são muitos pontos, introduzir UM helper
   (`resolveOrganizationTaskProvider(organizationId)` em
   `packages/tool-gateway/src/task-provider-resolver.ts`, reexportando
   `resolveTaskProvider` com cache opcional por execução) e trocar as 11 chamadas
   para usá-lo. Não editar a lógica de negócio de cada processor — só a origem da
   credencial.
4. `apps/api/src/integrations/access.ts` — já coberto em P0.1 item 5.

**Files:** os 4 arquivos acima + `packages/tool-gateway/src/task-provider-resolver.ts`
(novo export, sem mudar assinatura existente).

**New files:** nenhum.

**Schemas/Migrations:** nenhuma — `organization_connectors` já suporta isto.

**API routes:** mesmas, comportamento corrigido para organizações com connector
próprio.

**Permissions:** nenhuma nova.

**Events:** nenhum novo diretamente; `organization_connectors` já é auditável via
`connectors/routes.ts`.

**Dependencies:** nenhuma dependência de P0.1, pode rodar em paralelo (arquivos
diferentes).

**Failure modes:** se uma organização tiver connector ClickUp malformado
(credential inválida), o resolver precisa falhar alto e claro (já é o
comportamento documentado em `task-provider-resolver.ts`: "NUNCA cai no fallback
quando a empresa gravou conector") — confirmar que os 11 novos call sites
propagam esse erro em vez de engolir exceção silenciosamente (risco real em
código de worker, que costuma ter try/catch amplo).

**Tests:** cenário permanente de regressão — org A com connector ClickUp próprio +
org B sem connector (fallback env): criar task em A só aparece no ClickUp de A;
criar task em B usa o fallback; Bento e MCP obedecem a mesma resolução (não só a
API). Usar `packages/tool-gateway/src/task-provider.test.ts` e
`clickup-task-provider-adapter.ts` como base, estender com os 2 tenants reais.

**Runtime proof:** 2 contas ClickUp sandbox reais (não mock), uma por tenant de
teste.

**Acceptance criteria:** idênticos ao Gap Analysis §1.6 + P0.2 do prompt do
usuário.

**Complexity:** M (muitos call sites, mas mudança mecânica; risco está em não
quebrar os 11 processors do worker).

---

### FASE P0.3 — Client Assignment com responsabilidade tipada

**Objective:** suportar múltiplas responsabilidades por pessoa por cliente
(Jamille=account, Alicia=traffic, Gui=design, Tammy=manager — todas simultâneas
na Cosentino) sem destruir `client_users`.

**Decisão (A — estender, não criar tabela nova):** `client_users` já é
`(clientId, userId) único` com uma coluna `role` (nível de acesso: viewer/editor,
não função operacional). Criar uma tabela nova colidiria em conceito ("role" de
novo, com outro nome) e obrigaria todo código que já lê `client_users.role` a
saber qual tabela consultar. A opção mais segura e mais barata é:

1. Adicionar coluna `responsibility` (text, nullable) a `client_users`.
2. Trocar a constraint única de `unique(clientId, userId)` para
   `unique(clientId, userId, responsibility)` — permite múltiplas linhas por par
   quando `responsibility` difere, preserva unicidade quando é a mesma.
3. **Não** migrar `responsibility` a partir de `role` por dedução — linhas
   existentes ficam com `responsibility = NULL` (o `[FALTA]` do CLAUDE.md deste
   projeto se aplica aqui tanto quanto a brain de cliente: dado que não existe
   não se inventa). UI mostra "responsabilidade não definida" e oferece
   preencher.

**Tipos iniciais** (enum em código, não em banco — texto livre validado na
camada de aplicação, para não exigir migration toda vez que um tipo novo surgir):
`account`, `traffic`, `design`, `copy`, `social`, `video`, `manager`, `sales`,
`other`.

**Migration (0056, aditiva):**
```sql
ALTER TABLE client_users ADD COLUMN responsibility text;
ALTER TABLE client_users DROP CONSTRAINT client_user_client_id_user_id_unique;
ALTER TABLE client_users ADD CONSTRAINT client_user_client_id_user_id_responsibility_unique
  UNIQUE (client_id, user_id, responsibility);
```
Nota: Postgres trata `NULL` como distinto em `UNIQUE` (múltiplos `NULL` não
colidem) — isso É o comportamento desejado aqui (linhas antigas sem
responsabilidade definida podem coexistir), mas documentar explicitamente no
comentário da migration para quem ler depois não achar que é bug.

**Files:**
- `packages/database/src/schema/clients.ts` (`clientUsers` — adicionar coluna,
  trocar constraint).
- `database/migrations/0056_<nome>.sql` (gerado via drizzle-kit, não escrito à
  mão).
- Novo módulo de aplicação: `apps/api/src/clients/assignments.ts` (ou estender
  `apps/api/src/clients/routes.ts` existente) com:
  - `GET /clients/:id/assignments` — responsáveis por cliente.
  - `PUT /clients/:id/assignments` — definir/substituir responsabilidade de um
    membro (idempotente, não acumula lixo).
  - `GET /team/members/:id/assignments` — clientes de um colaborador (reusa
    `recorteDePessoasVisiveis`).

**Schemas:** `clientUsers.responsibility: text (nullable)`.

**API routes:** as 3 acima, todas atrás de `escopoDeOrganizacao` (o cliente já
carrega `organizationId`, reaproveita o padrão existente de `hasClientAccess`).

**Frontend:** nenhuma tela nova nesta fase — é pré-requisito de dado para Cliente
360 (P1.11) e Today (P1.12), não entrega visível sozinho. Pode expor como
melhoria pontual na ficha do cliente existente (`ClientDetailOverlay`) se o
tempo permitir, mas não é obrigatório para o acceptance criteria desta fase.

**Permissions:** `clients:write` já existente cobre `PUT /assignments` (é edição
de um aspecto do cliente); não criar escopo novo.

**Events:** `CLIENT_ASSIGNMENT_CHANGED` (actor, client, member, responsibility
antiga/nova) — primeiro evento novo deste plano, candidato natural a
`operational_events` (pipeline já genérico, Gap Analysis §1.13).

**Dependencies:** nenhuma de P0.1/P0.2 — pode rodar em paralelo.

**Failure modes:** permitir responsabilidade duplicada sem querer (duas linhas
"design" pro mesmo Gui na Cosentino) — a constraint única já impede isso no
banco; garantir que a API trata a violação de unique como "já existe, idempotente"
em vez de 500.

**Tests:** `client_users` com múltiplas responsabilidades para o mesmo par;
cross-tenant (membro de org A não pode virar assignment de cliente de org B —
reusa `hasClientAccess`); idempotência do `PUT`.

**Runtime proof:** criar as 4 atribuições do exemplo do usuário (Jamille/Alicia/
Gui/Tammy na Cosentino) em staging e consultar via as 2 rotas GET.

**Acceptance criteria:** idênticos ao pedido do usuário (consultar por cliente,
por colaborador, por função, múltiplos responsáveis, respeita organização, nunca
cross-tenant).

**Complexity:** S/M (migration pequena, mas é a primeira migration do plano —
vale rodar com contagem antes/depois, seguindo o rigor já usado na migration
0045 documentada no inventário MCP).

---

### P0 — CHECKPOINT (gate obrigatório antes de P1)

Rodar, nesta ordem, e não prosseguir com qualquer FALHA sem decisão explícita:

```
pnpm --filter @desigual-os/auth test                 # hierarquia/escopo puros
pnpm --filter @desigual-os/api test                   # admin, clickup, nodes, organizations
pnpm --filter @desigual-os/worker test                # execute-job, bento-action-guard
pnpm --filter @desigual-os/mcp test                    # server.ts, providers
pnpm --filter @desigual-os/tool-gateway test           # task-provider, resolver
turbo run test --filter=...                            # suíte completa, não só o que mudou
```
mais, se houver ambiente de staging com 2 tenants reais: os cenários de P0.1/P0.2/
P0.3 manualmente (ver "runtime proof" de cada fase).

**Saída exigida: `P0 READY` ou `P0 NOT READY` + lista do que falhou.** Não avançar
para P1 silenciosamente com qualquer teste de isolamento vermelho — isto é regra
do prompt master (§93-96) e já é a disciplina que este repositório segue (seção
1.14 do Gap Analysis).

---

### FASE P1.1 — Communications Domain (schema)

**Objective:** modelar conversas com contatos externos sem colidir com
`conversations`/`messages` (que são, confirmado, o chat interno com Bento —
`userId` obrigatório, sem qualquer coluna de telefone/canal externo).

**Current State:** não existe nenhuma tabela de conversa externa. `conversations`/
`messages` existentes são de outro domínio (chat interno) e não devem ser
reaproveitadas — forçar isso criaria uma FK `userId NOT NULL` apontando para um
"usuário" que na verdade é um contato externo, contaminando o modelo que já
funciona para Bento.

**Target State:** domínio novo, nomes que não colidem:

```ts
// packages/database/src/schema/communications.ts (novo arquivo)

contacts            // pessoa do lado do cliente (não um `users` da agência)
  id, organizationId, clientId (nullable — pode existir contato antes de
    vincular a um cliente), name, phone, email, externalIds (jsonb — id da
    Evolution API / WhatsApp Business API), createdAt

channelConnections   // REUSA organization_connectors (provider='whatsapp'),
                     // não cria tabela de credencial nova — ver P1.2

conversationThreads  // thread com um contato, por canal
  id, organizationId, clientId (nullable), contactId, channel ('whatsapp'),
    status ('open'|'waiting_client'|'waiting_agency'|'archived'),
    assignedToUserId (nullable), lastMessageAt, createdAt

threadMessages       // mensagens de uma thread
  id, threadId, organizationId, direction ('inbound'|'outbound'),
    senderContactId (nullable), senderUserId (nullable), content,
    attachmentUrl, externalMessageId (idempotência — dedupe key),
    deliveryStatus, createdAt
```

**Files (novos):** `packages/database/src/schema/communications.ts`,
`database/migrations/0057_<nome>.sql`.

**Files (editados):** `packages/database/src/schema/index.ts` (barrel export).

**Migrations:** 0057, puramente aditiva (tabelas novas, nenhuma existente
alterada).

**API routes:** nenhuma ainda — esta fase é só schema. Rotas vêm em P1.3.

**Permissions:** novo scope `conversations.read`/`conversations.write` em
`packages/mcp-domain/src/scopes.ts` (`MCP_SCOPES`), atribuído a
`CUSTOMER_SUCCESS` (write), `MANAGER`/`SUPER_ADMIN` (write), demais papéis
(read ou nenhum) — ver matriz completa na seção 8.

**Events:** `CONVERSATION_CREATED`, `MESSAGE_RECEIVED`, `MESSAGE_SENT`,
`CONVERSATION_ASSIGNED` — alimentam o pipeline `PendingEvent→NormalizedEvent→
SignalCandidate` já existente (Gap Analysis §1.13), não um bus novo.

**Dependencies:** depende de P0 checkpoint estar `READY` (toca tabelas novas
com `organization_id`, quer nascer já correto, não corrigido depois).

**Failure modes:** `externalMessageId` sem índice único por canal permite
duplicar mensagem em retry de webhook — adicionar
`unique(channel, externalMessageId)` desde a migration inicial (idempotência,
§64 do prompt master).

**Tests:** schema puro (inserção, constraint, cascade) — sem lógica de negócio
ainda.

**Runtime proof:** inserir um contato + thread + mensagem manualmente via
seed/script, confirmar `organization_id` presente em todas as 4 tabelas.

**Acceptance criteria:** as 4 tabelas existem, migram limpo em cima do banco
atual, não alteram `conversations`/`messages` existentes.

**Complexity:** M.

---

### FASE P1.2 — Communication Provider + WhatsApp Adapter

**Objective:** interface igual em espírito ao `TaskProvider`, com um adapter real.

**Target State:**
```ts
// packages/tool-gateway/src/communication-provider.ts (novo, espelha task-provider.ts)
interface CommunicationProvider {
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendMessage(threadId, content, attachments?): Promise<ExternalMessage>
  syncConversations(since?: Date): Promise<ConversationSummary[]>
  health(): Promise<ProviderHealth>
}
```

**Decisão de adapter:** não especificar qual API de WhatsApp (Business API
oficial da Meta vs. Evolution API self-hosted, já citada em docs legados do
projeto como usada por `agentes-desigual`) sem confirmar com quem decide — isto é
exatamente o tipo de decisão que o prompt master pede para parar e perguntar
(§122: "decisão irreversível... gerar custo externo relevante"), e a documentação
legada (`brain/Agentes/Suzy.md`) sugere que já existe uma decisão tomada no
sistema legado que vale revalidar antes de duplicar. **Não escolher aqui.**

**Tasks (independente da escolha de API):**
1. Definir a interface `CommunicationProvider` (igual `TaskProvider` em forma).
2. Estender `CREDENCIAIS_POR_PROVIDER` em `apps/api/src/connectors/routes.ts`
   com `whatsapp` (schema zod a definir conforme a API escolhida — ex.:
   `instanceUrl`+`apiKey` pra Evolution API, ou `phoneNumberId`+`accessToken`
   pra API oficial).
3. Implementar `WhatsAppAdapter implements CommunicationProvider` — só depois
   da decisão acima.
4. Webhook endpoint `POST /webhooks/whatsapp` (padrão do webhook ClickUp já
   existente em `clickup/routes.ts:851`, HMAC/token de verificação, resolve
   organização pelo número de telefone de destino → `channelConnections`).

**Files:** `packages/tool-gateway/src/communication-provider.ts` (novo),
`apps/api/src/connectors/routes.ts` (estender whitelist), novo
`apps/api/src/webhooks/whatsapp.ts`.

**Schemas:** nenhuma nova — reusa `organization_connectors` (seção 0.1 item 7) +
as tabelas de P1.1.

**Permissions:** credencial nunca exposta ao agente nem ao frontend — mesmo
padrão de mascaramento já usado para ClickUp.

**Dependencies:** P1.1 (schema), decisão de produto sobre qual API (bloqueador
externo, não técnico).

**Failure modes:** webhook duplicado (retry da Meta/Evolution) — resolvido por
`unique(channel, externalMessageId)` já desenhado em P1.1.

**Tests:** adapter testado com fake/sandbox da API escolhida (nunca mock
silencioso em produção, §101).

**Acceptance criteria:** mensagem recebida vira `threadMessages` com
`organization_id` correto; resposta enviada pelo Desigual chega ao contato real
em sandbox.

**Complexity:** L (depende de decisão externa + integração de terceiro real).

**STOP CONDITION:** não implementar o adapter concreto sem confirmar a API de
WhatsApp com quem decide produto — ver seção 17.

---

### FASE P1.3 — Inbox (frontend)

**Objective:** `/inbox` com os estados pedidos pelo usuário.

**Target State:** rota nova `apps/web/src/app/(shell)/inbox/page.tsx`. Reusa
`apps/web/src/components/shell/nav-items.ts` (adicionar entrada, sem mudar a
interface `NavItem` — `section: 'dia'`, sem flag especial).

**Tasks:**
1. Lista de threads (filtros: minhas/não atribuídas/aguardando cliente/aguardando
   agência/importantes/arquivadas) — query sobre `conversationThreads` com os
   mesmos padrões de paginação já usados em `apps/api/src/clients/routes.ts`.
2. Painel de chat central — reusa componente de mensagem já existente em
   `apps/web/src/components/` se o chat interno (`/chat`) tiver um componente de
   bolha de mensagem genérico o bastante; senão, componente novo mínimo.
3. Painel direito (contexto do cliente) — reusa dados que **já existem**:
   responsável (P0.3), tasks abertas (TaskProvider), brain (Otto skill/brain,
   fora do escopo deste plano técnico).
4. Quick actions (criar demanda/task/briefing/decisão/reunião) — criar demanda
   chama a API de P1.4; os outros 4 botões podem ficar como stub/"em breve" se
   as entidades correspondentes (briefing P1.5, reunião/calendário P2) ainda não
   existirem — **não fingir que funcionam** (§82, empty state honesto é melhor
   que botão morto).

**Files:** novo `apps/web/src/app/(shell)/inbox/page.tsx` +
`apps/web/src/components/inbox/*` (novo diretório).

**API routes:** `GET /conversations`, `GET /conversations/:id/messages`,
`POST /conversations/:id/messages`, `PATCH /conversations/:id/assign`.

**Permissions:** `conversations.read`/`conversations.write` (P1.1).

**Dependencies:** P1.1 (schema), P1.2 (pelo menos o schema de credencial — pode
construir a UI com dado seedado manualmente antes do adapter real existir, para
não bloquear frontend no bloqueador externo de P1.2).

**Tests:** E2E Playwright — Jamille abre `/inbox`, vê thread, responde, atribui.

**Acceptance criteria:** os 6 estados do pedido do usuário existem e filtram
corretamente; painel direito mostra responsável real (não mock).

**Complexity:** M.

---

### FASE P1.4 — Demand

**Objective:** entidade que representa "cliente pediu algo", distinta de Task e
Brief.

**Schema (novo, `packages/database/src/schema/demands.ts`):**
```ts
demands
  id, organizationId, clientId, conversationThreadId (nullable — nasce de
    WhatsApp OU manual), createdBy, ownerId (responsável, default = quem tem
    responsibility='account' pro cliente — consulta P0.3),
    title, description, source ('whatsapp'|'manual'|'bento'),
    status ('new'|'briefing'|'in_production'|'done'|'cancelled'),
    priority, requestedAt, dueDate, metadata jsonb
```

**Migration:** 0058, aditiva.

**API routes:** `POST /demands` (de conversa ou manual), `GET /demands`
(filtros: cliente, responsável, status), `PATCH /demands/:id`.

**Frontend:** botão "Criar demanda" no Inbox (P1.3) e na ficha do cliente;
listagem simples (não precisa de tela própria nesta fase — pode viver como aba
dentro de Cliente 360 quando P1.11 chegar lá).

**Permissions:** novo scope `demands.read`/`demands.write`.

**Events:** `DEMAND_CREATED`, `DEMAND_STATUS_CHANGED`.

**Dependencies:** P0.3 (para resolver `ownerId` por responsabilidade). Não
depende de P1.2/P1.3 completos — pode nascer manual primeiro (ver nota de
paralelismo na seção 3).

**Tests:** criação cross-tenant bloqueada; `ownerId` resolvido corretamente a
partir de `client_users.responsibility`.

**Acceptance criteria:** demanda nasce de conversa OU manual; aparece filtrada
por cliente/responsável/status.

**Complexity:** S/M.

---

### FASE P1.5 — Brief + BriefVersion

**Objective:** versionamento real, nunca sobrescrita silenciosa.

**Schema (novo, `packages/database/src/schema/briefs.ts`):**
```ts
briefs
  id, organizationId, clientId, demandId, conversationThreadId (nullable),
    createdBy, approvedVersionId (nullable, FK pra brief_versions.id),
    status ('draft'|'in_review'|'approved'|'sent_to_production')

briefVersions
  id, briefId, version (int, sequencial por brief), content (jsonb —
    campos estruturados: objective, deliverable, channel, format, deadline,
    references, direction, restrictions, assets, notes),
    source ('ai_draft'|'human_edit'), sourceEvidence (jsonb — trechos da
    conversa que embasaram a extração, auditável), createdBy, createdAt
```

**Migration:** 0059, aditiva.

**API routes:** `POST /briefs` (a partir de demand), `POST /briefs/:id/versions`
(nova versão — nunca `PATCH` que sobrescreve conteúdo existente),
`PATCH /briefs/:id/approve-version` (define `approvedVersionId`).

**Permissions:** `briefs.read`/`briefs.write`.

**Events:** `BRIEF_CREATED`, `BRIEF_VERSION_CREATED`, `BRIEF_APPROVED`.

**Dependencies:** P1.4 (Demand).

**Failure modes:** duas pessoas editando a mesma versão ao mesmo tempo — resolver
com "nova versão sempre", nunca merge automático de conteúdo de brief (dado
demais em jogo pra resolver silenciosamente).

**Tests:** versão N não apaga N-1; `approvedVersionId` só aceita versão do
próprio brief.

**Acceptance criteria:** histórico de brief nunca se perde; versão aprovada é
rastreável.

**Complexity:** M.

---

### FASE P1.6 — AI Brief Extraction

**Objective:** rascunho de brief a partir de conversa + Brain, nunca como
verdade sem revisão quando houver ambiguidade — mesma regra que o CLAUDE.md
deste projeto já aplica ao Otto skill (`[CONFIRMAR: ...]` em vez de inventar).

**Tasks:**
1. Serviço de extração (`packages/context-engine` é o lugar natural — já faz
   extração de contexto de campanha, `campaign-derivation.ts`): dado um
   `conversationThreadId`, montar `BriefVersion.content` com os campos
   estruturados, marcando campo ausente/ambíguo explicitamente (mesmo padrão
   `[CONFIRMAR: ...]` do Otto skill, reaproveitado aqui — consistência de
   produto, não coincidência).
2. Complementar com Brain do cliente (brain do Otto skill, se existir pro
   cliente) para tom/posicionamento/restrições — **leitura**, nunca escrita
   automática no brain a partir de um brief em rascunho.

**Files:** novo `packages/context-engine/src/brief-extraction.ts`.

**API routes:** `POST /demands/:id/draft-brief` (dispara a extração, cria
`briefVersion` com `source='ai_draft'`).

**Dependencies:** P1.5 (schema de Brief), Otto skill/brain para contexto (fora
do escopo deste plano técnico — leitura read-only do brain já exportado via
`sync-brains.mts`, mencionado no CLAUDE.md do projeto).

**Failure modes:** extração alucinar um prazo ou um dado de cliente que não
está na conversa — mitigar marcando confiança por campo, nunca preenchendo
silenciosamente um campo sem evidência na própria mensagem (`sourceEvidence`
existe em P1.5 exatamente para isto ser auditável).

**Tests:** conversa sem prazo explícito → campo `dueDate` fica `null` +
marcado, nunca inferido.

**Acceptance criteria:** rascunho gerado é sempre revisável, nunca enviado
direto à produção sem passar por `status='in_review'`.

**Complexity:** M/L (qualidade de extração é a parte difícil, não o CRUD).

---

### FASE P1.7 — Brief → Task

**Objective:** enviar brief aprovado à produção usando o `TaskProvider` já
corrigido em P0.2 — **não criar `NativeTaskProvider`** (prompt master já avisa:
só criar se tecnicamente necessário; não é, ClickUp continua suficiente).

**Tasks:**
1. `POST /briefs/:id/send-to-production` — recebe `assigneeId`, `reviewerId`,
   `priority`, `dueDate`; chama `resolveTaskProvider(organizationId).createTask(...)`
   com o conteúdo do `approvedVersionId`.
2. Tabela de vínculo (não precisa ser schema novo — `demands`/`briefs` já têm
   `organizationId`/`clientId`; adicionar `externalTaskId`/`externalTaskProvider`
   em `briefs` para rastrear a task criada).

**Files:** `apps/api/src/briefs/routes.ts` (novo), coluna nova em `briefs`
(parte da migration 0059 ou uma 0060 separada se P1.5 já tiver sido deployada
isoladamente).

**Dependencies:** P0.2 (resolver único), P1.5.

**Events:** `TASK_CREATED_FROM_BRIEF` (liga `briefId`↔`externalTaskId`).

**Tests:** task criada aparece no ClickUp correto do tenant (reusa teste de
P0.2); campos do brief aprovado chegam na descrição da task.

**Acceptance criteria:** fluxo completo brief aprovado → task no ClickUp certo,
vinculada e rastreável.

**Complexity:** S/M.

---

### FASE P1.8 — Kanban (views)

**Objective:** views de leitura sobre o `TaskProvider`, sem tabela de task
duplicada.

**Tasks:** `GET /tasks/views/:viewId` (minha fila, por cliente, por
departamento) — monta o filtro certo e chama
`resolveTaskProvider(organizationId).listTasks(filter)`. **Checar antes**:
`listTasks` do `TaskProvider` atual suporta os filtros necessários (status,
assignee, lista) — se não suportar todos, estender a interface, não contornar
com query direta ao ClickUp.

**Frontend:** `apps/web/src/app/(shell)/tasks/` já existe (rota `/tasks`
confirmada no levantamento) — avaliar se já tem board ou só lista (achado: UI
hoje é linha/row, não board — `clickup-task-row.tsx`/`agency-task-row.tsx`); se
for só lista, adicionar um modo de visualização em board sobre o mesmo dado, não
duas fontes.

**Dependencies:** P0.2.

**Failure modes:** se o provider não suportar paginação por status
eficientemente, considerar cache local (projection) — **só se medido como
necessário**, não construir cache "por precaução" (prompt master §115, não
construir Finder/Resolve antecipado).

**Acceptance criteria:** board reflete o mesmo dado que a lista, sem divergência.

**Complexity:** M.

---

### FASE P1.9 — Generic Approval Engine

**Objective:** `ApprovalRequest` por `resourceType`/`resourceId`, **separado** do
gate de tool-call já existente (`agentTools.requiresApproval` — não mexer nisso
aqui, é outro problema).

**Schema (novo, `packages/database/src/schema/approvals.ts`):**
```ts
approvalRequests
  id, organizationId, clientId, resourceType ('brief'|'creative'|'copy'|'task'|
    'campaign'|'budget'|'publication'), resourceId, version (nullable),
    requestedBy, approverId (nullable até alguém reivindicar), status
    ('pending'|'approved'|'rejected'|'changes_requested'),
    comment, createdAt, resolvedAt
```

**Migration:** 0060 (ou próxima disponível), aditiva.

**API routes:** `POST /approvals`, `GET /approvals` (filtros: precisam de
mim/solicitadas por mim/cliente/status), `PATCH /approvals/:id` (approve/
reject/comment/request_changes — todas via `UPDATE ... WHERE resolved_at IS
NULL`, mesmo padrão de claim atômico já usado em `approveToolCall`,
`gateway.ts:181`, para evitar duas pessoas aprovando a mesma coisa em race).

**Permissions:** `approvals.read`/`approvals.write`.

**Events:** `APPROVAL_REQUESTED`, `APPROVAL_RESOLVED`.

**Audit:** toda transição grava em `audit_logs` (`resourceType`/`resourceId` já
são campos nativos da tabela — encaixe direto, sem adaptação).

**Dependencies:** nenhuma de Demand/Brief especificamente — é genérico, pode
nascer antes ou depois, mas só ganha uso real quando Brief (P1.5) ou Creative
(fora de escopo deste plano) existirem para apontar pra ele.

**Tests:** claim atômico (2 approvers simultâneos, só 1 vence); cross-tenant
bloqueado.

**Acceptance criteria:** aprovar um brief, uma task, e (quando existir) um
criativo usam a MESMA tabela, sem entidade de aprovação duplicada por tipo de
recurso.

**Complexity:** M.

---

### FASE P1.10 — Approval UI

**Objective:** `/approvals` — já existe uma rota com esse path no levantamento
de frontend (`apps/web/src/app/(shell)/approvals/page.tsx`) — **verificar o que
já existe lá antes de criar do zero**; pode já ser um placeholder ou cobrir outro
conceito (aprovação de tool-call, por exemplo — P1.9 pede para não misturar os
dois no schema, mas a TELA pode legitimamente mostrar as duas filas lado a lado,
desde que a fonte de dado de cada uma seja a tabela certa).

**Tasks:** confirmar estado atual de `apps/web/src/app/(shell)/approvals/page.tsx`
antes de planejar o diff exato (ação de pesquisa, não de código, no início desta
fase).

**Dependencies:** P1.9.

**Complexity:** S/M (depende do achado acima).

---

### FASE P1.11 — Client 360 (incremental)

**Objective:** evoluir `ClientDetailOverlay` para rota própria `/clients/[id]`,
aba por aba, só quando o backend da aba existir — nunca aba vazia.

**Ordem (cada aba é um PR separado, não uma entrega monolítica):**
1. Overview (dado que já existe: ficha do cliente, `client_users`+responsibility
   de P0.3).
2. Tasks (já existe — é o que o overlay atual já mostra; só migrar pra rota).
3. Team (responsáveis por responsabilidade — P0.3).
4. Conversations (P1.1-P1.3).
5. Demands (P1.4).
6. Briefs (P1.5).
7. Approvals (P1.9).
8. History/Brain (fora de escopo técnico deste plano — é o brain do Otto skill).

**Meta/Media:** explicitamente depois (P2/P3), confirmando a ordem que o próprio
usuário já deu no pedido.

**Files:** `apps/web/src/app/(shell)/clients/[id]/page.tsx` (rota nova — hoje é
overlay por `?id=`), migrar incrementalmente, mantendo o overlay funcionando até
a rota nova cobrir o mesmo conteúdo (não quebrar o fluxo atual no meio da
transição).

**Complexity:** L no total, mas cada aba individualmente S/M — exatamente por
isto deve ser 8 entregas, não 1.

---

### FASE P1.12 — Today

**Objective:** só depois de P1.4-P1.10 existirem com dado real — este plano
**não detalha o schema aqui** porque não precisa de nenhum: é uma tela de leitura
agregada sobre entidades que já existirão (conversations, demands, briefs,
approvals, tasks via TaskProvider).

**Tasks:** `GET /me/today` — agrega, por `role` + `client_users` do usuário:
conversas aguardando, demandas/briefs pendentes, tasks que dependem dele,
aprovações, (calendário quando P2 existir). Sem KPI inventado (§69 do prompt
master) — cada número vem de uma query real sobre entidade real.

**Dependencies:** P1.4, P1.5, P1.9 (dado real pra mostrar); idealmente P1.3
também.

**Complexity:** M.

---

## 12. P1 — Acceptance Test (end-to-end, executa a sequência completa)

Reaproveita o cenário que o próprio usuário descreveu no prompt master (§97) e
que já está encodado nesta sequência de fases:

1. Cliente manda WhatsApp (P1.2 — ou, se P1.2 ainda não tiver adapter real,
   inserir mensagem diretamente nas tabelas de P1.1 para testar o resto do fluxo
   sem depender do bloqueador externo).
2. Jamille recebe em `/inbox` (P1.3).
3. Cria Demand (P1.4), `ownerId` resolvido por `client_users.responsibility`
   (P0.3).
4. Gera Brief draft (P1.6), revisa, aprova versão (P1.5).
5. Envia para produção → Task no ClickUp certo do tenant (P1.7, usa resolver de
   P0.2).
6. Gui vê a task na fila dele (P1.8).
7. Pede aprovação (P1.9), Jamille/Tammy aprova (P1.10).
8. Tammy vê o ciclo inteiro no painel dela — **Manager Control Center é P2**, mas
   o DADO pra ele já existe ao fim de P1; a tela em si não é bloqueador deste
   teste, só precisa existir uma query ad hoc ou o controle center mínimo.
9. Bento consegue explicar o ciclo — **fora de escopo deste plano técnico**
   (é capability do agente sobre dado novo, não infraestrutura; Bento já lê de
   `operational_events`/`audit_logs`, que os eventos de P1.1-P1.9 já alimentam).

---

## P2 (detalhar só depois do P1 Acceptance Test passar)

### Calendar

**Schema novo:** `calendarEvents`, `calendarConnections` (reusa
`organization_connectors`, `provider='google_calendar'` — mesmo padrão de P1.2),
`routines`.

**Integração:** Google Calendar primeiro (OAuth + scoped connection +
incremental sync), exatamente a ordem que o próprio prompt master já definia
(§42) — concordo, não há achado que mude essa prioridade.

**Dependencies:** nenhuma de P1 estritamente, mas só ganha valor real depois de
Today (P1.12) e Cliente 360 (P1.11) existirem para mostrar o dado.

### Tool Gateway — herança de permissão genérica

**Objective:** generalizar o padrão já provado em
`bento-action-guard.ts:1548,1716` (`seniorToolContext.permissions.some(...)`)
para o nível do `gateway.ts`, sem reescrever o que já funciona.

**Tasks:**
1. `requestToolCall` (`gateway.ts:36`) passa a receber um `callerPermissions:
   Permission[]` opcional; quando presente, valida que a ferramenta solicitada
   corresponde a uma permissão que o chamador (não o agente) possui, **antes**
   de checar a matriz `agentTools`.
2. Adicionar coluna `riskCategory` (`SAFE_READ|SAFE_WRITE|SENSITIVE_WRITE|
   EXTERNAL_COMMUNICATION|FINANCIAL|DESTRUCTIVE`) em `agentTools` (migration
   aditiva), seedada em `packages/database/src/seed.ts` junto com as entradas
   existentes.
3. `bento-action-guard.ts` passa a **chamar** essa validação do gateway em vez
   de reimplementar — remove duplicação sem quebrar o comportamento atual
   (mesmo teste de regressão de hoje continua verde).

**Failure modes:** migrar Bento primeiro, confirmar paridade de comportamento
(mesmo resultado para os mesmos casos de teste existentes) antes de qualquer
segundo agente usar o mecanismo novo.

**Acceptance criteria:** um sexto agente hipotético herdaria a checagem
automaticamente, sem copiar código — é o teste de "generalização real" vs.
"documentação de intenção".

### Manager Control Center

Só depois de P1 entregar dado real — não antecipar schema aqui; é
essencialmente queries agregadas sobre entidades que já existirão
(demands/briefs/approvals/tasks/client_users), mais Calendar quando existir.

---

## P3 (arquitetura apenas — não implementar neste ciclo)

- **Meta Ads:** `client-meta-accounts` já existe como mapping; quando for a
  hora, seguir o mesmo padrão de connector (`organization_connectors`,
  `provider='meta_ads'`) + um `MediaProvider` espelhando `TaskProvider`/
  `CommunicationProvider`. Jarbas (código do agente) já existe e consome assim
  que a integração existir — não é o gargalo.
- **Suzy:** não construir nenhum código antes do canal (WhatsApp, P1.2) existir
  de verdade. Quando existir, Suzy é especialista SOBRE o Communications Domain
  (P1.1) — não um sistema de conversa paralelo.
- **Module Registry configurável:** só depois de Role Templates existirem (não
  estão neste plano — o Gap Analysis já marcou como P3 e este plano concorda:
  não há consumidor real pra um registry configurável ainda).

---

## 5. Migration Plan (ordem exata)

| # | Nome (provável) | Fase | Conteúdo | Destrutiva? |
|---|---|---|---|---|
| 0056 | `client_users_responsibility` | P0.3 | +coluna, troca unique constraint | Não |
| 0057 | `communications_domain` | P1.1 | +4 tabelas novas | Não |
| 0058 | `demands` | P1.4 | +1 tabela | Não |
| 0059 | `briefs_and_versions` | P1.5 | +2 tabelas, +2 colunas em briefs (P1.7) | Não |
| 0060 | `approval_requests` | P1.9 | +1 tabela | Não |
| 0061 | `agent_tools_risk_category` | P2 | +1 coluna enum em agentTools | Não |
| 0062+ | Calendar | P2 | `calendarEvents`, `calendarConnections`, `routines` | Não |

Todas aditivas, nenhuma dropa ou renomeia coluna existente, consistente com
§90-91 do prompt master. Nenhuma migration desta lista precisa de backfill
custoso como a 0045 (memories/conversations) — todas as tabelas novas nascem
vazias ou com coluna nullable.

---

## 6. API Plan (novo, consolidado)

| Método | Rota | Fase | Permission |
|---|---|---|---|
| GET/PUT | `/clients/:id/assignments` | P0.3 | `clients:write` |
| GET | `/team/members/:id/assignments` | P0.3 | `team:read` (existente) |
| GET | `/conversations` | P1.3 | `conversations.read` |
| GET | `/conversations/:id/messages` | P1.3 | `conversations.read` |
| POST | `/conversations/:id/messages` | P1.3 | `conversations.write` |
| PATCH | `/conversations/:id/assign` | P1.3 | `conversations.write` |
| POST | `/webhooks/whatsapp` | P1.2 | público (HMAC) |
| POST | `/demands` | P1.4 | `demands.write` |
| GET | `/demands` | P1.4 | `demands.read` |
| PATCH | `/demands/:id` | P1.4 | `demands.write` |
| POST | `/briefs` | P1.5 | `briefs.write` |
| POST | `/briefs/:id/versions` | P1.5 | `briefs.write` |
| PATCH | `/briefs/:id/approve-version` | P1.5 | `briefs.write` |
| POST | `/demands/:id/draft-brief` | P1.6 | `briefs.write` |
| POST | `/briefs/:id/send-to-production` | P1.7 | `briefs.write`+`tasks.write` |
| GET | `/tasks/views/:viewId` | P1.8 | `tasks.read` |
| POST | `/approvals` | P1.9 | `approvals.write` |
| GET | `/approvals` | P1.9 | `approvals.read` |
| PATCH | `/approvals/:id` | P1.9 | `approvals.write` |
| GET | `/me/today` | P1.12 | implícito (dado do próprio usuário) |

Todas atrás do mesmo middleware de organização já usado em
`apps/api/src/server.ts` — nenhuma rota nova inventa seu próprio mecanismo de
auth.

---

## 7. Data Model (entidades novas e relações)

```
organizations ──< client_users >── users
     │                │ (+ responsibility)
     │                │
     ├──< clients >────┘
     │       │
     │       ├──< contacts
     │       ├──< conversationThreads >── contacts
     │       │         │
     │       │         └──< threadMessages
     │       ├──< demands >── conversationThreads (nullable)
     │       │       │
     │       │       └──< briefs >──< briefVersions
     │       │             │  (approvedVersionId → briefVersions.id)
     │       │             └── externalTaskId (→ TaskProvider, não FK local)
     │       └──< approvalRequests (resourceType/resourceId genérico,
     │                               aponta pra briefs/tasks/etc. por convenção,
     │                               não FK — resourceType decide a tabela)
     └──< organization_connectors (provider: clickup | whatsapp | google_calendar)
```

---

## 8. Authorization Matrix (Member × Module × Resource × Action)

Extensão de `TETO_POR_PAPEL` (`packages/mcp-domain/src/scopes.ts`) — 5 scopes
novos, mesma convenção `<recurso>.read`/`<recurso>.write`:

| Papel | conversations | demands | briefs | approvals | calendar |
|---|---|---|---|---|---|
| SUPER_ADMIN | read+write | read+write | read+write | read+write | read+write |
| MANAGER | read+write | read+write | read+write | read+write | read+write |
| CUSTOMER_SUCCESS | read+write | read+write | read+write | read | read |
| CREATIVE | read | read | read+write | read+write | read |
| TRAFFIC_MANAGER | read | read | read | read | read+write |
| QA | read | read | read | read | read |
| VIEWER | read | read | — | — | read |

Justificativa pontual: CREATIVE escreve brief (produção de peça) e aprovação
(propõe entrega pra aprovação), mas não cria demanda (não é quem recebe o
pedido do cliente) nem edita calendário (não agenda reunião com cliente).
TRAFFIC_MANAGER escreve calendário (agenda própria de campanha) mas não brief
(não é quem redige). Ajustável antes de implementar — esta é uma proposta, não
uma imposição; validar com quem conhece o dia a dia de cada função antes de
travar em código.

---

## 9. Integration Contracts

```ts
// Já existe — não mudar assinatura
interface TaskProvider {
  listTasks(filter): Promise<ProviderTask[]>
  getTask(id): Promise<ProviderTask>
  createTask(input): Promise<ProviderTask>
  updateTask(id, patch): Promise<ProviderTask>
  addComment(id, comment): Promise<void>
}

// Novo — P1.2, mesma forma
interface CommunicationProvider {
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendMessage(threadId, content, attachments?): Promise<ExternalMessage>
  syncConversations(since?): Promise<ConversationSummary[]>
  health(): Promise<ProviderHealth>
}

// Novo — P2, mesma forma
interface CalendarProvider {
  connect(): Promise<void>
  listEvents(range): Promise<CalendarEvent[]>
  createEvent(input): Promise<CalendarEvent>
  health(): Promise<ProviderHealth>
}

// Stub — P3, não implementar
interface MediaProvider {
  listCampaigns(accountId): Promise<Campaign[]>
  getMetrics(campaignId, range): Promise<MetricSnapshot>
}
```

Todos resolvidos por `organization_connectors` + um `resolve<X>Provider(organizationId)`
análogo a `resolveTaskProvider` — mesmo padrão, 3 implementações.

---

## 10. Event Model

| Evento | Produzido em | Consumido por (hoje) |
|---|---|---|
| `CLIENT_ASSIGNMENT_CHANGED` | P0.3 | `operational_events` (pipeline existente) |
| `CONVERSATION_CREATED` | P1.1 | idem |
| `MESSAGE_RECEIVED` / `MESSAGE_SENT` | P1.1/P1.2 | idem; candidato a `proactive_signals` (mensagem sem resposta > 2h) |
| `CONVERSATION_ASSIGNED` | P1.3 | idem |
| `DEMAND_CREATED` / `DEMAND_STATUS_CHANGED` | P1.4 | idem |
| `BRIEF_CREATED` / `BRIEF_VERSION_CREATED` / `BRIEF_APPROVED` | P1.5 | idem |
| `TASK_CREATED_FROM_BRIEF` | P1.7 | idem |
| `APPROVAL_REQUESTED` / `APPROVAL_RESOLVED` | P1.9 | idem; `audit_logs` direto |

Nenhum evento novo precisa de um Event Bus novo — todos entram no pipeline
`PendingEvent→NormalizedEvent→SignalCandidate` já existente (Gap Analysis
§1.13), que já é fonte-agnóstica.

---

## 11. Frontend Information Architecture

```
/inbox          (P1.3, novo)
/clients/[id]   (P1.11, substitui overlay — abas incrementais)
/approvals      (P1.10 — rota já existe, verificar conteúdo atual antes de mexer)
/tasks          (existe — ganha modo board em P1.8, mesma rota)
/me/today → /today  (P1.12, novo — nome de rota a confirmar junto da API)
```

Sidebar (`nav-items.ts`): adicionar `/inbox` e `/today` ao array `NAV_ITEMS`
existente, `section: 'dia'`, sem flags especiais (visível pra quem tem o scope
correspondente — a visibilidade por capability real só chega no Module
Registry de P3; até lá, visibilidade por papel como já é hoje).

---

## 12. E2E Test Plan

| Persona | Cenário |
|---|---|
| Jamille (CUSTOMER_SUCCESS) | Recebe WhatsApp, cria demand, gera brief, aprova, envia pra produção |
| Gui (CREATIVE) | Vê task na fila, não vê Meta Ads, não cria demand |
| Alicia (TRAFFIC_MANAGER) | Não vê inbox de outro cliente que não atende, vê calendário (P2) |
| Tammy (MANAGER) | Vê conversas/demandas/briefs/approvals de toda a carteira que administra |
| Endrigo (SUPER_ADMIN/provider) | Vê tudo, não escreve em tenant sem trocar contexto ativo (reusa `podeEscreverNaOrganizacao`) |
| Tenant A / Tenant B | Nenhuma conversa/demand/brief/approval de A aparece pra B, em nenhuma das rotas novas |

Já existe disciplina e infraestrutura de teste pra isto (Gap Analysis §1.14) —
estender os arquivos existentes (`escopo-de-organizacao.test.ts`,
`hierarquia-de-organizacao.test.ts`) com os cenários das entidades novas, não
criar uma suíte de isolamento paralela.

---

## 13. Security Gates

- **Cross tenant:** toda entidade nova carrega `organization_id` direto (não só
  via join, ao contrário de `client_users`) — decisão deliberada para P1.1/P1.4/
  P1.5/P1.9, porque mensagens/demandas/briefs/aprovações podem existir em volume
  alto e precisam de index direto pra `escopoDeOrganizacao` não degradar (§102).
- **Secret isolation:** `organization_connectors` já mascara credencial na
  leitura (`mascararCredenciais`, regex `/key|token|secret|password/i`) — a
  extensão para `whatsapp`/`google_calendar` herda isso automaticamente, não
  precisa reimplementar.
- **AI permission inheritance:** generalizado em P2 (Tool Gateway), mas P1 já
  nasce correto nos novos endpoints porque usam o middleware de permission
  existente, não o Tool Gateway de agente — a lacuna de hoje é especificamente
  "ação de AGENTE", não "ação de usuário via API".
- **Provider hierarchy:** nenhuma mudança necessária — `orgsVisiveisParaLeitura`/
  `podeEscreverNaOrganizacao` já se aplicam a qualquer tabela com
  `organization_id`, incluindo as novas.

---

## 14. Observability

Métricas novas a instrumentar (reusar o padrão de logging já existente,
`packages/logging`):
- Lag webhook→mensagem-visível-no-inbox (P1.2/P1.3) — se o WhatsApp confirma
  entrega mas o inbox demora a mostrar, é sintoma de fila/worker, não de UI.
- Idade da fila de `approvalRequests` pendentes por organização (P1.9) —
  insumo direto do Manager Control Center (P2), não esperar o control center
  pra começar a coletar.
- Taxa de conversão Demand→Brief→Task→Approval→Done, por cliente — mesmo
  cuidado do prompt master contra "produtividade inventada" (§69): é contagem
  real de estado, não estimativa.
- Contagem de negações de autorização (`AUTHORIZATION_DENIED`, seção P0.1) —
  se subir depois do deploy de P0.1, é sinal de regra nova bloqueando caso
  legítimo não prevsignto (ex.: usuário multi-org), não necessariamente ataque.

---

## 15. Source Control Risk

**Estado observado, não assumido:** o `git status --short` capturado durante a
auditoria deste plano listou ~103 arquivos modificados nos primeiros bytes de
saída (truncados pelo limite de exibição), todos em `apps/api`, `apps/mcp`,
`apps/web`, `apps/worker`, `packages/auth`, `packages/context-engine`,
`packages/database`, `packages/mcp-domain`, `packages/openai-provider`,
`packages/orchestrator`, `packages/router`, `packages/tool-gateway` — **nenhum**
caminho sob `packages/otto-motion/` apareceu na porção capturada. Isso sugere
que o trabalho de motion engine já está commitado (anterior aos 5 commits
"2.0" no topo do branch) e que o working tree não commitado é inteiramente
"2.0"/multiempresa — mas a lista completa (214 arquivos, por contagem anterior)
não foi enumerada por inteiro nesta sessão.

**Recomendação (não executada):** antes de qualquer commit futuro neste branch,
rodar:
```bash
git status --short | awk '{print $2}' | grep -c '^packages/otto-motion/'
git status --short | awk '{print $2}' > /tmp/arquivos-modificados.txt
wc -l /tmp/arquivos-modificados.txt
```
Se a contagem de `otto-motion` for zero, o branch pode ser commitado como está
(um único propósito: "2.0"/multiempresa) sem risco de mistura — só o NOME do
branch estaria desalinhado com o conteúdo, o que se resolve renomeando
(`git branch -m`) antes do PR, não fazendo reset/rebase.
Se a contagem for maior que zero, separar em commits por propósito antes de
abrir PR (`git add -p` seletivo), nunca um commit único misturando os dois.

**Não fiz nenhuma dessas ações** — nem commit, nem rename, nem stash. É
recomendação para quando a decisão de commitar for tomada, por quem decide.

---

## 16. Implementation Order (fila linear)

**NEXT (primeiro arquivo a tocar quando a implementação começar):**
`apps/api/src/admin/routes.ts`, linhas 221-354 — adicionar a checagem de
organização nas 4 rotas de mutação (P0.1, item 1). É o bug mais grave medido
neste plano (privilege escalation cross-tenant real), a mudança é isolada (1
arquivo, sem migration, sem dependência), e o padrão de correção
(`podeEscreverNaOrganizacao`) já existe pronto para reuso.

**AFTER NEXT:**
1. `apps/worker/src/processors/execute-job.ts:1488-1489` (P0.1 item 2 — leak
   cross-tenant ativo em produção).
2. `apps/mcp/src/server.ts:172-176` (P0.2 item 2 — o fix mais barato do bypass
   de ClickUp, parâmetro já existe, só não é usado).
3. Restante de P0.1 (itens 3-5) e P0.2 (itens 1, 3, 4) em paralelo — arquivos
   independentes.
4. P0.3 (migration 0056).
5. P0 CHECKPOINT.

**LATER:**
Toda a fila P1 (seção dependency graph) — não começar antes do P0 CHECKPOINT
sair `READY`.

---

## 17. Stop Conditions

Parar e pedir autorização explícita antes de:

1. **Escolher a API de WhatsApp** (Business API oficial vs. Evolution API vs.
   outra) — custo externo recorrente, contrato com terceiro, decisão que a
   documentação legada sugere já ter sido tomada uma vez em outro sistema e
   merece revalidação, não reinvenção (P1.2).
2. **Qualquer migration que não seja puramente aditiva** — nenhuma está
   planejada aqui, mas se a implementação real revelar necessidade de alterar/
   remover coluna existente, parar antes de escrever o SQL.
3. **Qualquer ação de source control destrutiva** no branch atual (reset,
   rebase, checkout destrutivo, rename de branch com histórico compartilhado)
   — mesmo a recomendação da seção 15 é só recomendação.
4. **Qualquer alteração em `bento-action-guard.ts` que mude o resultado de um
   teste hoje verde** — a generalização de P2 deve ser estritamente aditiva ao
   comportamento observável; se um teste existente precisar mudar de
   expectativa, parar e confirmar que é intencional.
5. **Expor qualquer credencial** (`organization_connectors.credentials`,
   mascarado hoje) em qualquer resposta nova, mesmo que não pareça sensível à
   primeira vista (ex.: debug endpoint, log verboso em dev).
6. **Gerar custo externo mensurável** (conta de sandbox paga de WhatsApp/
   Google Calendar além do tier gratuito, número de telefone dedicado, etc.).

---

## READY TO IMPLEMENT: YES

(Para a FASE P0.1 item 1 especificamente — as fases seguintes de P0 também
estão prontas para começar em paralelo; P1 depende do checkpoint P0 e, em
P1.2, de uma decisão externa ainda não tomada.)

**FIRST IMPLEMENTATION SLICE:**
Corrigir `apps/api/src/admin/routes.ts` (linhas 221-354) para validar que o
usuário-alvo das 4 rotas de mutação pertence a uma organização que o chamador
pode administrar, usando `podeEscreverNaOrganizacao`
(`packages/auth/src/hierarquia-de-organizacao.ts`), retornando 404 quando não.

**WHY THIS SLICE FIRST:**
É o único achado deste plano que é uma vulnerabilidade de autorização ativa
(privilege escalation cross-tenant, incluindo deleção de usuário), não uma
lacuna arquitetural. Correção é cirúrgica (1 arquivo, ~30 linhas), sem
migration, sem dependência de nenhuma outra fase, e o mecanismo de correção já
existe testado em outro lugar do código.

**FILES LIKELY TO CHANGE:**
`apps/api/src/admin/routes.ts` (as 4 rotas), possivelmente
`apps/api/src/admin/routes.test.ts` (ou arquivo de teste equivalente, a
confirmar nome exato — não visto na validação, criar se não existir).

**MIGRATIONS REQUIRED:**
Nenhuma para este slice. Migration 0056 entra na fase seguinte (P0.3).

**TESTS REQUIRED:**
Caso novo: "master da organização A não consegue promover/demitir/renomear/
deletar usuário cuja única organização é B" — 4 variações (uma por rota),
mais o caso legítimo "master consegue agir sobre usuário da própria
organização" (não regredir o caminho feliz).

**BLOCKERS BEFORE START:**
Nenhum técnico. Único ponto de atenção: confirmar com quem decide se existe
hoje, em produção, algum fluxo legítimo que dependa do comportamento atual
(improvável para uma falha de autorização, mas vale a pergunta de 1 frase antes
de corrigir algo que está em produção).
