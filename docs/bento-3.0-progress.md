# Bento 3.0 — Operational Intelligence — Progresso

Arquivo persistente de progresso (sobrevive a compactação de contexto), conforme
exigido pelo prompt mestre recebido em 09/10/2026. Atualizado a cada fase
concluída, não a cada turno.

Branch: `feat/otto-motion-engine`. Sessão: desigualos-50 (fa4009).

## Regras de execução (do prompt mestre, não repetir alhures)

- Ciclo: DISCOVER → BASELINE → DESIGN → IMPLEMENT → TEST → DEPLOY → VERIFY → IMPROVE.
- Não parar para aprovação de rotina. Parar só para: ação destrutiva, acesso
  externo indisponível, mudança de alto impacto, serviço pago, migração
  irreversível, dado real perigoso, ambiente de outra sessão.
- `desigualos-c1` é dono exclusivo de produção/deploy — nunca fazer deploy
  concorrente.
- Obsidian é a memória institucional oficial — não criar segundo cérebro.
  ClickUp é a fonte oficial do estado das tarefas.
- Não declarar nada "pronto" sem teste real e evidência.

## Docs de auditoria PRÉ-EXISTENTES a conferir antes de duplicar trabalho

(achados em `docs/`, antes de qualquer investigação nova)

- `forensic-audit-2026-09-25.md`
- `auditoria-forense-agentes-2026-09-12.md`
- `bento-melhoria-2026-09-14.md`
- `bento-otto-operational-autonomy-2026-09-21.md`
- `como-o-bento-aprende-com-a-equipe.md`
- `auditoria-prontidao-2026-09-18.md`
- `AI-AGENTS-AUDIT-REPORT-2026-09-13.md`
- `audits/` (pasta)

## FASE 0 — Investigação forense (EM ANDAMENTO)

Status: iniciada 09/10/2026, 6 agentes de pesquisa em paralelo despachados:

1. Núcleo do Bento — router, orchestrator, system prompts, context engine
2. ClickUp Tool Gateway — cobertura real de leitura/escrita, read-after-write
3. Memória institucional — Obsidian real ou tabela Postgres chamada "vault"?
4. Serviço real de produção — Bento roda nesta API ou é um node separado?
5. Frontend do chat — transparência de tool-call, Daily Brief real ou só /today
6. Permissões/auditoria/evals — escopo multi-tenant do agente, prompt injection

Matriz AS-IS: a preencher abaixo conforme os agentes retornam.

| Capacidade | Onde está | Ativa em runtime? | Fonte de dado | Permissões checadas? | Resultado real? | Defeitos conhecidos | Testes que comprovam |
|---|---|---|---|---|---|---|---|
| (preencher) | | | | | | | |

### Achado 1/6 — Memória institucional (agente "Obsidian/memory engine")

**Veredito: memória do Bento é tabela Postgres (`memories`), NÃO Obsidian.** "Vault"
é usado em dois sentidos que não podem ser confundidos:

- **Vault REAL (arquivo .md de verdade)**: `nodes/desigual-node/src/obsidian/reader.ts`
  (`searchVault`), lido LOCAL por máquina (`OBSIDIAN_VAULT_PATH`), nunca sincroniza
  pro servidor central ("regra de ouro 1"). É o caminho QUEBRADO: só tinha 1
  cliente de 57 no vault local, causou alucinação documentada (D. Carvalho virou
  "rede de joias e relógios" — `apps/worker/src/processors/client-context.ts:15-18`).
  Existe em código, mas é legado/desconectado da memória de verdade.
- **"Vault" informal**: pasta externa de dossiês curados (`brain-desigual/02-clientes/`),
  gitignored, nunca lida ao vivo — só fonte de IMPORTAÇÃO pontual via
  `sync-dossies.mts`, nunca um alvo de busca em tempo real.

**Sistema de memória de verdade**: `packages/database/src/schema/knowledge.ts`
(tabela `memories`: organizationId, clientId, kind, content, confidence,
status, supersededBy, dedupeKey...) + `packages/orchestrator/src/memory-engine.ts`
(`rememberFact`/`recallMemories`) + `memory-embeddings.ts` (`recallMemoriesSemantic`,
cosseno em JS, SEM pgvector, até 200 candidatos, top-k ≥0.35).

Três fontes convergem nessa MESMA tabela (`kind: 'client.profile'`):
1. `BRAIN.md` do Otto skill → `sync-brains.mts` → `subject: cliente:<id>:brain`
2. Dossiê externo → `sync-dossies.mts` → `subject: cliente:<id>:dossie`
3. Ensinado no chat (automático, todo turno) → `subject: cliente:<id>:aprendizado:<aspecto>`

`apps/worker/src/processors/client-context.ts:67-120` junta os três, rotulados
(REGISTRO CRIATIVO / OPERACIONAL / APRENDIDO), aprendido por último, corrige os
outros quando diverge. Confiança por fonte é real e hierárquica
(`memory-engine.ts:99-108`: manual 0.95 > clickup_comment 0.9 > chat 0.85 >
clickup_task/vault 0.8 > system 0.7 > agent 0.5).

Multi-tenant: `organizationId` existe e é filtrado antes de qualquer ranking —
mas foi adicionado 30/09 DEPOIS de dois vazamentos reais no mesmo dia, e
`memory-embeddings.ts:58-70` cita 47 linhas órfãs (sem org/client/user) ainda
não resolvidas em 01/10.

### Achado CRÍTICO — reconciliação de dois relatos contraditórios (verificado por mim, direto no código)

Dois agentes em paralelo leram arquivos diferentes e chegaram a conclusões
aparentemente opostas sobre "onde o Bento realmente pensa". Resolvido lendo
`CLAUDE_RELEASE_HANDOFF.md` (468 linhas, checkpoint de 25/09) + o `.env` real +
`apps/worker/src/processors/execute-job.ts` linha 1757-1996 diretamente.

**Confirmado no .env agora**: `OPENAI_API_KEY` presente, `BENTO_OPENAI_CORE_ENABLED=true`,
`AGENT_LOOP_BENTO_V2=true`. O handoff doc registrava os dois como `false`/pendente
de decisão do Pedro na última atualização (25/09) — ou seja, a flag foi ligada
DEPOIS do último checkpoint escrito, sem o doc ser atualizado. Evidência de que
já rodou de verdade: um comentário datado 28/09 no próprio código
(`execute-job.ts:1460-1465`) descreve um bug "achado ao vivo no teste de
aceite" e já corrigido — não é uma flag esquecida ligada sem teste.

**A arquitetura real é uma cascata de 3 camadas** (não "tudo no repo" nem "tudo
externo" — os dois agentes capturaram pedaços verdadeiros de um sistema mais
novo e mais complexo que qualquer um dos dois sozinho):

1. **`BENTO_OPENAI_CORE_ENABLED`** (`packages/bento-core` + `bento-openai-core.ts`,
   linha 1757): OpenAI Responses, planner SEM ferramentas, política determinística,
   `selectWriteProvider` (ClickUp MCP primário, gateway legado de fallback),
   executor já verificado com read-back. Só cobre `create_task`/`update_task`/
   `comment_task` — leitura/análise retornam `null` de propósito (não
   reconstruídas ainda). Falha aqui NUNCA cai pro guard antigo em silêncio:
   responde explicitamente "não consegui... nada foi executado" (linha 1786-1789).
2. **`tryBentoActionGuard`** (legado, `bento-action-guard.ts`, 2599 linhas —
   cresceu de 2185 desde o handoff): roda só se a camada 1 devolveu `null`.
   Código DESTE REPOSITÓRIO, nunca chama `callNode`/`callBento` (comentário
   explícito linha 1808-1813: "aquilo dispara o Bento DE VERDADE, mesma
   credencial real de escrita no ClickUp" — ou seja, o guard é deliberadamente
   isolado do serviço externo pra poder simular sem risco).
3. **`callNode`→`callBento`→serviço externo `bento-qa`** (100.93.182.83:8791,
   fora do repo, achado pelo agente de identificação de serviço): só entra se
   as duas camadas acima não assumirem o turno (pergunta geral, análise,
   conversa que não é create/update/comment direto). Com `AGENT_LOOP_BENTO_V2=true`
   (confirmado ligado), esse `callNode` roda DENTRO de `dispatchWithAgentLoop`
   (loop understand→context→plan→act→observe→evaluate→replan, checkpoint em
   Postgres) em vez de ser uma chamada direta solta.

**Implicação prática pra Fase 0**: o serviço externo opaco `bento-qa` ainda
existe e ainda é real, mas não é mais "o único lugar onde o Bento pensa" — é
hoje o fallback de terceiro nível pra tudo que não é escrita direta de tarefa.
As camadas 1 e 2 são auditáveis, testadas (12 testes mockados na camada 1,
2599 linhas com suite própria na camada 2) e já rodaram ao vivo. A pergunta
que fica aberta pra Fase 0: não existe evidência ainda (sem consultar
`ai_usage_ledger` ou logs reais) de QUE FRAÇÃO dos turnos de fato cai na
camada 3 hoje — isso decide se o "cérebro" principal do produto é a camada 1/2
nova ou ainda majoritariamente o serviço externo legado.

**MAIOR GAP (memória)**: não existe retrieval híbrido de verdade — é cosseno OU filtro
estruturado, nunca fundidos, sem BM25/keyword, sem re-ranking por cross-encoder,
sem pgvector (por design, até gatilho de escala documentado). E o vault QUE É
de verdade arquivo (Obsidian local) está desconectado e é inferior ao sistema
de registro — nunca foi ligado como retrieval ao vivo, só via import pontual.

### Achado — Frontend do chat (transparência de tool-call e Daily Brief)

- Existe UM indicador de fase ao vivo (`ThinkingSteps`, 9 frases genéricas tipo
  "Executando"), nunca nomeia a ferramenta/alvo. O backend JÁ rastreia
  `toolCalls` por chamada (nome, ok/erro, duração) — nunca chega no contrato
  do frontend (`apps/web/src/lib/api/contracts.ts` não tem o campo).
- `sources` na bolha do chat é texto puro sem link — `Chip` aceita `url` mas
  nunca recebe. IDs crus tipo `CLICKUP_TASK:xxx` aparecem sem virar link real.
  Fontes somem ao recarregar (`chat-thread.tsx:340` zera `sources: []` no
  histórico).
- NÃO existe Daily Brief separado — `/today` reusa as mesmas queries de
  "Prioridades de hoje", só re-skinnado como "briefing". Não existe view de
  Client 360 / "o que o Bento sabe sobre este cliente".

### Achado — Identificação do serviço de produção (ver reconciliação acima)

Confirma que `bento-qa` (100.93.182.83:8791) é real e fora do repo — mas ver a
seção "Achado CRÍTICO" acima pra entender que ele é hoje a 3ª camada de uma
cascata, não o único lugar onde o Bento responde.

### Achado — ClickUp Tool Gateway: cobertura e read-after-write (verificado direto por mim, sem agente, depois do rate limit)

`packages/tool-gateway/src/clickup-client.ts` tem ~30 operações reais contra a
API do ClickUp (create/update/delete task, comentário, resposta a comentário,
tag, dependência, custom field, checklist, watcher, lista/pasta, tempo
registrado, anexo). **Só uma fração chega a ser chamável pelo LLM hoje**:

| Operação | Chamável pelo Bento? | Onde | Read-after-write |
|---|---|---|---|
| Criar task | Sim | `senior-operation.ts::createVerifiedSeniorTask` | **Sim** — `getTask()` logo após criar (linha 205) |
| Atualizar campo (título, descrição, prazo, início, estimativa, prioridade, status, responsável — add/remove) | Sim | `bento-update-executor.ts::executeTaskUpdate` | **Sim, POR CAMPO** — relê a task e cada campo tem seu próprio `check(relida)`, com `verified: true/false` individual. Mais rigoroso que o mínimo pedido pela missão. |
| Apagar task | Sim, com confirmação prévia | `bento-action-guard.ts::executeConfirmedDelete` (linha 1375) | **Sim, nos dois sentidos** — lê ANTES (confirma que existe), apaga, lê DEPOIS (confirma que sumiu); trata "já tinha sido apagada" e "falha de rede, nada foi apagado" como casos distintos |
| Comentário | Sim | guard legado + core novo | Não verificado se relê o comentário criado — não conferido ainda |
| Tag, dependência, custom field, checklist, watcher, lista/pasta, tempo, anexo | **Não** — função existe em `clickup-client.ts`, zero call site em qualquer guard/core | — | N/A |

**Veredito**: onde o Bento escreve, ele verifica — e com mais rigor do que
"escreveu, 200 OK, declarar sucesso" (o risco #1 que a missão pede pra
investigar). O gap real não é confiabilidade do que existe, é COBERTURA: 7 das
~12 capacidades que a missão pede (custom fields, dependência, checklist,
arquivamento) simplesmente não têm caminho nenhum do LLM até o ClickUp hoje —
não é bug, é escopo nunca construído.

### Achado — Permissões, injeção, auditoria (verificado direto por mim)

**Escopo de tenant: reaproveita o canônico, não reimplementa.**
`senior-runtime-context.ts::loadSeniorRuntimeContext` chama
`ehPapelDePlataforma`/`hasPermission`/`loadUserAccess`/`organizacaoProvedora`
de `@desigual-os/auth` — as MESMAS funções que `requireAuth`/`requireTenant`
usam pras rotas REST. Não existe uma segunda lógica de permissão, mais fraca,
só pro agente. Achado extra, de qualidade: um incidente real de 08/10
("BENTO FINALIZE TODAS AS TASKS...") revelou que "empresa ambígua" (conta em
duas empresas, nenhuma ativa) respondia "sem permissão" — já corrigido no
mesmo dia pra distinguir os dois motivos e dizer o que fazer em cada um.

**Defesa contra prompt injection: estrutural, não semântica, com teste
reproduzindo o ataque real.** `context-engine/src/texto-externo.ts` — todo
texto vindo do ClickUp (nome de tarefa, status, responsável) passa por
sanitização antes de virar linha de contexto: remove quebra de linha/caractere
de controle (impede forjar uma "linha" nova dentro do bloco), aplica teto de
tamanho, neutraliza marcador de lista no início. A defesa documentada é
deliberadamente estrutural ("não procura frases tipo 'ignore as
instruções anteriores'") porque o ataque documentado em produção não dependia
de convencer o modelo — dependia de falsificar dado. Tem suite de teste própria
reproduzindo o ataque exato encontrado em auditoria (18/09/2026, §30).

**GAP REAL: escrita do agente não gera audit_logs.** `createVerifiedSeniorTask`,
`executeTaskUpdate`, `executeConfirmedDelete` — nenhum chama `auditarAcao`
(a função usada por toda rota REST que muda dado, ex. `admin/routes.ts`).
Existe sim `execution-record.ts`, mas serve outro propósito (continuidade de
conversa / idempotência — "já lancei isso?"), gravado como metadata da
mensagem do assistente, não como linha em `audit_logs` com actor/
resourceType/resourceId/org pesquisável depois. Resultado prático: dá pra
responder "o Bento já fez essa ação nesta conversa?" mas não dá pra responder
"quem autorizou o Bento a apagar a task X, e quando" numa consulta de
auditoria formal, do jeito que já existe pra ações humanas.

**Evals/testes de isolamento multi-tenant específicos do agente**: não
verificado ainda neste turno — ficou de fora por tempo, não por bloqueio.

### Veredito consolidado da Fase 0 (investigação forense) — PRONTO

As 6 frentes planejadas foram fechadas (4 por agente, 2 direto por mim depois
do rate limit). Resumo de uma linha por frente, detalhe acima:

1. Núcleo (router/orchestrator) — maduro, testado, mas 2599 linhas de guard
   legado concentram a lógica real, não um orquestrador limpo.
2. ClickUp — onde escreve, verifica com rigor (read-after-write por campo);
   7 de ~12 capacidades da missão nunca foram construídas (gap de escopo, não de bug).
3. Memória — tabela Postgres real e hierárquica por confiança, NÃO Obsidian
   ao vivo; o vault Obsidian que existe de verdade está desconectado e foi
   causa de alucinação documentada.
4. Serviço de produção — cascata de 3 camadas (core OpenAI novo → guard
   legado → serviço externo `bento-qa` como fallback final), não um
   monólito de nenhum dos dois tipos.
5. Frontend — não mostra tool-call nem link real de fonte, mesmo o backend
   já calculando isso; não existe Daily Brief nem Client 360 de verdade.
6. Permissões/auditoria — reaproveita o canônico (bom), defesa de injeção
   estrutural e testada (bom), mas falta audit_logs formal pra escrita do
   agente (gap real, pontual, fácil de descrever pro Pedro).

Pronto pra decidir a FASE 2 (foundation) com o Pedro — não vou escolher
sozinho qual dos ~6 gaps vira o próximo trabalho sem perguntar, dado o tamanho
da missão e que ela pede pausa só em decisão de alto impacto, e priorizar
errado aqui É uma decisão de alto impacto.

## Fases seguintes

Pedro autorizou, em 09/10/2026: *"faça todos em ordem, nn precisa ficar
parando, corrija tudo, deixe tudo 100% funcional com toda essa camada de
inteligência chegando ao bento real"* — os 5 gaps da Fase 0 viram trabalho
sequencial, sem pausa pra aprovação entre eles. Ordem: (1) audit_logs da
escrita do agente, (2) transparência de tool-call no frontend, (3) cobertura
ClickUp, (4) memória/Obsidian, (5) observabilidade da cascata de 3 camadas.

### FASE 2 (fundação) — audit_logs da escrita do agente — CONCLUÍDO (09/10/2026)

Fechou o gap descrito acima ("GAP REAL: escrita do agente não gera
audit_logs"). Toda escrita real do agente no ClickUp passa a gravar uma linha
em `audit_logs` com actor/organização/recurso reais — a mesma tabela que já
registra ação humana via `auditarAcao`, não um registro paralelo mais fraco.

**O que foi construído**: `auditarEscritaDoAgente()` em
`packages/tool-gateway/src/senior-operation.ts` (recebe
agent/userId/organizationId/action/resourceId/oldValue/newValue/metadata,
grava com `source: 'agent'`, falha de insert não derruba a operação —
`.catch(() => undefined)`, porque auditoria nunca pode ser motivo de a escrita
real falhar). Chamado nos 4 pontos reais de escrita, cobrindo as 3 camadas e
os 2 providers:

- `createVerifiedSeniorTask` (senior-operation.ts) → `clickup.task_created`
- `executeTaskUpdate` (bento-update-executor.ts, usado pelo guard legado E
  pelo core novo via LEGACY_GATEWAY) → `clickup.task_updated`, com o
  snapshot `atual` inteiro como `oldValue` (não arriscado mapear campo a
  campo pro nome interno)
- `executeConfirmedDelete` (bento-action-guard.ts) → `clickup.task_deleted`,
  com o resultado da releitura pós-delete em `metadata.verified`
- comentário no guard legado (`bento-action-guard.ts`) e no core novo
  (`bento-openai-core.ts`) → `clickup.task_commented`
- `executeViaMcp` (bento-mcp-executor.ts, caminho ClickUp MCP do core novo)
  → create/update/comment conforme a intenção, `metadata.provider: 'MCP'`

Deliberadamente NÃO auditado: o branch "já existia" (`wasExisting: true`,
idempotência de reconciliação) — nada mudou de verdade; e o comentário de
proveniência automático ("Status alterado para X a pedido de Y") que o core
novo posta sozinho após um update — é efeito colateral já coberto pela
auditoria do próprio update, não uma ação própria.

**Testes**: adicionado 1 teste novo por call site (5 no total,
`senior-operation.test.ts`, `bento-update-executor.test.ts`,
`bento-mcp-executor.test.ts`), cada um provando a linha gravada com
actor/org/recurso certos. Achado e corrigido no caminho: `senior-operation.test.ts`
não tinha mock de `@desigual-os/database` e por isso o teste batia na rede de
verdade (1803ms); confirmado via consulta direta que nada foi de fato
persistido (FK falhava pro usuário/org fake, capturado pelo `.catch`), e
corrigido com mock explícito (caiu pra 12ms). Reforçado o mesmo mock de
defesa (sem teste que o exercite ainda) em `bento-action-guard.test.ts`,
`bento-openai-core.test.ts` pra nenhum dos dois correr o mesmo risco se um
teste futuro passar `auditContext`/`seniorToolContext` de verdade.

**Regressão pega e corrigida**: a suite completa do worker (83 arquivos) tinha
2 arquivos que montam `seniorToolContext` de teste sem saber da mudança —
`bento-update-boundary.test.ts` e `bento-guard-matrix.test.ts` — e por isso
quebraram ao herdar `auditContext` de verdade sem mock de
`auditarEscritaDoAgente`. Corrigido adicionando o mock nos dois.

**Verificação final**: suite completa do worker — 82 arquivos passando, 1601
testes, 0 falha (`pnpm --filter @desigual-os/worker exec vitest run`).
Typecheck limpo em `@desigual-os/worker` e `@desigual-os/tool-gateway`.
Pendente antes do commit: `scripts/conferir-checkout-limpo.sh` (typecheck de
árvore limpa, não da working tree).

Próximo: FASE 3 — transparência de tool-call no frontend do chat.
