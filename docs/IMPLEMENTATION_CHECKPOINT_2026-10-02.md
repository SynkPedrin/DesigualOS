# Checkpoint de implementação — 02/10/2026

Escrito para quem **continua sem ter visto nada do que veio antes**. Tudo aqui foi
medido contra o sistema rodando; onde não foi, está dito.

## Repositório

```
HEAD                18f3ba7ca6043973769f7cdbc301a1a95c15ab4e
working tree        162 arquivos modificados / não commitados
git diff --stat     79 arquivos, +3105 −332
```

**O SHA NÃO IDENTIFICA O QUE FOI TESTADO.** Tudo abaixo vive no working tree.
Há trabalho de mais de uma sessão misturado — não use `git add .`.

Cópia de segurança não destrutiva feita em:

```
/tmp/desigual-p0-cosentino-checkpoint.patch   (71 arquivos rastreados)
/tmp/desigual-p0-untracked/                   (47 arquivos novos)
```

## Migrações

| | O que criou | Por quê |
|---|---|---|
| **0052** | `operational_identities`, `operational_identity_members` | Quem AGE quando quem age não tem login |
| **0053** | `mcp_tokens.actor_identity_id`, `mcp_tokens.last_used_at` | Separar quem autorizou de quem age |

As duas são **aditivas, zero DROP**. A 0053 só acrescenta colunas nullable: os
**250 tokens existentes continuam válidos** (102 vivos), todos com
`actor_identity_id` nulo — e nulo ali significa "quem autorizou é quem age",
que é o comportamento de sempre.

**Não reverter.** Derrubar `operational_identities` apaga a única ligação entre
uma conexão do Claude e a identidade que a usa.

## Modelo de identidade — três camadas

```
users    = quem entra no produto        → 1 conta real (Pedro/master) + contas de QA
people   = quem trabalha na operação    → 23 pessoas, vindas do ClickUp
operational_identities = quem AGE       → identidade externa (Claude, ClickUp)
```

**`people` não é `users` e não deve virar.** Matheus Sain e Jamile Galdino
trabalham todo dia e **não têm nem devem ter** conta no Desigual.

### people / entity_links

```
people                 23 total · 23 com clickup_user_id (100%)
entity_links (person/clickup)   24 · 0 unresolved
```

Backfill: `apps/worker/scripts/backfill-entity-links-people.mts`
**Idempotente — provado:** 1ª execução criou 22, 2ª criou **0**.

A organização **não é adivinhada**: o script registra o conector em
`organization_connectors` na 1ª execução e, da 2ª em diante, deriva de **dado**.
Sem conector e sem `PROVIDER_ORGANIZATION_ID`, ele **para**.

### operational_identities (semeadas e provadas)

```
Pedro Claude        person          → Pedro Gabriel        pode atribuir: SIM
Equipe Atendimento  shared_account  → Tammy·Alicia·Jamile  pode atribuir: NÃO
Equipe Criativa     shared_account  → Matheus Sain         pode atribuir: NÃO
```

**REGRA QUE NÃO SE NEGOCIA:** conta compartilhada **nunca** vira autoria
individual. Vale mesmo com **um membro só** — hoje é o Sain, amanhã são três, e
o histórico já teria o nome dele gravado.

Regra em `packages/database/src/resolucao-de-ator.ts` (`podeAtribuirAPessoa`,
`descreverAtor`). Semeadura: `apps/worker/scripts/semear-identidades-claude.mts`.

## Autenticação MCP

**A identidade NÃO vem do Claude.** Medido: ele manda `client_id` e um
`client_name` que é a string `"Claude"`, igual para todos. Quem identifica o
humano é a tela de consentimento do Desigual, exigindo login Supabase
(`apps/mcp/src/auth/oauth-provider.ts:153`).

Por isso existe a **credencial de conexão** (`kind: 'connection'`), gerada pelo
master e colada no Claude da pessoa, que nunca entra no Desigual.

```
mcp_tokens.user_id            = quem AUTORIZOU  (o master)
mcp_tokens.actor_identity_id  = quem AGE
```

Provado em runtime (`apps/mcp/scripts/prova-credencial.mts`):

```
person: actor correto, person preenchido, pode atribuir      PASSOU
shared: authorized_by=master, actor=Equipe, person=null      PASSOU
revogação: valia → revogada → não vale                       PASSOU
rotação: A vale → rotaciona → A morre, B vale                PASSOU
legado: 250 tokens intactos no mesmo caminho                 PASSOU
cross-tenant: identidade da Desigual não resolve noutra      PASSOU
```

**Sem expiração obrigatória**, de propósito: o funcionário não tem conta, logo
não há canal para avisá-lo do vencimento. **Rotação revoga no mesmo instante**,
sem graça — quem rotaciona supõe vazamento.

## White label

```
Super Account → Empresas → Entrar → active_organization muda → identidade PERMANECE
```

Pedro continua Pedro; muda só `users.organizacao_ativa_id`, validado no
servidor (`apps/api/src/organizations/contexto.ts`). Provado: 58 clientes no
contexto provedor, **0** dentro da Empresa QA, 58 ao voltar.

## Navegação

```
Visão Geral · Bento · Clientes · Empresas · Equipe · Conhecimento · Atividade
Ajustes: Integrações · Configurações
```

Eram **30 itens**. **22 viraram `administracao: true`** — saíram do menu e
continuam nos mesmos endereços, acessíveis em Configurações → Administração
(`apps/web/src/components/shell/administracao.tsx`). **Nenhuma rota apagada.**

## Conhecimento (`/memory`, rotulado "Conhecimento")

Mapper: `apps/web/src/lib/apresentacao/conhecimento.ts`.

**12 kinds reais** levantados do banco. Decisões que importam:

- `agent.episode` (238, a maioria) → **oculto**: é registro de turno, não
  conhecimento. Deixá-lo entrar afogaria os 96 dossiês curados.
- `client.profile` (124) → **são três coisas**: brain (51), dossiê (45),
  aprendizado (2). O aprendizado categoriza pelo **`aspect`**, não pelo kind.
- `mcp.user_private` → oculto (privado de uma pessoa).
- Tipo novo → "Contexto", **nunca o nome cru**.

## Atividade (`/activity`)

Mapper: `apps/web/src/lib/apresentacao/atividade.ts`
Rota nova: `apps/api/src/activity/routes.ts` (`GET /activity`)
Componente: `apps/web/src/components/control/linha-do-tempo.tsx`

A tela lia `/executions` (turnos do Bento). Os **902 eventos operacionais não
tinham tela nenhuma**.

```
clickup/task.updated        541
clickup/task.created        331
mcp/CONNECTION_CREATED       29   → oculto da timeline (ruído de integração)
chat/CLIENT_DECISION          1
```

## ClickUp rich events — consertado no webhook

**O que estava medido nos 872 eventos de tarefa:**

```
summary           nulo nos 872
payload           {event, list_id, actor_resolution} e nada mais
task_id           presente em 25 de 872
organization_id   ausente em 847 de 872     (org e actor já corrigidos em 01/10)
```

A causa não era a tela: `history_items[].field/before/after` chegava no webhook
e ia inteiro para o lixo, e o ClickUp **não manda o nome da tarefa em evento
nenhum** — nem no `taskCreated`.

**O que mudou (02/10):**

| Onde | O quê |
|---|---|
| `packages/tool-gateway/src/clickup-client.ts` | `getTaskResumo` devolve `{listId, name, status}` do **mesmo GET** que `getTaskListId` já fazia e descartava. `getTaskListId` virou um invólucro dele. |
| `apps/api/src/clickup/webhook-mudancas.ts` (novo) | Puro: `extrairMudancas`, `valorLegivel`, `frasearEventoDeTarefa`. Normaliza os **quatro formatos** que `before`/`after` assumem (texto, objeto, lista, epoch). |
| `apps/api/src/clickup/routes.ts` | `handleTaskChanged` grava `summary` pronto + `payload.task_name`, `payload.changes`, `status_from`, `status_to`. |
| `apps/web/src/lib/apresentacao/atividade.ts` | Lê o dado novo; o evento antigo continua curto e `dadoInsuficiente: true`. |

**Provado em runtime** (`apps/worker/scripts/prova-webhook-clickup.mts` —
webhook assinado contra a API no ar, leitura de volta do banco):

```
summary  : Moveu "Elite - Editar - 12/10 - Vídeo IA Homenagem N.S. Aparecida"
           de em producao para em aprovacao
task_name: Elite - Editar - 12/10 - Vídeo IA Homenagem N.S. Aparecida
```

Decisões que importam:

- **Um GET por evento**, não zero. O nome não existe no payload; é isso ou a
  frase curta para sempre. Mitigado por cache de 60s por `task_id` (uma edição
  em lote vira vários webhooks da mesma tarefa em segundos) com teto de 500
  entradas — webhook público não pode virar vazamento de memória.
- **Degrada, não desiste.** ClickUp fora do ar: o evento é gravado assim mesmo,
  com a mudança de status (que vem do próprio payload) e `task_name: null`.
  Só desiste se a lista também ficou desconhecida, para não gravar evento órfão.
- **`taskDeleted` não busca** a tarefa: o 404 seria garantido.
- **Nada de retroativo.** Os 872 eventos antigos não ganham nome nem mudança —
  não há de onde tirá-los depois do fato. A tela fica literalmente dividida em
  antes e depois, e os dois testes que travam isso estão em
  `apps/web/src/lib/apresentacao/atividade.test.ts`.
- **O script de prova apaga o próprio evento.** Ele afirma uma transição de
  status que não aconteceu; deixá-la no histórico seria falsificar a operação
  para provar que a tela não falsifica nada.

## Pipeline do evento rico do ClickUp — arquivo por arquivo

```
ClickUp
  │  POST assinado (HMAC-SHA256, corpo CRU — parser de string isolado
  │  num escopo só do webhook, senão quebra POST /clickup/tasks)
  ▼
apps/api/src/clickup/routes.ts:826        webhook.post('/clickup/webhook')
  │  verifyClickUpSignature → 401 se falhar
  │  responde 200 ANTES de processar (o ClickUp suspende endpoint lento)
  ▼
packages/tool-gateway/src/webhook.ts:72   parseTaskChangedEvent
  │  devolve {event, taskId, listId|null}  ← e SÓ isso. O nome da tarefa
  │  não existe no payload de NENHUM evento do ClickUp.
  ▼
apps/api/src/clickup/routes.ts:206        handleTaskChanged
  │
  ├─ nome da tarefa ──► routes.ts:182  resumoDaTarefa (cache 60s / teto 500)
  │                     └─► packages/tool-gateway/src/clickup-client.ts:528
  │                         getTaskResumo → {listId, name, status}
  │                         (MESMO GET que getTaskListId já fazia; :548
  │                          getTaskListId virou invólucro dele)
  │                         taskDeleted NÃO busca: 404 garantido
  │
  ├─ quem mexeu ──────► apps/api/src/clickup/webhook-actor.ts:30
  │                     extrairContextoDoHistoryItem → {autor, ocorridoEm}
  │                     └─► packages/database  resolverPessoaPorClickupUserId
  │                                            resolverPessoaPorEmail
  │                         actor_resolution: 'link' | 'email' | 'nao_resolvido'
  │
  ├─ o que mudou ─────► apps/api/src/clickup/webhook-mudancas.ts
  │                     :105 extrairMudancas   (TODOS os history_items)
  │                     : 57 valorLegivel      (texto|objeto|lista|epoch)
  │                     :135 frasearEventoDeTarefa → summary
  │
  ▼
packages/orchestrator/src/event-store.ts:88   recordOperationalEvent
  │  dedup é do BANCO: unique (source, external_id). NUNCA lança.
  ▼
operational_events   (packages/database/src/schema/knowledge.ts:190)
     summary  "Moveu \"X\" de em producao para em aprovacao"
     payload  {list_id, event, actor_resolution, task_name,
               changes[], status_from, status_to}
  ▼
apps/api/src/activity/routes.ts:33   GET /activity (escopo = empresa de trabalho)
  ▼
apps/web/src/lib/apresentacao/atividade.ts:109  apresentarAtividade
     detalheDaTarefa(payload) → null em evento legado ⇒ frase curta +
     dadoInsuficiente: true. Nenhum backfill, nenhuma adivinhação.
```

**Testes:** `apps/api/src/clickup/webhook-mudancas.test.ts` (12) ·
`apps/api/src/clickup/routes.test.ts` (4 no webhook) ·
`apps/web/src/lib/apresentacao/atividade.test.ts` (3, antes × depois).

**Prova de runtime:** `apps/worker/scripts/prova-webhook-clickup.mts` — assina
um corpo real, manda para a API no ar, lê de volta do banco e **apaga o próprio
evento** (ele afirma uma transição que não aconteceu).

**Limitação permanente:** os 872 eventos anteriores a 02/10/2026 não têm
`task_name` nem `changes` e **nunca terão** — não há de onde tirá-los depois do
fato.

## Testes

```
Navegador   42/42
Unitários   2.693 passando, 0 falhando
```

Por pacote: worker 1554 · context-engine 324 · web 308 · orchestrator 205 ·
api 193(+3 skip) · tool-gateway 118 · router 110 · mcp 62 · auth 59 · database 21

Os 19 novos são do bloco ClickUp: 12 em `webhook-mudancas.test.ts`, 4 no
webhook em `clickup/routes.test.ts`, 3 no apresentador da Atividade.

### MOCK QUE NÃO REPRESENTA A INTERFACE REAL NÃO É PROVA

Achado em 02/10: o mock de `@desigual-os/tool-gateway` em `routes.test.ts` não
tinha `getTaskResumo`. A chamada nova estourava, era engolida pelo `catch` de
degradação, e **a suíte passava verde sem provar nada**. Mock incompleto é a
versão silenciosa do instrumento que mente — o teste não falha, ele deixa de
testar.

Sempre que a interface de uma dependência mudar:

1. **atualizar o mock** no mesmo commit que muda o handler;
2. **ter contraprova** — um teste que falharia se a função nova não fosse
   chamada, não só um que passa quando ela é;
3. **verificar em runtime** quando o caminho for crítico.

## Regra de validação aprendida nesta sessão

**Uma execução verde não prova nada** neste sistema. Medido: a mesma pergunta,
no mesmo código, deu 22% de acerto em 9 amostras depois de eu ter declarado
"corrigido" com 1 execução.

- comportamento probabilístico: **N ≥ 5**, distribuição inteira à vista
- **congelar o código durante a medição** (o worker roda `tsx watch` e
  recarregou no meio de uma bateria, invalidando-a)
- todo teste de ausência precisa de **contraprova**, senão passa em tela vazia

Bateria: `apps/worker/scripts/bateria-cosentino.mts`.
Último resultado limpo: **23/25 corretas, 0 ausência falsa, 0 timeout.**

## NEXT BLOCK — Claude actor → Brain → Bento

### Onde a identidade se perde (mapeado, nada editado)

```
mcp_tokens.actor_identity_id                       EXISTE (migração 0053)
        ↓
apps/mcp/src/auth/token-store.ts:203  verificarAccessToken
        → TokenVerificado inclui actorIdentityId      :194  :213  :243
        ↓                                             ✅ ainda existe
apps/mcp/src/auth/oauth-provider.ts:241  verifyAccessToken
        → extra: { userId, organizationId, tokenId }  :279-283

        ███ AQUI. PRIMEIRO E ÚNICO PONTO DE PERDA. ███
        O valor está na variável `verificado` e simplesmente
        não é copiado para `extra`. Uma linha.
        ↓                                             ❌ perdido
apps/mcp/src/server.ts:304-306
        lê auth.extra.userId e auth.extra.organizationId
        ↓                                             ❌ não tem o que ler
apps/mcp/src/auth/principal.ts:15  ResolverPrincipalInput
        { userId, organizationId, scopesDoToken, sessionId }
        ↓                                             ❌ campo não existe
packages/mcp-domain/src/principal.ts:15  McpPrincipal
        userId · organizationId · organizationIds · ehProvider ·
        employeeId · email · name · role · scopes · sessionId
        ↓                                             ❌ campo não existe
apps/mcp/src/tools/kit.ts:32  ContextoDaTool
        { principal, providers, logger, requestId }
        ↓                                             ❌ herda a ausência
apps/mcp/src/tools/kit.ts:106  registrarTool → executar(args, ctx)
        ↓
tool handler (ex. memory-events.ts:278 save_client_feedback)
        ↓
operational_events  ← grava principal.userId / employeeId, actor textual
        ↓
apps/mcp/src/tools/promocao-de-conhecimento.ts:67 promoverEventoParaMemoria
        :99 insert(memories)
        :114 metadata.recorded_by = principal.name   ⚠️ NOME, não identidade
        ↓
Brain retrieval → apps/worker/src/processors/provenance-block.ts
        ↓
Bento (agentic-dispatch.ts:65 anexarFontes/formatProvenanceBlock)
```

**Conclusão: UMA linha quebra a corrente inteira.** Não há perda em vários
pontos — há uma omissão em `oauth-provider.ts` e, depois dela, oito camadas que
nunca tiveram o campo porque nunca recebeu nada para carregar.

**Risco que o próximo agente precisa conhecer:** `metadata.recorded_by =
principal.name` (promocao-de-conhecimento.ts:114) grava **o nome do dono do
login**. Com credencial de conta compartilhada, `principal.userId` é o master —
então hoje o conhecimento salvo pela Equipe Atendimento sairia atribuído ao
Pedro. Isso é pior que não ter autoria: é autoria **errada**. Corrigir junto, no
mesmo bloco, não depois.

### Schemas — o que já existe (inspecionado, sem migration)

`operational_events` (`packages/database/src/schema/knowledge.ts:190`):

| Campo | Existe? |
|---|---|
| `actor_identity_id` | **NÃO** |
| `actor_person_id` | **NÃO** |
| `authorized_by_user_id` | **NÃO** |
| `actor` (texto legado) | SIM — `text('actor')`, :204 |
| `user_id`, `employee_id`, `organization_id` | SIM, :230-231 |
| `payload`, `raw` (jsonb) | SIM, :206-207 |

`memories` (mesmo arquivo):

| Campo | Existe? |
|---|---|
| `author` / `actor` | **NÃO** |
| `user_id`, `agent_id` | SIM |
| `source_type` + `source_id` (indexados juntos) | SIM |
| `metadata` (jsonb) | SIM — já carrega `recorded_by`, `employee_id`, `session_id` |

**Resposta à pergunta que importa:** o bloco **cabe sem migration**.
`payload.actor_identity_id` e `metadata.actor_identity_id` levam a identidade de
ponta a ponta, e `metadata` já é usado exatamente assim. **Migration vira
necessária** no momento em que alguém quiser *filtrar ou agregar* por ator
(coluna + índice + FK) — por exemplo "o que a Equipe Atendimento registrou esta
semana". Decidir isso com a pergunta na mão, não antes.

### Tools MCP — 38 registradas

```
READ   29     WRITE  9
```

As 9 de escrita, e o que cada uma produz:

| Tool | Arquivo:linha | operational_event | memory | precisa actor |
|---|---|---|---|---|
| `remember` | v1.ts:214 | não | **sim** (:237) | **SIM** |
| `save_client_feedback` | memory-events.ts:278 | sim (:317) | **sim** (:293) | **SIM** |
| `save_learning` | memory-events.ts:343 | sim (:377) | **sim** (:361) | **SIM** |
| `log_operational_event` | memory-events.ts:132 | sim (:173) | via promoção | **SIM** |
| `log_work` | memory-events.ts:240 | sim (:256) | via promoção | **SIM** |
| `create_task` | tasks.ts:119 | sim (:334) | não | sim |
| `update_task` | tasks.ts:227 | sim (:334) | não | sim |
| `complete_task` | tasks.ts:279 | sim (:334) | não | sim |
| `add_task_comment` | tasks.ts:302 | sim (:334) | não | sim |

As 29 de leitura **não precisam propagar ator** — não criam evento nem
conhecimento. A única exceção a vigiar é `telemetria.ts:76`, que grava evento
para TODA tool (inclusive read): é auditoria, e ganhar o ator ali é barato e
útil, mas não é o caminho crítico.

### Ordem de execução do próximo bloco

```
1.  oauth-provider.ts:279   extra ganha actorIdentityId        ← A LINHA
2.  server.ts:304           lê extra.actorIdentityId
3.  principal.ts:15         ResolverPrincipalInput ganha o campo
4.  principal.ts:73         resolve a identidade (resolverAtor,
                            packages/database/src/resolucao-de-ator.ts)
5.  mcp-domain/principal.ts:15  McpPrincipal ganha `ator`
                            { identityId, displayName, actorType, personId }
6.  kit.ts:32               ContextoDaTool já herda via principal — conferir
7.  tools de escrita        payload.actor_identity_id no operational_event
8.  promocao-de-conhecimento.ts:114  recorded_by passa a vir do ATOR,
                            não de principal.name  ← conserta autoria errada
9.  provenance-block.ts     expõe a autoria no bloco de fontes
10. Bento                   entende person × shared_account
```

### Critério de aceite — o teste que define "pronto"

```
Equipe Atendimento → Claude → token de conexão
  → actor_identity = Equipe Atendimento (shared_account)
  → save_client_feedback
  → operational_event  (authorized_by = master, actor = Equipe)
  → memory             (metadata.recorded_by = "Equipe Atendimento")
  → Brain → Bento
```

Bento deve dizer:

> A Equipe Atendimento registrou esta preferência.

E perguntado **"foi a Tammy?"**:

> Não é possível atribuir especificamente à Tammy. A informação veio da conta
> compartilhada da Equipe Atendimento.

Dois runtimes obrigatórios: **um com identidade `person`** (Pedro Claude, que
PODE ser atribuída) e **um com `shared_account`** (Equipe Atendimento, que não
pode). A regra já existe e é testada — `podeAtribuirAPessoa` em
`packages/database/src/resolucao-de-ator.ts`. O bloco é fazê-la chegar ao Bento.

## Mapa do working tree por domínio

`HEAD 18f3ba7` · 167 arquivos no `git status` · `git diff --stat`: 80 arquivos,
+3297 −340. **Não existe commit que isole um bloco.** Use esta tabela para
decidir o que entra em cada commit.

| Domínio | Arquivos principais |
|---|---|
| **IDENTITY** | `packages/database/src/schema/operational-identities.ts` (novo) · `resolucao-de-ator.ts` (+test) · `packages/auth/src/organizacao-de-trabalho.ts` (+test) · `apps/worker/scripts/semear-identidades-claude.mts` · `backfill-entity-links-people.mts` |
| **MCP** | `apps/mcp/src/auth/token-store.ts` · `apps/mcp/src/server.ts` · `apps/mcp/src/tools/{kit,v2,memory-events}.ts` · `packages/mcp-domain/src/` · `apps/mcp/scripts/prova-credencial.mts` · `packages/database/src/schema/mcp.ts` |
| **CLICKUP** | `apps/api/src/clickup/{routes,webhook-mudancas,webhook-actor}.ts` · `packages/tool-gateway/src/clickup-client.ts` · `apps/worker/scripts/prova-webhook-clickup.mts` |
| **ACTIVITY** | `apps/api/src/activity/routes.ts` (novo) · `apps/web/src/components/control/linha-do-tempo.tsx` (novo) · `apps/web/src/hooks/use-activity.ts` (novo) · `apps/web/src/lib/apresentacao/atividade.ts` (novo) · `apps/web/src/app/(shell)/activity/page.tsx` |
| **KNOWLEDGE** | `apps/web/src/lib/apresentacao/conhecimento.ts` (novo) · `apps/web/src/app/(shell)/memory/page.tsx` · `apps/worker/src/processors/{knowledge-statement,provenance-block,client-fact,context-assembler}.ts` · `apps/worker/src/processors/guarda-de-ausencia.ts` (novo) · `apps/worker/src/scheduler/knowledge-consolidation.ts` |
| **WHITE LABEL** | `apps/api/src/organizations/{contexto,criar,ficha,routes}.ts` · `apps/api/src/lib/escopo-de-organizacao.ts` · `apps/web/src/components/shell/brand-provider.tsx` |
| **WEB UX** | `apps/web/src/components/shell/{nav-items.ts,sidebar.tsx,administracao.tsx}` · `apps/web/src/app/(shell)/{clients,settings}/page.tsx` · `apps/web/src/components/clients/client-grid.tsx` · `apps/web/src/mocks/` |
| **ROUTER/BENTO** | `packages/router/src/pergunta-factual.ts` (novo, +test) · `apps/api/src/chat/routes.ts` · `apps/worker/src/processors/{agentic-dispatch,execute-job}.ts` |
| **DATABASE** | `database/migrations/0052_*`, `0053_*` (+ `meta/_journal.json`) · `packages/database/src/schema/` |
| **TESTES/QA** | `apps/web/tests/e2e/control-plane.spec.ts` · `apps/worker/scripts/bateria-cosentino.mts` · `scripts/qa/suite-integra.baseline.json` |

**`.env.example`** está modificado (nota sobre o pooler 6543) e pertence ao
bloco de performance, não a nenhum dos acima.

## Depois do Claude actor, em ordem

```
1. Claude actor → Brain → Bento      ← o próximo bloco, mapeado acima
2. Claude Integration UI
3. ClickUp Integration UI
4. Visão Geral operacional
5. Connector Contract
6. reconciliation <= 60s
7. ingestion_lag_seconds
8. E2E White Label completo
9. release stabilization
```

## Dívida conhecida do bloco ClickUp

O `actor` continua `nao_resolvido` quando o usuário do ClickUp não tem link no
entity graph. Os 23 `people` têm `clickup_user_id`, então o caminho existe —
falta **medir** quantos autores reais caem fora dele depois de alguns dias de
eventos novos. Medir antes de mexer: é exatamente o tipo de conserto que já
custou caro neste projeto quando feito no escuro.

---

## Por onde começar na próxima sessão

**Abra `apps/mcp/src/auth/oauth-provider.ts:279`**, o bloco `extra:` dentro de
`verifyAccessToken`. O valor que falta já está na variável `verificado`, na
linha 244. Daí siga a ordem de execução da seção *NEXT BLOCK*.
