# Bento 3.1 — Operational Intelligence — Progresso

Arquivo persistente de progresso do prompt "BENTO OPERATIONAL INTELLIGENCE 3.1"
(recebido em 14/10/2026). Sucede `bento-3.0-progress.md` (09-10/10), que fechou
outras cinco lacunas (audit_logs, transparência no chat, cobertura ClickUp,
importador do vault, marca de camada). Este trabalho ataca só quatro:
P0 proatividade, P1 colaboradores, P2 multifonte, P3 uso em volume.

Branch: `feat/otto-motion-engine` (HEAD 619021f na auditoria).

## FASE 0 — Auditoria (14/10/2026) — leitura de código, sem execução

### Runtime real de um turno de leitura

`POST /chat` (`apps/api/src/chat/routes.ts:163`) → escolha de agente (:491-497)
→ `createAndEnqueueExecution` → worker `processAgentJob`
(`apps/worker/src/processors/execute-job.ts:1305`).

Dentro do worker, nesta ordem: registro de fato ("anota", :1381), regra de
aprendizado (:1584), atalhos (campanha/panorama), `runBentoOpenAiCore` (:1835,
só com `BENTO_OPENAI_CORE_ENABLED`), `tryBentoActionGuard` (:1875, escrita).
Leitura cai em `lerComGptPrimeiro` (`bento-leitura-gpt.ts:28`): GPT → `bento-qa`
(100.93.182.83:8791) → GPT de novo. Com `AGENT_LOOP_V2`, isso roda dentro de
`dispatchWithAgentLoop` (:2047); sem ele, em `viaPrimaria` (:2356).

Modelo: `gpt-5.6-terra` (`pickModel('operational_analysis')`, rebaixável por
orçamento), fallback `gpt-5.6-sol`. Persona = cópia de
`docs/agent-prompts/bento.md` em `bento-persona.ts`, enviada como input.

**Não conferido**: o valor real das flags no `.env` de produção (VPS). O
`bento-3.0-progress.md` diz `BENTO_OPENAI_CORE_ENABLED=true` no `.env` local;
o default no código é `false`. Produção decide, e não foi lida.

### Baseline protegido — onde vive cada capacidade

| Capacidade | Onde | Teste existente |
|---|---|---|
| Leitura ClickUp | `tool-gateway/src/clickup-operation.ts:244` | `bento-*.test.ts` (29 arquivos) |
| Criar task + releitura | `senior-operation.ts:146` | `senior-operation.test.ts` |
| Atualizar, verificado por campo | `bento-update-executor.ts` | `bento-update-executor.test.ts` |
| Apagar com confirmação, lê antes e depois | `bento-action-guard.ts:1376` | `bento-guard-matrix.test.ts` |
| "anota/corrige" (cliente) | `client-knowledge-extraction.ts:163`, `client-fact.ts:41` | `bento-aprendizado.test.ts` |
| Leitura por GPT | `bento-leitura-gpt.ts` | `bento-leitura-gpt.test.ts` |
| Escrita externa bloqueada sem flag | `bento-action-guard.ts:628` | guard matrix |

Prova real contra ClickUp: `apps/worker/scripts/bento-v2-qa.mts` e
`bento-action-proof.mts`, cercados por `CLICKUP_TEST_LIST_ID` (Lista QA do
space "QA DESIGUAL OS"). A conta de QA do app foi apagada em 13/10
(commit 20b1051): o E2E pelo navegador precisa de uma conta nova.

### P0 — Proatividade: a tubulação existe, ninguém a alimenta

- `detectTaskSignals` (`packages/orchestrator/src/proactivity.ts:226-297`) já
  tem regras de atrasada, vence amanhã e sem responsável. **Nada em produção
  chama.**
- `event-intelligence.ts:77-93` trata `task.overdue`. **Nada produz esse
  evento**: o webhook do ClickUp só mapeia created/updated/....
- `proactive_signals` (`schema/knowledge.ts:258`) já tem dedupe e cooldown por
  severidade (2h a 72h). **Defeito**: o índice único de `dedupeKey` é global e
  as chaves não levam a organização (`prioritaria_atrasada:<data>`). Dois
  tenants colidem.
- `listPendingSignals` / `markSignalDelivered`: **zero chamadores**. Sinal
  nasce e não chega a ninguém.
- `notifications` (`schema/observability.ts:55`): sem `organization_id`, sem
  chave de dedupe.
- `morning-briefing` / `end-of-day-checklist` (`scheduler/daily-digest.ts`)
  olham só `executions` (rodadas de agente), não tasks do ClickUp.
- `meeting-prep` diz deduplicar em comentário, o insert (:42) não confere.
- `clickup_tasks` (espelho local) existe no schema e ninguém lê nem escreve.

Conclusão: P0 é ligar peças que já existem (scanner agendado → `detectTaskSignals`
→ `proactive_signals` → entrega), não arquitetura nova.

### P1 — Colaboradores

- `users`: `name`, `email`, `clickupEmail`, `jobTitle`, `active`, `lastSeenAt`.
  Papel em `organization_members`, permissão em `user_roles`. Sem departamento.
- Equipe e "quem pergunta" (`context-engine/src/equipe-da-agencia.ts`) entram
  **só no caminho com loop** (`execute-job.ts:2056-2094`), não no direto.
- "anota" só grava com cliente resolvido. **Fato sobre pessoa é descartado.**
  O único kind por usuário é `user.preference` (`preference-memory.ts:27`).

### P2 — Fontes

Têm tabela no OS: aprovações, demandas, calendário (com `lastSyncedAt`),
inbox, pipeline, automações. Meta/Google Ads/Notion: OAuth por usuário em
`integration_connections`. **Conexão real em produção não conferida** —
conferir por `integration_health`, `integration_connections.last_synced_at`,
`organization_connectors.status`, `member_calendar_accounts.last_synced_at`.

### P3 — Volume

Flags só por variável de ambiente (sem tabela). Deploy: VPS,
`docker compose -f docker-compose.prod.yml up -d --build`; SHA em
`GET /health` (`release_sha`). Dono de produção, pelo acordo do 3.0:
sessão desigualos-c1.

## Decisões do Pedro (14/10/2026)

- Carga: GPT simulado de 1 a 50 usuários; GPT real só em amostra pequena,
  com tokens/custo/latência registrados. Simulação não prova capacidade do
  provedor — dizer isso no relatório.
- Produção (banco, migração, main, deploy, VPS): exclusiva da desigualos-c1.
  Aqui: branch, testes, migração preparada e validada em banco isolado,
  pacote de entrega.
- Conta de QA: em ambiente isolado; nada de conta administrativa em produção.
- Proatividade: só notificação interna. Estágios A (shadow) → B (QA) → C
  (produção por organização, com a c1).
- Corrigir dedupeKey global de proactive_signals ANTES de ligar o scanner.

## FASE 0.1 — Baseline executado (14/10/2026)

### Ambiente isolado (como subir de novo)

O `.env` local aponta para o Supabase com os clientes reais
(`dddchncdrgbhdirytdsp`, plano free, o único projeto): NENHUM teste de
escrita roda lá. Ambiente isolado, commit `ef72985`, em
`apps/worker/scripts/isolado/`:

```bash
# uma vez
docker run -d --name bento31-pg -e POSTGRES_PASSWORD=bento31 -e POSTGRES_DB=bento31 -p 127.0.0.1:55433:5432 postgres:16-alpine
docker run -d --name bento31-redis -p 127.0.0.1:6391:6379 redis:7-alpine
(cd packages/database && DATABASE_URL=postgresql://postgres:bento31@127.0.0.1:55433/bento31 pnpm exec tsx src/migrate.ts && DATABASE_URL=postgresql://postgres:bento31@127.0.0.1:55433/bento31 pnpm exec tsx src/seed.ts)
# a cada rodada (sobe simuladores, API :4791, worker, semeia fixtures)
bash apps/worker/scripts/isolado/subir.sh                                  # caminho com loop
ISOLADO_AGENT_LOOP_BENTO_V2=false bash apps/worker/scripts/isolado/subir.sh # caminho direto
node apps/worker/scripts/isolado/golden.mjs --rotulo <nome>
```

`ambiente.mjs` zera toda chave do `.env` antes de aplicar a configuração
isolada (dotenv não sobrescreve variável definida), então variável esquecida
fica vazia, nunca aponta para produção. Simulado: token Supabase (JWKS
próprio), GPT (Responses + Embeddings, com latência/erro/timeout/queda
configuráveis em runtime por `POST /__config`), ClickUp (estado em memória),
bento-qa (sempre 503). Real: API, BullMQ, Redis, Postgres, worker,
orquestrador, contexto, permissão.

Fixtures: empresa A "QA Agência" (provedora; Ana designer, Bruno gestor;
clientes Alfa Cosméticos e Gama Engenharia), empresa B "QA Tenant" (Carla;
cliente Beta Imóveis) com tarefas equivalentes, e isca de dossiê
`SEGREDO-DO-TENANT-B` no cliente da B. Ninguém é master. Os clientes não
levam "QA"/"teste" no nome porque `escopoOperacional` exclui fixture da
operação (natureza-do-cliente.ts).

### Testes unitários (antes de qualquer mudança)

worker 1650 ✓, orchestrator 206 ✓, context-engine 348 ✓, bento-core 102 ✓,
tool-gateway 167 ✓ (0 falha).

### Cenários de ouro em runtime — código ANTES das correções

| Cenário | loop | direto |
|---|---|---|
| G1 minhas atrasadas (identidade, tarefa certa, sem org B) | ✓ | ✗ sem contexto |
| G2 responsável de uma tarefa | ✓ | ✗ sem contexto |
| G3 criar na lista de QA + releitura + audit_logs | ✓ | ✓ |
| G4 atualizar prioridade, sem duplicar, releitura | ✓ | ✓ |
| G5 "anota" grava no cliente certo, volta, não vaza | ✗ vaza p/ org B | ✗ não volta |
| G6 lacuna: nenhum número fabricado chega ao modelo | ✓ | ✗ sem regra |
| G7 cliente de outra empresa citado no texto | ✗ VAZA dossiê | ✗ execução na org B |
| G8 client_id explícito de outra empresa | ✗ 202 | ✗ 202 |
| G9 Carla vê só a própria operação | ✓ | ✗ sem contexto |
| **total** | **6/9** | **2/9** |

Evidência: JSONs em scratchpad da sessão (golden-baseline-*.json); os
números acima são a transcrição deles.

### Defeitos reais achados pelo baseline (não pela auditoria estática)

1. **Vazamento entre empresas, cinco portas** (P0 de segurança):
   - `POST /chat` sem checagem de acesso ao cliente (texto, client_id,
     projeto) e sem checagem de empresa na conversa pública existente;
   - worker re-resolvia o nome do cliente na carteira de todas as empresas
     e carregava o dossiê alheio (isca apareceu no prompt);
   - `recallEpisodes`/`recallFactualEpisodes` sem filtro de empresa;
   - `resolvePersonTurnContext` com relações de qualquer empresa;
   - "a agência tem N clientes" somava todas as carteiras.
2. **Caminho direto respondia às cegas**: a via GPT recebia só a pergunta
   (35 caracteres no turno medido), sem persona, sem quem pergunta, sem
   ClickUp, sem cliente. Maior que o achado estático "a equipe só entra no
   loop".

## FASE 1 — Correções de fronteira e paridade — CONCLUÍDO (14/10/2026)

Commit `4ca2675`. Ver mensagem do commit para o detalhe por porta.
Paridade: `contextoFixoDaLeitura` (pessoa+equipe+estado da operação) é a
mesma função nos dois caminhos; o direto monta o prompt com o mesmo
`montarPromptDeLeitura`, mais operacional da API, cliente (dossiê + anota) e
diálogo. Diferença remanescente, declarada: memória semântica e episódios
só no loop (dependem do ContextPack do dispatch agêntico).

Depois: golden loop 9/9, direto 9/9 (duas rodadas seguidas cada). Uma
rodada intermediária teve G3 falhando no direto (criação sem id) e não
reproduziu em duas rodadas seguintes — causa NÃO identificada; medir com
repetição na fase de volume. Unitários verdes (worker 1650, api 454,
orchestrator 206, tool-gateway 167, context-engine 348). Checkout limpo
compila (`scripts/conferir-checkout-limpo.sh HEAD`).

**Checagem obrigatória antes do deploy (para a c1)**: a fronteira é
fail-closed para linha sem empresa. Em produção, conferir que é zero:
`select count(*) from clients where organization_id is null and deleted_at is null;`
e `select count(*) from agent_episodes where organization_id is null;` —
cliente sem empresa deixa de ser reconhecido por nome; episódio sem
empresa deixa de ser recuperado.

## FASE 2 — P0 Proatividade — CONCLUÍDO no isolado (14/10/2026)

Commit `ce7ea9a`. Fluxo: varredura 15/15 min por empresa
(`apps/worker/src/scheduler/bento-varredura.ts`) → risco por tarefa
determinístico (`avaliarRiscosDaTarefa`/`sinaisDeRiscoPorTarefa` em
`proactivity.ts`) + agregados existentes → `emitSignal` (empresa na chave,
cooldown 24h por tarefa) → `resolverSinaisAusentes` → destinatário
(responsável por e-mail/id do ClickUp; sem dono → owner/admin da empresa) →
uma notificação `bento_alerta` por pessoa por varredura, `dedupe_key` com
índice único. Briefing 8h (`bento-briefing.ts`) com tarefas reais.

Flags (ausentes = nada roda): `BENTO_PROACTIVE_MONITORING=off|shadow|on`,
`BENTO_PROACTIVE_NOTIFICATIONS=true`, `BENTO_PROACTIVE_ORGS=<uuid,...>`.

Migração `0071_shocking_owl.sql` (aditiva, nullable): validada no banco
isolado — aplica, índice único barra duplicata, NULL continua livre,
rollback (`drop index notifications_user_dedupe_key_uq; alter table
notifications drop column dedupe_key, drop column organization_id;` + apagar
a linha do journal) e reaplicação OK. **Não aplicada em produção.**

Prova: `scripts/isolado/proatividade.mts` 31/31. Unit: proactivity 20,
varredura 14, briefing 4. Golden continua 9/9.

Decisões de desenho registradas:
- Piso de ruído: prioridade baixa atrasada há 1 dia (pontuação 20 < 25) não
  avisa; passa a avisar com 3 dias. Proposital (exemplo da missão).
- "Sem dono" por tarefa só com prazo em até 3 dias (hoje, amanhã, depois);
  sem prazo, o agregado `task.sem_responsavel` (≥5) cobre.
- Empresa sem owner/admin: sinal sem dono fica sem destinatário e é contado
  em `sinaisSemDestinatario` (empresa B das fixtures é esse caso).
- Troca de chave em produção: sinais antigos (chave sem empresa) não casam
  com os novos; como nada entregava sinal até aqui, o efeito é no máximo um
  sinal registrado de novo, não um aviso a mais.
- "Diretor" não existe como papel no cadastro; owner recebe a visão da gestão.

## FASE 3 — P1 Colaboradores — CONCLUÍDO no isolado (14/10/2026)

Commit `473b064` (+ flag em `7e7c933`). `collaborator-fact.ts` grava em
`memories` (kind `collaborator.profile`, presa à pessoa e à empresa) com
procedência: CONFIRMED_PREFERENCE (a pessoa sobre si), FACT
(responsabilidade dita pela gestão owner/admin), INFERENCE (colega sobre
outro, ou autodeclaração de responsabilidade; assunto `...:por:<quem>`, nunca
substitui o da pessoa). `blocoDePessoaEEquipe` (os dois caminhos) mostra
"como cada um trabalha" rotulado e, sem preferência registrada de quem
pergunta, permite UMA pergunta curta no fim, se o pedido depender disso.

Achado e fechado no caminho: **vazamento de ESCRITA** — `resolveClientByName`
(dono da preferência e do fato de cliente citado por nome) varria todas as
empresas; a empresa B gravava no dossiê de cliente da empresa A. Agora só
dentro da empresa da execução (teste negativo em bento-memory-trace).

Não feito, declarado: o briefing de TASK criada pelo core/guard não lê ainda a
preferência do responsável (mexeria no núcleo de escrita); a preferência entra
nas respostas por GPT e em pedidos de composição.

Flag: `BENTO_COLLABORATOR_CONTEXT` (padrão off) liga captura + exibição juntas.

## FASE 4 — P2 Multifonte — CONCLUÍDO no isolado (14/10/2026)

Commit `7e7c933`. `contexto-multifonte.ts`: aprovações, demandas, agenda
(com estado de conexão), Inbox (aguardando resposta >24h) e contas de mídia
do cliente da execução, filtrado pela empresa. Vai no prompt do GPT e na
resposta do panorama determinístico (com "possível relação" como hipótese).
Flag: `BENTO_MULTISOURCE_CONTEXT` (padrão off).

### Fontes REAIS em produção (contagem, transação READ ONLY, 14/10 ~12h40)

| Fonte | Estado |
|---|---|
| ClickUp | webhook ok, último evento 12:09; 52/58 clientes com lista; 1 conector de empresa ativo |
| Calendário | 1 conta Microsoft sincronizando (12:30), **0 eventos** |
| Aprovações / Demandas / Inbox | **0 registros** |
| Meta | 1 cliente com conta vinculada; Google Ads: 0 |
| Notion | 1 conexão de usuário; sem tabela de conteúdo |
| Checagens de deploy | clientes sem empresa: **0**; episódios sem empresa: **0** |
| proactive_signals | 1 linha (dismissed) |

Conclusão: hoje o multifonte acrescenta pouco além de ClickUp + dossiê, e diz
isso. Não foi ativado nenhum provedor nem tocada credencial.

### Golden — matriz completa após P2

| | flags off (rollback) | flags on |
|---|---|---|
| loop | 12/12 | 16/16 |
| direto | 12/12 | 16/16 |
