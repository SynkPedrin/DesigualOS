# Gap Analysis — Desigual OS → Agency Operating System

**Data:** 05/10/2026 · **Branch:** `feat/otto-motion-engine` (214 arquivos não commitados,
5 commits à frente de `main`, todos rotulados `feat(2.0)`/`fix(2.0)`/`fix(multiempresa)` —
o nome do branch não reflete o trabalho nele; ver nota operacional no fim)

**Escopo:** Fase 0 do prompt "Agency Operating System" — auditoria antes de qualquer
código novo. Este documento **não repete** o que já está medido em
`desigual-2.0-inventario-web-api.md` e `desigual-2.0-inventario-mcp-backend.md`
(ambos de 30/09/2026); ele parte de onde os dois pararam e cobre os domínios que
faltavam: equipe/convite, task engine, briefing/WhatsApp, aprovação, calendário,
agentes de IA, Tool Gateway, Meta/Google, frontend (sidebar, Hoje, Cliente 360,
command palette), audit log.

Tudo abaixo foi medido no código (grep/leitura direta), não estimado.

---

## 0. O achado que muda a leitura do prompt master

O prompt pede para "transformar" o produto como se a fundação (Provider → Tenant →
Member, RBAC, isolamento, convite) não existisse. **Ela existe, e é mais madura do
que o prompt assume.** Exemplo central: `packages/auth/src/hierarquia-de-organizacao.ts`
já implementa a regra "agência administra subcontas" com uma assimetria deliberada —
**leitura desce, escrita nunca atravessa** (quem administra a empresa ativa lê toda a
subárvore; escrever exige entrar na subconta). Isso é estritamente mais específico que
o `RBAC + Capability + Resource Scope` genérico do prompt (§8), e substituí-lo por algo
genérico seria regressão, não evolução.

**Implicação prática:** a Fase 1 ("Foundation") do prompt master já está em andamento,
não em zero. O trabalho real que falta é mais estreito do que o prompt sugere — ver
matriz abaixo.

---

## 1. Matriz por domínio

Formato: **CURRENT** (medido) · **TARGET** (o que o prompt pede) · **DECISÃO**
(KEEP/CHANGE/CREATE/REMOVE) · **RISK** quando relevante.

### 1.1 Identidade, hierarquia de tenant, RBAC

- **CURRENT:** `organizations` + `organization_members`, hierarquia pai/filho
  (`hierarquia-de-organizacao.ts`), `escopo-de-organizacao.ts` (`organizationIds`,
  `ehProvider` — nunca só por papel, exige `PROVIDER_ORGANIZATION_ID`), RBAC de função
  via `packages/mcp-domain/src/scopes.ts` (7 papéis, teto de scopes). 9→15 de 77 tabelas
  com `organization_id` após a migração 0045 (memories, conversations, messages,
  executions, agent_episodes, proactive_signals).
- **TARGET:** Provider/Organization/Member/RoleTemplate/Capability/ResourceScope (§2-9).
- **DECISÃO:** **KEEP** a hierarquia e o RBAC por função — são o que o prompt pede, com
  nomes diferentes e uma regra (leitura desce/escrita não atravessa) que o prompt nem
  cobre. **CHANGE**: generalizar `tenantSharingScope`/`escopo-de-organizacao` para os
  módulos que ainda só checam papel sem organização (`admin`, `chat`, `clickup`, `costs`,
  `data-quality`, `health`, `integrations`, `nodes`, `studio` — 9 módulos, por
  `desigual-2.0-inventario-web-api.md §2.2`) e os que não checam nenhum dos dois
  (`collaborators`, `team`, `mcp-status`, `panorama` — §2.3, ainda mais grave: devolvem
  lista de pessoas de outra empresa).
- **RISK:** enquanto os 9+4 módulos acima não fecharem, a fronteira de tenant tem
  buracos conhecidos e já documentados — não é risco novo, é risco já medido e ainda
  aberto.

### 1.2 Equipe / Convite / Role Templates / Client Assignments

- **CURRENT:** convite real (`apps/api/src/lib/convite.ts`, e-mail HTML via Resend com
  link de `generateLink` do Supabase, JIT provisioning em
  `packages/auth/src/provisioning.ts`). Papéis são **strings cruas** (plataforma:
  `master`/`colaborador`; organização: `owner`/`admin`/`collaborator`) — sem conceito de
  "template" (bundle configurável de capabilities). `clientUsers`
  (`packages/database/src/schema/clients.ts`) liga membro↔cliente com **uma coluna de
  papel** (`viewer` default) — sem tipo de responsabilidade (conta/tráfego/design) nem
  múltiplas responsabilidades por pessoa por cliente.
- **TARGET:** RoleTemplate (preset) + overrides + ClientAssignment com `responsibility`
  (§5-8, §71).
- **DECISÃO:** **KEEP** convite e provisioning (sólidos, testados). **CREATE**:
  RoleTemplate como camada fina sobre o RBAC existente (preset = conjunto de
  capabilities, não substitui o RBAC) e `ClientAssignment` com `responsibility` tipado,
  substituindo a coluna única de `clientUsers` ou estendendo-a — decisão de migração,
  não de rewrite.

### 1.3 Module Registry / Sidebar dinâmica / Frontend shell

- **CURRENT:** `apps/web/src/components/shell/nav-items.ts` — array estático
  (`NAV_ITEMS`) com flags (`masterOnly`, `providerOnly`, `contexto`, `administracao`)
  resolvidas por hooks (`useIsMaster`, `me.eh_provider`, tenant ativo). Funciona por
  **papel + contexto**, não por `allowedModules[]` configurável por membro.
  `command-palette.tsx` existe e é real: Cmd/Ctrl+K, busca cliente, filtra os mesmos
  itens de nav visíveis, navega.
- **TARGET:** ModuleRegistry + `allowedModules[]` por membro (§10, §74).
- **DECISÃO:** **CHANGE, não CREATE** — a camada de visibilidade já existe
  (`itensVisiveisNaNavegacao`); o que falta é a fonte da verdade deixar de ser
  papel+contexto embutido no código e passar a ler de capabilities por membro. Risco de
  over-engineering aqui: só vale a pena se e quando role templates (1.2) existirem —
  construir um registry configurável antes de ter o que configurar é trabalho
  especulativo.

### 1.4 Tela "Hoje" (Personal Workbench)

- **CURRENT:** **não existe.** Nenhuma rota `/today` em `apps/web/src/app`.
- **TARGET:** §17-18 — dashboard pessoal por função, montado por widgets.
- **DECISÃO:** **CREATE.** Mas é P1, não P0: depende de ter Task/Approval/Calendar reais
  para ter conteúdo — construir "Hoje" antes deles é tela vazia com nome bonito,
  exatamente o que §82 (empty states) pede para evitar.

### 1.5 Cliente 360

- **CURRENT:** `apps/web/src/app/(shell)/clients/page.tsx` — grid plano
  (`ClientGrid`) + `ClientDetailOverlay` (overlay por `?id=`, não rota própria) que hoje
  só mostra tarefas do ClickUp ("Buscando tarefas no ClickUp…"). Não agrega
  conversas/briefings/campanhas — porque essas entidades não existem ainda (1.7, 1.8).
- **TARGET:** §19 — página canônica com Overview/Conversas/Demandas/Briefings/Tarefas/
  Calendário/Campanhas/Aprovações/Equipe/Conhecimento/Histórico.
- **DECISÃO:** **CHANGE** o overlay para rota própria (`/clients/[id]`) **incrementalmente**,
  uma aba por vez, na ordem em que as entidades (1.7, 1.8, 1.9) forem existindo. Construir
  as abas antes do dado que elas mostrariam é mock disfarçado (§101 proíbe isso
  explicitamente).

### 1.6 Task Engine / ClickUp

- **CURRENT:** abstração real — `TaskProvider` (`packages/tool-gateway/src/task-provider.ts`,
  interface `listTasks/getTask/createTask/updateTask/addComment`), adapter ClickUp
  (`clickup-task-provider-adapter.ts`), resolver por config de organização
  (`task-provider-resolver.ts`, nunca cai em fallback global quando a empresa tem
  conector próprio — decisão de isolamento deliberada). **Mas** os caminhos de escrita
  (`apps/api/src/clickup/*`, `apps/mcp/src/providers/clickup-task-provider.ts`,
  `bento-action-guard.ts`) ainda montam `ClickUpConfig` direto de env var, por fora do
  resolver — o próprio código comenta isso como pendência. Sem tabela `tasks` nativa:
  ClickUp é fonte única da verdade. Sem kanban na UI (linhas, não board).
- **TARGET:** TaskProvider abstraction, ClickUp como implementação, views por kanban
  (§26-28).
- **DECISÃO:** **KEEP** a abstração — é exatamente o que o prompt pede e já existe.
  **CHANGE**: migrar os 3 caminhos de escrita hardcoded para o resolver (risco de
  inconsistência: uma empresa com conector próprio pode ter escrita indo pro ClickUp
  errado hoje). **CREATE** views kanban como leitura sobre o provider — não precisa de
  tabela nativa pra isso.

### 1.7 Briefing / Demanda / WhatsApp

- **CURRENT:** **nada.** Zero arquivo com "whatsapp" no nome, zero schema `Brief`/
  `BriefVersion`/`Demand`. "Briefing"/"demanda" só existem como vocabulário livre dentro
  de classificadores de NLU (`packages/context-engine/src/campaign-derivation.ts`,
  `packages/router/src/*`) — não como entidade persistida.
- **TARGET:** §20-25 — Inbox, Demand→Brief→BriefVersion→Task, candidatos de
  conhecimento.
- **DECISÃO:** **CREATE**, do zero. É o maior gap do documento inteiro e o único onde
  "não existe" é literal, não "existe parcial". É também o core workflow do negócio
  (§86) — o que o prompt chama de principal acceptance test. Prioridade alta, mas
  depende de 1.6 (Brief→Task) e se beneficia de 1.2 (responsabilidade por cliente) já
  existir primeiro.

### 1.8 Aprovação

- **CURRENT:** aprovação existe **só no nível de tool call**: `agent_tools.requires_approval`
  (boolean), fluxo `requestToolCall`/`notifyMastersOfPendingApproval`/`approveToolCall`
  em `packages/tool-gateway/src/gateway.ts`, mais um protocolo textual
  `[AGUARDA_APROVACAO]...[/AGUARDA_APROVACAO]` parseado em `packages/types/src/text.ts`
  para ações propostas por agente dentro do chat. Não existe `ApprovalRequest` genérico
  por `resourceType`/`resourceId` (criativo, brief, orçamento).
- **TARGET:** §32, §106-107 — approval engine genérico + categorias de risco
  (SAFE_READ…DESTRUCTIVE).
- **DECISÃO:** **CREATE** o `ApprovalRequest` genérico; **KEEP** o gate de tool-call
  (não é o mesmo problema — um é "a IA pode executar isto", o outro é "este recurso de
  negócio está aprovado"). **CREATE** a taxonomia de categoria — hoje é um único
  booleano, sem nuance entre "mandar mensagem externa" e "deletar cliente".

### 1.9 Calendário

- **CURRENT:** **nada.** Zero OAuth Google Calendar, zero serviço de calendário. Só
  ícones (`CalendarDays`/`CalendarClock`) em linhas de tarefa e uma coluna "Agenda" em
  automações (rótulo de cron, não calendário de verdade).
- **TARGET:** §35-37, §42 — Calendar Service unificado, Google Calendar, Routines.
- **DECISÃO:** **CREATE**, do zero. Prompt master já prioriza Google Calendar como
  primeira integração Google (§42) — concordo com a ordem: é a de menor superfície de
  OAuth e maior valor imediato para "Hoje" (1.4) e Cliente 360 (1.5).

### 1.10 Agentes de IA (Bento/Jarbas/Otto/Suzy/Studio) + Tool Gateway

- **CURRENT:** `packages/types/src/agent.ts` define os 5 nomes como tipo, não como
  roster operacional. **Bento** e **Jarbas**: código real e substancial
  (`packages/bento-core`, dezenas de processors em `apps/worker`,
  `packages/agent-runtime/src/jarbas-*`). **Otto**: já mapeado (skill + node, dois
  sistemas distintos — ver CLAUDE.md do projeto). **Studio**: `nodes/studio-node` é um
  pipeline de produção (ComfyUI, brand-compositor, visual-critic) — não um agente
  conversacional como Bento/Jarbas. **Suzy**: **não existe código nenhum** neste
  repositório — só o nome no tipo e documentação de um sistema legado separado
  (`agentes-desigual`, fora deste repo).
- **Tool Gateway / herança de permissão:** `gateway.ts` tem uma matriz estática
  agente↔ferramenta (`agentTools`), **independente do usuário que pediu a ação**.
  A regra "IA não pode ter mais permissão que o usuário" (§9) **existe, mas só para
  Bento+ClickUp**, implementada ad hoc em
  `apps/worker/src/processors/bento-action-guard.ts:1083-1098` (exige que
  `seniorToolContext.permissions` já prove `clickup:write` via o papel do usuário
  chamador) — não é mecanismo do gateway, é checagem local de um processor.
- **TARGET:** §44-51 — 5 agentes unificados sobre o mesmo Tool Gateway, com herança de
  permissão genérica e categorias de risco.
- **DECISÃO:** **KEEP** Bento/Jarbas/Otto como estão — maduros, não reconstruir.
  **REMOVE/não criar agora** Suzy como feature nova: é a maior ambição do prompt nesta
  seção e a que tem menos chão — exigiria replicar o padrão bento-action-guard para um
  agente que não existe, num canal (WhatsApp) que também não existe (1.7). **CHANGE**:
  generalizar a herança de permissão de `bento-action-guard` para o nível do Tool
  Gateway (hoje funciona, mas é frágil — um sexto agente repetiria o mesmo código
  manualmente, exatamente o que §83 do prompt pede pra evitar). **CREATE**: taxonomia
  de categoria de risco (1.8) aplicada no gateway, não só em Bento.

### 1.11 Meta Ads / Google

- **CURRENT:** `client-meta-accounts.ts` é só uma tabela de mapeamento (clientId →
  accountId do Meta Ads) — o próprio comentário do arquivo diz que a fonte real mora
  fora deste repo (`agentes-desigual/clientData.js`). Zero OAuth, zero client de Graph
  API, Google Ads, GA4 ou Google Calendar.
- **TARGET:** §38-41, §46, §42-43 — Meta Ads module + Jarbas tools + Google ecosystem.
- **DECISÃO:** **CREATE**, do zero, em P2 — depois de Calendar (1.9) e depois do core
  workflow (1.7) estarem de pé. Jarbas (código do agente) já existe e pode consumir a
  integração assim que ela existir; não é o gargalo.

### 1.12 Audit Log

- **CURRENT:** `audit_logs` (`packages/database/src/schema/observability.ts`) — já tem
  `userId`, `agent`, `clientId`, `organizationId`, `employeeId`, `tool`, `resourceType`,
  `resourceId`, `oldValue`/`newValue`, `requestId`, `sessionId`, `source`, `metadata`,
  `timestamp`. Escrito de muitos pontos (MCP, API, worker, provisioning).
- **TARGET:** §80 — actor + on_behalf_of + resource + action + timestamp + correlation id.
- **DECISÃO:** **KEEP**, quase completo. **CHANGE** pequeno: não há coluna explícita
  `on_behalf_of` — hoje aproximado por `agent`+`userId`+`employeeId`. Baixo esforço,
  baixo risco, vale fechar.

### 1.13 Event Bus

- **CURRENT:** não existe um `EventBus` genérico com consumidores registrados. Existe um
  pipeline (`PendingEvent → NormalizedEvent → SignalCandidate`, documentado em
  `desigual-2.0-inventario-mcp-backend.md §1.3`) específico para eventos
  operacionais→sinais, hoje alimentado por ClickUp (webhook) e MCP (chat).
- **TARGET:** §57-58 — Event Bus canônico, módulo→evento→bus→consumidores (Brain,
  Notifications, Automation, Analytics, Audit, AI, Integrations).
- **DECISÃO:** **CHANGE** a forma, não criar do zero — o pipeline já é genérico o
  bastante pra receber novas fontes (confirmado no inventário MCP). Generalizar quando
  a segunda fonte de eventos (WhatsApp, 1.7) existir; construir o bus genérico antes
  disso é arquitetura sem consumidor real.

### 1.14 Testes

- **CURRENT:** 272 arquivos de teste. Isolamento de tenant já tem cobertura real:
  `fronteira-de-organizacao.test.ts`, `escopo-de-organizacao.test.ts`,
  `hierarquia-de-organizacao.test.ts`, `organizacao-da-escrita.test.ts`,
  `membros.test.ts`, `contexto.test.ts` — não é teoria, está testado.
- **TARGET:** §93-96 — unit + integration + authorization + tenant isolation + runtime +
  browser E2E.
- **DECISÃO:** **KEEP** e **estender** — a disciplina de teste já existe para a fundação;
  cada domínio novo (1.7, 1.8, 1.9) precisa herdar o mesmo padrão desde o primeiro
  commit, não como débito depois.

---

## 2. O que isso muda na priorização do prompt master (§121)

O prompt assume P0 = "Security/tenant, Members/permissions, Client 360, Task
abstraction, Core workflow" como se tudo estivesse em zero. Medido, a ordem real de
esforço restante é:

**P0 — fechar o que já está em andamento, não recomeçar:**
1. Fechar os 13 módulos de `apps/api` sem recorte de organização completo (1.1) —
   trabalho já identificado, não descoberto agora.
2. Migrar os 3 caminhos de escrita do ClickUp para o `TaskProvider` resolver (1.6) —
   risco de inconsistência ativo, não hipotético.
3. `ClientAssignment` com responsabilidade tipada (1.2) — pré-requisito barato para
   Cliente 360 (1.5) e para o core workflow (1.7) saberem "quem é o designer desta
   tarefa".

**P1 — o core workflow que de fato não existe:**
4. WhatsApp → Demanda → Briefing → Task (1.7) — o maior gap real, e o acceptance test
   de negócio do prompt (§86/§97).
5. Approval Engine genérico (1.8), porque o core workflow termina em aprovação.
6. Cliente 360 como rota própria, aba por aba, conforme 1.7/1.8 entregam dado (1.5).
7. Tela "Hoje" (1.4), depois de 1.7/1.8 terem conteúdo pra mostrar.

**P2 — depois do core workflow provado:**
8. Calendar + Google Calendar (1.9).
9. Herança de permissão genérica no Tool Gateway + taxonomia de risco (1.10).
10. Manager Control Center (depende de 1.7/1.8 terem dado real de carga/atraso).

**P3 — explicitamente depois:**
11. Meta Ads / Google Ads / GA4 (1.11).
12. Suzy como agente real (1.10) — só depois do canal (WhatsApp) existir.
13. Module Registry configurável (1.3) — só depois de Role Templates (1.2) dar o que
    configurar.

---

## 3. Nota operacional (não é gap de produto)

O branch atual (`feat/otto-motion-engine`) tem 214 arquivos modificados não
commitados e 5 commits à frente de `main`, e **nenhum** desse trabalho é sobre motion
engine — é todo o esforço "2.0"/multiempresa (organizations, escopo, mcp-domain,
router, tool-gateway, orchestrator). Isso não é um problema de arquitetura, mas vale
sinalizar antes de qualquer commit futuro neste branch: misturar o motion engine com
o trabalho de tenant quando um dos dois for commitado pode gerar um diff ilegível ou
um PR que mistura dois propósitos. Não tomei nenhuma ação sobre isso (sem commit, sem
reset) — é só um alerta para quando chegar a hora de organizar o branch.

---

## 4. Próximo passo

Este documento é a entrega da Fase 0 (§87, §119). O prompt master pede, como passo
seguinte (§120), um **plano de implementação real** — Phase/Tasks/Files/Dependencies/
Migrations/Tests/Acceptance criteria — a partir da priorização da seção 2 acima. Não
construí esse plano neste documento para manter a auditoria e a decisão de
implementação como entregas separadas, como o próprio prompt pede (§87: "NÃO
implementar tudo ao mesmo tempo").
