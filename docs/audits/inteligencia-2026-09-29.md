# Por que o Claude sabe mais sobre a Agência Desigual do que o Desigual OS

Auditoria de INTELIGÊNCIA — 29/09/2026
Branch `feat/otto-motion-engine`, commit `a15f6e9`, stack viva (API :3001, worker, Redis, Postgres Supabase, ClickUp MCP autorizado).

Esta auditoria não repete a forense de 25-26/09 (`forensic-diagnosis-2026-09-26.md`), que é sobre **segurança de escrita**. Esta é sobre **o que o sistema sabe**. São problemas disjuntos: o sistema pode ser perfeitamente confiável ao escrever e ainda assim não entender a agência.

Toda medição abaixo é reproduzível pelos harnesses citados. Nenhuma alteração de produção foi feita para produzi-las.

---

# A. EXECUTIVE SUMMARY

O Claude externo não é mais inteligente que o Desigual OS. Ele apenas **não tem portões**.

Quando alguém pergunta ao Claude "analise todo o ClickUp da agência", o Claude abre o conector, enumera espaços, pastas, listas, membros e tarefas, decide o que olhar em seguida, olha de novo, e só então escreve. São dezenas de consultas guiadas pelo que ele vai descobrindo.

Quando a mesma pergunta chega ao Desigual OS, ela atravessa **cinco portões**, e cada um joga fora informação:

| # | Portão | O que perde | Medido |
|---|---|---|---|
| 1 | **Léxico** — uma lista de palavras decide se o ClickUp será consultado | 12 das 21 perguntas do benchmark nunca disparam consulta nenhuma | `intelligence-benchmark-context.mts` |
| 2 | **Escopo** — só enxerga "uma lista do ClickUp por cliente" | espaços, pastas, docs, comentários, histórico, subtarefas e 6 clientes sem lista (inclusive John Deere) | `clickup_tasks` = 0 linhas no banco |
| 3 | **Compressão** — 1.222 tarefas viram um briefing de 7.582 caracteres | 29.920 caracteres de dado real montados e **descartados** | `GOLD-contexto-bruto.txt` vs `GOLD-contexto-enviado.txt` |
| 4 | **Chamada única** — um turno é uma chamada de LLM, sem volta | nenhuma pergunta de segunda ordem, nenhum cruzamento | `retrieveHandler` não recupera nada (§C-05) |
| 5 | **Cérebro externo** — quem escreve a resposta é um serviço fora deste repositório | retrieval, modelo e síntese não são observáveis nem ajustáveis daqui | `callBento` → `http://100.93.182.83:8791` |

O Claude atravessa zero desses portões.

**A conclusão desconfortável:** o Desigual OS tem HOJE, no banco de produção, quase tudo que o Claude inferiu do ClickUp — 860 campanhas reconciliadas, 23 pessoas, 289 relações pessoa↔cliente, 633 eventos de mudança, 101 dossiês de cliente. Nada disso chega ao modelo quando a pergunta é sobre a agência. **O problema não é falta de dado. É que o caminho entre o dado e a resposta está interrompido em cinco lugares.**

E há uma agravante que inverte o argumento de valor: para a pergunta-ouro, o sistema entregou ao usuário o número **errado** — "1222 tarefas ativas" quando 811 delas estão concluídas e apenas 411 estão abertas. O próprio bloco que ele montou e jogou fora dizia, em letras maiúsculas, "811 task(s) já concluídas ficaram FORA desta lista — não as apresente como pendentes". O sistema tinha a verdade em mãos e mandou a versão errada.

---

# B. DATA FLOW ATUAL (medido, não documentado)

```
PERGUNTA DO USUÁRIO
   │
   ▼
[apps/api/src/chat/routes.ts]
   │
   ├─► resolveOperationalScope()  ◄── PORTÃO 1: lista de palavras
   │      operational=false em 12/21 perguntas → NADA daqui pra baixo acontece
   │
   ├─► listAuthorizedClients()    ◄── PORTÃO 2: 52 listas do ClickUp
   │      (6 clientes sem lista são invisíveis; espaços/pastas/docs não existem)
   │
   ├─► queryOperationTasks()      ── 1.222 tarefas, 2 lotes paralelos, ~40s
   │
   ├─► buildOperationalContext()  ── monta 29.920 chars  ─────┐
   │                                                          │ DESCARTADO
   └─► buildOperationalBriefing() ── monta 7.582 chars  ◄── PORTÃO 3
          │                          (e conta as 811 concluídas como abertas)
          ▼
   messages.metadata + AgentJobData.operationalContext
          │
          ▼
[apps/worker/src/processors/execute-job.ts]
          │
          ├─ AGENT_LOOP_V2 ausente do .env ──► o dispatch agêntico NÃO RODA
          │     (morto: plano, ContextPack, evidência, grounding, episódios,
          │      bloco de cliente, preferências, contexto cruzado)
          │
          └─► callBento(message, operationalContext)   ◄── PORTÃO 4: uma chamada
                     │
                     ▼
          POST http://100.93.182.83:8791/ask          ◄── PORTÃO 5: caixa-preta
          { question, channel, operational_context }
                     │
                     ▼
          busca vetorial própria no vault + síntese com modelo próprio
                     │
                     ▼
                  RESPOSTA
```

**O que efetivamente chega ao modelo, para o Bento, em produção:** a pergunta crua e o campo `operational_context`. Mais nada. Nem dossiê do cliente, nem campanha, nem pessoas, nem episódios, nem preferências, nem o diálogo recente — `aceitaContextoNaMensagem('bento')` é `false`, e todo o resto mora no dispatch agêntico, que está desligado.

---

# C. PRINCIPAIS GARGALOS

### C-01 — O portão léxico decide se o sistema vai olhar para a operação · ARCHITECTURE · P0

**Arquivo:** `packages/context-engine/src/resolve-scope.ts` (`GLOBAL_MARKERS`, `OPERATIONAL_MARKERS`, `COMPARATIVE_MARKERS`)

Antes de qualquer dado ser buscado, uma lista de strings decide se a pergunta é "operacional". Medição das 21 perguntas do benchmark (`apps/worker/scripts/intelligence-benchmark-context.mts`):

| Pergunta | Escopo | Operacional | Tarefas entregues |
|---|---|---|---|
| Me explique tudo que você sabe sobre a Agência Desigual | **CLIENT** | **não** | **0** |
| Quem trabalha aqui e qual é a função de cada pessoa? | NONE | não | 0 |
| Quais são os maiores riscos operacionais neste momento? | NONE | não | 0 |
| Quais projetos internos parecem abandonados? | NONE | não | 0 |
| Quem está sobrecarregado? | GLOBAL | **não** | **0** |
| Quais tarefas dependem do Endrigo? | **CLIENT** | sim | **0** |
| Quais clientes entraram recentemente? | GLOBAL | não | 0 |
| Quais clientes saíram recentemente? | GLOBAL | não | 0 |
| Qual é o estado atual do Desigual OS? | NONE | não | 0 |
| Qual é o estado do Citável? | CLIENT | não | 0 |
| Quais ações os agentes realizaram recentemente? | NONE | não | 0 |
| Quais informações estão inconsistentes no ClickUp? | NONE | não | 0 |
| O que está parado há mais tempo? | NONE | não | 0 |

**12 de 21 (57%) chegam ao modelo com zero dado operacional.** Não porque o dado não exista — porque a frase não continha nenhuma das palavras da lista.

Dois casos merecem nome próprio:

- **"Quem está sobrecarregado?"** resolve `GLOBAL` (o marcador comparativo `sobrecarregad` casa) mas `operational` continua `false`: os marcadores comparativos definem o escopo e não ligam a consulta. O escopo certo, sem dado nenhum.
- **"Me explique tudo que você sabe sobre a Agência Desigual"** resolve `CLIENT`, porque **"Agência Desigual" é uma linha na tabela `clients`** (170 tarefas no ClickUp). A pergunta-síntese sobre a agência é tratada como pergunta sobre um cliente, e sai sem operacional.

### C-02 — A janela para o ClickUp é "uma lista por cliente"; a estrutura do workspace não é legível · ARCHITECTURE · P0

**Arquivos:** `packages/tool-gateway/src/clickup-client.ts`, `packages/context-engine/src/build-operational-context.ts:104`

O único caminho de leitura é `queryOperationTasks({ listIds })`, e `listIds` sai de `clients.clickup_list_id`. Consequências medidas:

- **`clickup_tasks` = 0 linhas. `clickup_spaces` = 0. `clickup_lists` = 0. `clickup_workspaces` = 0.** As tabelas existem no schema e nunca foram escritas. Não há índice local do ClickUp: cada turno é uma consulta ao vivo de ~40s, e nada fica.
- O cliente tem **`getSpaces` apenas dentro do fluxo de OAuth** (`clickup-oauth.ts:122`), para descobrir espaços na hora de conectar. Nenhum caminho de conhecimento lê espaço, pasta ou Doc.
- `getTaskComments` existe, mas só é chamado com um `taskId` que já se conhece. Comentário nunca é fonte de descoberta.
- Não existe leitura de histórico de task.
- **CORRIGIDO NO MESMO DIA, e a correção muda a conclusão.** Esta linha dizia também "nem de subtarefa como entidade, nem de relação entre tarefas", e eu concluí daí que faltava DADO. Faltava leitura, não dado: o campo `parent` sempre veio na listagem do ClickUp e era descartado no parse. A sessão paralela mediu o que ele continha e o número é uma descoberta sobre como a agência trabalha, não sobre a ferramenta — nos três maiores clientes, `dependencies` vem 0 de 253 e `linked_tasks` 0 de 253, mas **221 de 253 são subtarefa**. A agência não usa dependência do ClickUp; usa árvore. Ver `apps/worker/src/processors/bento-arvore.ts`, que passou a montar a árvore, apurar frentes e diagnosticar causa de atraso — e que se proíbe de afirmar dependência entre tarefas, justamente porque esse dado não existe.
- **6 clientes ativos não têm lista vinculada e são inteiramente invisíveis:** FESTARA, Botini, Gelateria Fratelli, Home Center Tecaut, Sonhar Painéis e **John Deere** — o cliente citado no próprio briefing desta missão como exemplo de risco.

Os 20 itens que o Claude enumerou sobre espaços, organização do workspace, infraestrutura e riscos técnicos não são "coisas que o Desigual OS respondeu mal". São coisas que **nenhum código deste repositório consegue enxergar**.

### C-03 — O briefing conta tarefa concluída como tarefa aberta · BUG · P0

**Arquivo:** `apps/api/src/lib/operational-context.ts:320` e `:338`

```js
queryTasks: async (query) => {
  const result = await queryOperationTasks(config, query);
  tarefasBuscadas = result.tasks;          // ← lista CRUA, com as concluídas
  ...
}
// ...
const briefing = buildOperationalBriefing({ tasks: tarefasBuscadas, ... });
```

`buildOperationalContext` filtra `statusType === 'done' | 'closed'` internamente e nunca expõe o conjunto filtrado. O briefing recebe o cru.

Os dois blocos, montados no mesmo turno a partir da mesma consulta, discordam:

```
bloco bruto (descartado):  411 tarefa(s) aberta(s) ... 130 sem responsável
                           (811 task(s) já concluídas/prontas ficaram FORA desta lista
                            de abertas — não as apresente como pendentes.)

briefing (ENVIADO):        1222 tarefa(s) | 146 atrasada(s) | 157 sem responsável
```

E a resposta ao vivo do Bento reproduziu fielmente o número errado:

> "O sistema operacional da Agência Desigual está **sobrecarregado com 1222 tarefas ativas** (...) Temos 809 itens marcados como prontos"

O usuário recebeu, num briefing executivo, um volume operacional **3× maior que o real**. A porta que existe para pegar isso — `checkCountConsistency` — mora no `verifyHandler` do loop agêntico, que está desligado (C-06).

### C-04 — 75% do dado consultado é montado e jogado fora · CONTEXT · P1

**Arquivo:** `apps/api/src/chat/routes.ts:531`

```js
operationalTurn.briefingBlock ?? formatOperationalContextForPrompt(operationalTurn.context)
```

Quando o pedido é de briefing — exatamente a pergunta-ouro — o `briefingBlock` **substitui** a listagem. Medido para a pergunta-ouro:

- consultadas: 1.222 tarefas (~40s de ClickUp, sem truncamento)
- montado: **29.920 chars** de listagem por cliente, com nome, status, prazo, responsável e marca de atraso
- enviado: **7.582 chars** (~1.900 tokens) de briefing
- nomeados no briefing: **8 tarefas**, todas do ranking de prioridade

O limite do serviço externo é de 120.000 bytes. Não havia restrição de tamanho: os 29.920 chars caberiam com folga ao lado do briefing. A perda é de desenho, não de orçamento.

### C-05 — O passo de "retrieve" não recupera nada · ARCHITECTURE · P0

**Arquivo:** `apps/worker/src/processors/agentic-dispatch.ts:896`

```js
const retrieveHandler: StepHandler = async () => ({
  ok: true,
  observation: `contexto e memória prontos: ${state.evidence.length} evidência(s), ${episodes.length} episódio(s)`,
});
```

O plano adaptativo (`packages/agent-runtime/src/planner.ts`) é um **template escolhido por regex**, com cinco formas fixas. Em todas elas o primeiro passo é `retrieve`, descrito como *"recuperar estado operacional ao vivo (ClickUp) no escopo certo"*. Ele não consulta nada: relata o que a API já tinha buscado antes de enfileirar o job.

Não existe, em nenhum ponto do sistema, um passo que olhe para o que foi recuperado e decida buscar mais. A resposta do §6 do briefing é **A**, sem ambiguidade: uma chamada de LLM com contexto parcial.

Para "me entregue um briefing completo de tudo que você sabe sobre a agência", o comportamento correto seria decompor em estrutura / pessoas / clientes / projetos / atrasos / riscos / mudanças e consultar cada domínio. Nada disso existe.

### C-06 — Toda a máquina agêntica está desligada em produção · ARCHITECTURE · P0

**Arquivos:** `apps/worker/src/processors/execute-job.ts:109-131`, `.env`

`AGENT_LOOP_V2` **não existe no `.env`** e não há `AGENT_LOOP_BENTO_V2`. `parseAgentLoopFlag(undefined)` devolve um `Set` vazio: o loop está desligado para todos os agentes. O próprio código já documenta isso (`execute-job.ts:1710`: *"AGENT_LOOP_V2 está desligada em produção"*).

Fica morto em produção, apesar de existir, testado e commitado:

- `buildPlan` / `runStepLoop` — plano, replan, avaliação
- `assembleContext` / ContextPack — ordem por autoridade, piso por bloco, orçamento de 14.000 chars
- `groundClaims` e `checkCountConsistency` — a porta que teria pego o "1222 tarefas ativas"
- bloco de cliente, campanha, pessoas, episódios, preferências, aprendizado
- `resolveCrossAgentContext` — o contexto do outro agente
- registro de evidência e proveniência por bloco

O caminho direto entrega ao Bento a mensagem crua e o `operational_context`. O bloco de cliente e o diálogo recente são anexados **só para quem está em `NODES_QUE_LEEM_CONTEXTO_NA_MENSAGEM`** — `otto`, `jarbas`, `suzy`, `studio`. O Bento está fora da lista de propósito (colar contexto na mensagem dele sequestra a detecção de intenção), e nunca ganhou um caminho alternativo.

**Efeito líquido: o agente responsável pela operação e pela memória institucional é o único que não recebe memória institucional.**

### C-07 — O event store é write-only: "o que mudou?" é irrespondível · MEMORY · P0

**Arquivos:** `packages/orchestrator/src/event-store.ts:141`, `packages/orchestrator/src/event-intelligence.ts`, `apps/worker/src/processors/operational-events.ts`

Estado medido no banco:

- `operational_events` = **633 linhas**, 100% processadas, 0 erros
- tipos existentes: `task.updated` (376) e `task.created` (257) — e mais nada
- **`eventsSince()` tem ZERO chamadores** em todo o repositório. A função que existe exatamente para responder *"o que mudou desde X?"* nunca foi ligada a nada.
- `reactToEvent` devolve `{ updatesState: true, signal: null }` para os dois únicos tipos que chegam. O `processPendingEvents` **ignora `updatesState` por completo** — só olha `reacao.signal` — e incrementa um contador chamado `stateOnly`. Nenhum estado é atualizado em lugar nenhum.
- `notifications`: 2.332 linhas, das quais **2.195 são `chat.execution_completed`** (recibo de "o Bento respondeu"). 16 `morning_briefing`, 13 `daily_checklist`. **Zero sinais proativos de risco.** Nunca nasceu um.

A cadeia completa: 633 eventos reais gravados → marcados como processados → nada lido → nada notificado. O comentário do próprio módulo diz *"o Bento 'sabe' o que houve"*. Ele não sabe.

Medido ao vivo: à pergunta "O que mudou na agência nos últimos 7 dias?", o Bento respondeu com uma **lista de tarefas que vencem na janela** — não com o que mudou. Os 633 eventos de mudança não foram consultados.

### C-08 — Memória é `ILIKE` com teto de 6 a 12 itens · RETRIEVAL · P1

**Arquivos:** `packages/orchestrator/src/memory-engine.ts:342`, `packages/orchestrator/src/episodic-memory.ts:227,412`

Não há busca semântica neste repositório. O próprio código declara (`memory-engine.ts:27`): *"não gera embedding. Não existe pgvector nem geração de embedding neste repo"*. A tabela `embeddings` guarda vetor como `jsonb` e está vazia.

O recall é `ILIKE '%termo%'` ordenado por recência, com `limit 10` (semântica), `limit 12` (episódica temporal) e `limit 6` (episódica factual). Não há reranking, filtro por metadado além de cliente/environment, query rewriting, decomposição, multi-query nem retrieval recursivo.

Volume real: `agent_episodes` = **31 linhas** para toda a história da agência, das quais 15 em ambiente `qa`. A memória episódica de produção tem 16 registros.

### C-09 — Pessoas não têm função, e as relações só sabem "apareceu como responsável" · DATA · P1

**Arquivo:** `packages/database/src/schema/knowledge-plane.ts`

A tabela `people` tem 23 linhas (19 `agency_member`). Ela **não tem campo de função/cargo**: só `employment_type` (`agency_member` | `external` | `unknown`) e `active_status`.

`person_client_relations` tem 289 linhas e **um único `relation_type`: `TASK_ASSIGNEE`**. Os tipos `ACCOUNT_MANAGER`, `CLIENT_OWNER`, `CREATIVE_CONTRIBUTOR` estão no schema e nunca foram escritos.

Por isso "Quem trabalha aqui e qual é a função de cada pessoa?" é estruturalmente irrespondível — e por isso o Claude, que **inferiu funções a partir dos padrões de tarefa**, pareceu saber mais. O dado bruto para essa inferência está no ClickUp; o Desigual OS derivou dele apenas "esta pessoa apareceu como responsável neste cliente".

Agravante de frescor: o último `last_seen_at` de qualquer pessoa é **16/09/2026** — 13 dias atrás. A consolidação noturna (`knowledge-consolidation.ts`) reconcilia **campanhas e episódios**; não reconcilia pessoas. Gabriel Valenço — o exemplo de risco operacional do briefing — está registrado como `unknown`/`unknown`.

### C-10 — O cérebro que responde não está neste repositório · ARCHITECTURE · P1

**Arquivo:** `apps/worker/src/processors/execute-job.ts:324` (`callBento`)

```js
const url = process.env.BENTO_QA_URL ?? 'http://100.93.182.83:8791';
```

A resposta do Bento é produzida por `bento-qa`, um serviço num Mac Mini via Tailscale. O Desigual OS manda `{ question, channel, operational_context }` e recebe `{ answer, citations }`. O `usage` volta sempre `{0, 0}`.

Consequências:

- **A escada de modelos (`luna`/`terra`/`sol`) não governa a resposta do Bento.** Ela governa o *planner de escrita* (`clickup_write` → `terra`). Trocar o modelo em `packages/openai-provider` não muda uma vírgula do briefing.
- O retrieval sobre o vault é do serviço externo. Foi ele que respondeu "Me explique tudo sobre a Agência Desigual" com quatro trechos costurados — `08_Suzy/instagram-endrigo.md`, `07_Aprendizados-Jarbas/2026-07-29_site_dossie2-estado-e-fix-spawn-kimi.md`, `03_Equipe/jarbas-de-andrade-persona.md`, `clientes/ibiza-ii/cerebro.md` — apresentando uma nota de desenvolvimento ("Dossiê 2 e fix do spawn Kimi") como conhecimento sobre a agência.
- **O serviço externo tem credencial própria do ClickUp.** À pergunta "Quem está sobrecarregado?", em que o nosso pipeline entregou zero tarefas, ele respondeu com números por pessoa — "Ana Luiza (...) 198 atrasadas" — quando o total de atrasadas da agência inteira, medido por nós, é **146**. São números que o Desigual OS não produziu, não consegue verificar e não consegue reconciliar.

### C-11 — Fixtures de QA e duplicatas entram no briefing da agência · DATA · P1

`clients` (58 ativos) é ao mesmo tempo o registro de clientes e o registro de tudo, e está sujo. Dentro do briefing executivo da agência entraram:

- **`teste` (28 tarefas)**, `Cliente Teste 7` (18) e `Clinica Teste Fase 7` (6) — **52 tarefas de fixture** apresentadas como operação real
- duplicatas: `Biofit`/`BIO FIT`, `Colpar`/`Colpar Brasil`, `Cosentino`/`🔥 Construtora e Imobiliária Cosentino Ltda. — Enterprise`, e `🧪 Case #0 — Endrigo Almada / CITÁVEL™` **duas vezes**, variando só a caixa
- pessoas como clientes: `Endrigo Almada`, `André Almada`
- a própria agência como cliente: `Agência Desigual` (170 tarefas)

Medido ao vivo: a resposta a "O que mudou nos últimos 7 dias?" listou `QA CAMPOS 1790624559995` e `[QA FORENSE 2509] Reel aprovado` como entregas da agência.

O item 22 do baseline do Claude era "duplicações". O Desigual OS tem duplicações **no seu próprio registro**, dentro do contexto que envia, e nunca as reportou — porque ninguém nunca olha para a tabela `clients` como objeto de análise.

### C-13 — O guard de escrita recusa a pergunta executiva mais importante · BUG · P0

Medido ao vivo, benchmark Q20:

> **"Faça um briefing executivo completo da agência."**
> → *"Não tenho autorização de escrita para esse cliente."* (status: `failed`, 51 caracteres)

O verbo "Faça" casa com o vocabulário de escrita do guard, e o kill switch `BENTO_EXTERNAL_WRITE_ENABLED=false` — criado pela forense de 26/09 para fechar o F-01 (P0 de escrita cega no serviço externo) — barra a mensagem. Uma pergunta de **leitura pura** é recusada como se fosse mutação.

É o §24 do briefing desta missão em estado puro: o endurecimento de confiabilidade cobrou preço em inteligência, e ninguém mediu esse preço porque a bateria de QA testa escrita, não conhecimento. A pergunta-título do benchmark executivo não sobrevive ao próprio sistema de segurança.

Correção (não aplicada nesta rodada, exige revisão junto ao ADR de convergência): o classificador precisa distinguir "faça um briefing" (produzir texto) de "faça uma task" (mutar recurso). O sinal existe — o objeto direto — e hoje não é olhado.

### C-14 — Quando acerta sobre pessoas, acerta por acidente · RETRIEVAL · P1

Q02, "Quem trabalha aqui e qual é a função de cada pessoa?", foi respondida com detalhe real e correto:

> "Alícia é a principal no atendimento, Tammy atua como secundária (em rampa), e o Sain cuida da validação de copy. Na produção criativa, temos a Bruna na edição de vídeo institucional, Celso na edição de vídeo dos 20 anos, Gui no design com foco em IA e o Endrigo à frente da direção criativa."

**Fonte única: `clientes/da-mata/cerebro.md`.** O organograma da agência estava escrito, de passagem, dentro do arquivo de um cliente. A tabela `people` (23 linhas, 19 membros) não foi consultada — nem poderia, porque não tem campo de função (C-09).

O acerto não é reproduzível, não é verificável e some no dia em que alguém editar aquele arquivo. Um sistema que conhece a agência não pode depender de o organograma estar no lugar errado.

Q17, "Quais ações os agentes realizaram recentemente?", mostra o outro lado da mesma moeda: oito fontes do vault, todas de abril a julho de 2026, falando de auditoria de código e de alcance no Instagram. Nenhuma linha sobre o que Bento, Otto ou Jarbas fizeram — apesar de `executions` ter **510 execuções do Bento nos últimos 7 dias** e `tool_calls` registrar as ações reais. A pergunta sobre os agentes foi respondida por deriva semântica num vault.

### C-12 — O "shared brain" está morto · ARCHITECTURE · P2

`agent_messages` (A2A) tem **6 linhas**, todas de 16-17/09/2026, todas `CONTEXT_REQUEST` entre Bento e Otto. Nada desde então.

`resolveCrossAgentContext` é acionado por regex, exige um `campaignId` ou `clientId` já resolvido, e vive dentro do dispatch agêntico — que está desligado (C-06). Na prática, os quatro agentes são quatro serviços em quatro máquinas, com quatro memórias.

---

# D. AGENT INTELLIGENCE MAP

| | **Bento** | **Jarbas** | **Suzy** | **Otto** |
|---|---|---|---|---|
| **Onde roda** | `bento-qa`, Mac Mini externo (:8791) | serviço externo (:3102) | serviço externo (:3102) | `otto-node` local (Ollama) |
| **Modelo** | desconhecido daqui | desconhecido daqui | desconhecido daqui | Ollama local + OpenAI no gap-fill |
| **Fontes que recebe** | pergunta + `operational_context` | pergunta + contexto na mensagem + comparação de período | pergunta + contexto na mensagem | pergunta + bloco de cliente + diálogo + dossiê + brand kit |
| **Memória que recebe** | **nenhuma** deste repositório | diálogo recente | diálogo recente | dossiê, feedback, episódios (no caminho agêntico) |
| **Ferramentas** | escrita no ClickUp via core novo (planner+policy+MCP/REST); leitura pelo serviço externo | leitura de métricas (read-only por política) | — | Studio, Motion Engine |
| **Planejamento** | planner **só de escrita** (schema de mutação de task); leitura não tem planner | não | não | pipeline criativo fixo (template) |
| **Investiga antes de responder** | não | não | não | não |
| **Sabe o que os outros fizeram** | não (A2A parado desde 17/09) | não | não | não |
| **Handoff** | Bento→Jarbas existe (`bento-jarbas-handoff.ts`) | Jarbas→Otto previsto, não medido | — | Otto→Studio funciona (9 handoffs) |
| **Entende cliente/projeto/pessoa** | cliente sim (pela lista); pessoa não; projeto não | por conta de mídia | — | cliente sim (dossiê + brain) |

O padrão é o mesmo nos quatro: **nenhum investiga antes de responder.** A diferença de qualidade entre eles vem inteiramente de quanto contexto o orquestrador conseguiu empurrar na única chamada.

Observação sobre volume (7 dias): Bento 510 execuções concluídas + 36 falhas, Jarbas 133, Otto 81, Suzy 3.

---

# E. CLAUDE VS DESIGUAL — o teste real

Pergunta idêntica, ao vivo, 29/09/2026 12:39 (`artifacts/intelligence-benchmark/GOLD.json`):

> "Analise todo o ClickUp da agência e me entregue um briefing completo de tudo que você sabe sobre a agência."

**Desigual OS:** 43s, 1.606 caracteres, 4 parágrafos. Resposta completa no artefato.

Comparação pelas 24 dimensões que o Claude cobriu:

| # | Dimensão | Claude | Desigual | Por quê |
|---|---|---|---|---|
| 1 | identidade e estrutura | ✅ | ⚠️ parcial | só via trechos do vault |
| 2 | espaços do ClickUp | ✅ | ❌ | nenhum código lê espaço (C-02) |
| 3 | composição da equipe | ✅ | ❌ | `people` existe, nunca entra no contexto (C-06/C-09) |
| 4 | funções inferidas das tarefas | ✅ | ❌ | só `TASK_ASSIGNEE` (C-09) |
| 5 | carteira de clientes | ✅ | ✅ | 42 clientes com contagem, no briefing |
| 6 | clientes recorrentes | ✅ | ❌ | sem histórico (C-02) |
| 7 | entradas recentes | ✅ | ❌ | `created_at` de cliente nunca consultado |
| 8 | churn | ✅ | ❌ | `deleted_at` nunca consultado |
| 9 | pipeline comercial | ✅ | ❌ | fonte não conectada |
| 10 | atrasos | ✅ | ⚠️ número errado | 146 sobre base inflada (C-03) |
| 11 | tarefas críticas | ✅ | ✅ | 8 nomeadas com motivo |
| 12 | próximos vencimentos | ✅ | ⚠️ parcial | só o topo do ranking |
| 13 | projetos internos | ✅ | ⚠️ achatados | viram "cliente Agência Desigual (170)" |
| 14 | Desigual OS | ✅ | ❌ | idem |
| 15 | Citável | ✅ | ❌ | é linha de cliente; pergunta sai sem operacional |
| 16 | Cérebro da Agência | ✅ | ⚠️ | só no vault externo |
| 17 | projetos pessoais do Endrigo | ✅ | ⚠️ | vira "cliente Endrigo Almada" |
| 18 | infraestrutura | ✅ | ⚠️ acidental | apareceu como nome de tarefa ("Configurar Mac Mini") |
| 19 | riscos técnicos | ✅ | ❌ | — |
| 20 | organização do workspace | ✅ | ❌ | não enxerga a estrutura (C-02) |
| 21 | inconsistências de status | ✅ | ❌ | dado presente, nunca analisado |
| 22 | duplicações | ✅ | ❌ | tem duplicatas próprias e não as vê (C-11) |
| 23 | riscos comerciais | ✅ | ❌ | fonte não conectada |
| 24 | relações entre acontecimentos | ✅ | ❌ | sem grafo, sem eventos (C-07) |

**Placar: 3 entregues, 6 parciais, 15 ausentes.** E dos 3 entregues, 1 está com número errado.

**O teste da vantagem (§23) — onde o Desigual deveria ganhar de lavada:**

| Pergunta | Resultado medido |
|---|---|
| "O que mudou nos últimos 7 dias?" | listou tarefas que **vencem** na janela, não o que mudou. 633 eventos ignorados. Incluiu fixtures de QA como entregas reais. |
| "Quais tarefas dependem do Endrigo?" | *"Não tenho a lista de tarefas que dependem do Endrigo nos dados."* — Endrigo resolveu como **cliente**, consultou a lista dele (vazia) |
| "Quem está sobrecarregado?" | respondeu com números do serviço externo que contradizem os nossos (198 atrasadas para uma pessoa, contra 146 na agência inteira) |
| "Quais ações os agentes realizaram?" | escopo NONE, zero dado — apesar de `executions` ter 510 execuções de 7 dias |

**Estas são as perguntas que justificam o produto existir, e são as que o sistema responde pior.**

---

## Benchmark completo — a linha de base

25 perguntas, ao vivo, conversa nova a cada uma (`artifacts/intelligence-benchmark/SUMMARY.json`):

| Métrica | Valor |
|---|---|
| Cobertura factual agregada | **20/45 (44%)** |
| Tamanho médio da resposta | **793 caracteres** |
| Respostas vazias ou falhas | 3 de 25 (Q20 recusada, V02 timeout, Q09 admitindo não saber) |
| Latência média | ~34s |

**793 caracteres é a medida mais eloquente desta auditoria.** O baseline do Claude cobriu 24 dimensões da agência; a resposta média do Desigual OS tem o tamanho de um parágrafo e meio. Não é um problema de verbosidade do modelo — é que não há o que dizer com 1.900 tokens de contexto.

Perguntas que falharam por completo:

| ID | Pergunta | Resultado |
|---|---|---|
| Q20 | Faça um briefing executivo completo da agência | **recusada pelo guard de escrita** (C-13) |
| V02 | O que o Bento fez hoje? | timeout em 60s, resposta vazia |
| Q09 | Quais tarefas dependem do Endrigo? | "Não tenho a lista (...) nos dados" (63 chars) |
| Q18 | Quais informações estão inconsistentes no ClickUp? | 109 chars, 0/2 |
| Q19 | O que está parado há mais tempo? | 163 chars |

A cobertura de 44% é medida por presença de termo e é **generosa de propósito** — ela conta como acerto qualquer resposta que mencione a palavra esperada, mesmo quando o conteúdo vem do lugar errado (C-14). A matriz dimensional da seção E é a medida honesta.

---

# F. ROOT CAUSE — a quem atribuir

Sem percentuais inventados. A atribuição abaixo é por **contagem de dimensões perdidas** e pelo ponto do fluxo onde cada uma morre.

| Camada | Dimensões que morrem aqui | Evidência |
|---|---|---|
| **ARQUITETURA — ausência de plano de pesquisa** | todas as 15 ausentes, sem exceção: nenhuma delas sobreviveria mesmo com as outras camadas perfeitas, porque ninguém decide buscá-las | C-05, C-06 |
| **DADOS/INTEGRAÇÃO — fontes não conectadas** | 2, 6, 7, 8, 9, 19, 20, 23 (8 dimensões) — não existe caminho de leitura | C-02 |
| **RETRIEVAL — portão léxico** | 57% das perguntas do benchmark não disparam consulta | C-01 |
| **CONTEXTO — compressão e descarte** | 12, 13, 14, 17, 18 chegam ao modelo mutiladas | C-04 |
| **MEMÓRIA — write-only e sem semântica** | 21, 24 e toda a dimensão temporal | C-07, C-08 |
| **BUG** | a dimensão 10 sai com número 3× errado | C-03 |
| **MODELO** | **nenhuma** | ver abaixo |
| **PROMPT** | **nenhuma** | ver abaixo |

**Sobre modelo:** trocar o modelo não resolve nada aqui, e não é opinião — é aritmética. O modelo do Bento recebeu **1.896 tokens** de contexto operacional para descrever uma agência de 58 clientes e 1.222 tarefas, e o número principal que recebeu estava errado. O melhor modelo do mundo, com esse input, escreve exatamente o que foi escrito. Além disso o modelo do Bento **não está neste repositório** (C-10): a escada `luna`/`terra`/`sol` governa o planner de escrita, não a resposta.

**Sobre prompt:** as instruções do briefing são boas — marcam KNOWN/DERIVED/MISSING, proíbem inventar, exigem nomear tarefas e responsáveis. O modelo obedeceu. O problema é o que foi entregue a elas.

**A causa-raiz única, se for para escolher uma:** o Desigual OS trata "responder" como *formatar o contexto que já tem*, e nunca como *descobrir o que precisa saber*. Todas as outras causas são consequências dessa.

---

# G. ARQUITETURA PROPOSTA

## Hoje

```
pergunta → portão léxico → 52 listas → briefing comprimido → 1 chamada → caixa-preta → resposta
```

## Proposta — preservando o que já funciona

O que **não** muda: `buildOperationalBriefing` (a marcação de procedência é boa), `campaigns`/`people` (o plano de conhecimento é bom), o core de escrita do Bento, o event-store (a gravação funciona), a consolidação noturna, o Otto e o Motion Engine.

```
                        ┌──────────────── FONTES ────────────────┐
                        │ ClickUp (tasks, spaces, folders, lists,│
                        │ members, comments, docs) · vault ·     │
                        │ chat · Meta Ads · execuções dos agentes│
                        └────────────────┬───────────────────────┘
                                         │ webhook (já existe) + varredura incremental (nova)
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │  ESPELHO LOCAL DO CLICKUP  (tabelas que  │
                    │  já existem e estão vazias: clickup_*)   │
                    │  + operational_events (já grava)         │
                    └────────────────┬────────────────────────┘
                                     ▼
                    ┌─────────────────────────────────────────┐
                    │  AGENCY STATE — projeção materializada   │
                    │  pessoas · clientes · projetos · riscos  │
                    │  prazos · mudanças · ações dos agentes   │
                    │  (atualizada por evento, não por turno)  │
                    └────────────────┬────────────────────────┘
                                     ▼
                    ┌─────────────────────────────────────────┐
                    │  RETRIEVAL PLANNER (o que falta hoje)    │
                    │  pergunta → domínios → N consultas →     │
                    │  cruzamento → lacunas → 2ª rodada        │
                    └────────────────┬────────────────────────┘
                                     ▼
                         agentes especializados → ação
```

**Três peças novas, e só três:**

1. **Espelho local do ClickUp.** As tabelas já existem no schema (`clickup_workspaces`, `clickup_spaces`, `clickup_lists`, `clickup_tasks`) e estão vazias. Preenchê-las via webhook (que já grava evento) mais uma varredura incremental resolve de uma vez: histórico, "o que mudou", estrutura do workspace, os 6 clientes sem lista, e tira 40s de latência de cada turno.

2. **Agency State.** Uma projeção materializada, não um prompt gigante. Atualizada por evento. É o que permite responder "o que mudou desde ontem" em milissegundos e é a única vantagem que uma IA externa não consegue replicar.

3. **Retrieval planner.** Substitui o portão léxico. Dada a pergunta, decide **quais domínios consultar** e emite N consultas ao Agency State, com uma segunda rodada quando a primeira deixa lacuna. É a peça que inverte a relação com o Claude: o Claude faz isso com o conector; nós faríamos com dado já indexado, já reconciliado e com histórico.

---

# H. IMPLEMENTATION PLAN

### P0 — sem isto, inteligência não funciona

| # | O quê | Onde | Custo |
|---|---|---|---|
| P0-1 | **Corrigir a contagem do briefing**: passar as tarefas já filtradas ao `buildOperationalBriefing` | `apps/api/src/lib/operational-context.ts:320,338` | ~5 linhas |
| P0-2 | **Retrieval planner** substituindo o portão léxico: a decisão de "isto é operacional?" e "quais domínios?" passa a ser do modelo, com o léxico como piso | `packages/context-engine/`, novo módulo | grande |
| P0-3 | **Espelho local do ClickUp** (workspaces/spaces/lists/tasks) + varredura incremental | `packages/tool-gateway/`, `apps/worker/src/scheduler/` | grande |
| P0-4 | **Ligar o event store à leitura**: `eventsSince` vira fonte de contexto para pergunta temporal | `packages/orchestrator/src/event-store.ts` + novo bloco | médio |
| P0-1b | **Separar "faça um briefing" de "faça uma task"** no guard de escrita — hoje a pergunta executiva é recusada (C-13) | `apps/worker/src/processors/bento-action-guard.ts` | médio |
| P0-5 | **Dar memória ao Bento**: ou entra no ContextPack pelo campo `operational_context`, ou ganha campo próprio no contrato do `bento-qa` | `apps/worker/src/processors/execute-job.ts` | médio |

### P1 — grande ganho de qualidade

| # | O quê |
|---|---|
| P1-1 | Excluir clientes de fixture (`teste`, `Cliente Teste*`) e a própria agência do escopo GLOBAL; sinalizar duplicatas como achado, não escondê-las |
| P1-2 | Separar **projeto interno** de **cliente** — hoje Desigual OS, Citável e os projetos do Endrigo são linhas em `clients` |
| P1-3 | Reconhecer pessoa antes de cliente em `resolveOperationalScope` (hoje "Endrigo" resolve como cliente) |
| P1-4 | Derivar **função** das pessoas a partir do padrão de tarefas; popular os `relation_type` que já existem no schema |
| P1-5 | Incluir pessoas na consolidação noturna (hoje só campanhas e episódios; `last_seen_at` está 13 dias atrasado) |
| P1-6 | Não descartar a listagem quando há briefing: os dois cabem no orçamento |
| P1-7 | Ligar os marcadores comparativos ao `operational` ("Quem está sobrecarregado?" resolve escopo e não busca) |

### P2 — evolução estrutural

Agency State materializado · sinais proativos de evento (o `updatesState` ignorado) · grafo de relações além de `TASK_ASSIGNEE` · trazer o retrieval do vault para dentro do repositório, ou ao menos instrumentá-lo · busca semântica de verdade (a tabela `embeddings` guarda vetor como `jsonb`).

### P3 — otimizações

Cache do espelho · consultas incrementais por `date_updated` · orçamento de contexto por domínio.

---

# H-bis. O QUE JÁ FOI CORRIGIDO NESTA RODADA

**P0-1 — a contagem do briefing.** Aplicado e verificado contra o ClickUp real.

`buildOperationalContext` passa a expor `openTasks` (o conjunto já filtrado que sustenta os números do bloco), e `resolveOperationalTurn` monta o briefing a partir dele em vez da lista crua devolvida pelo ClickUp. Um filtro só, num lugar só: duplicar o filtro no chamador faria os dois divergirem de novo na primeira mudança da regra de "encerrada".

Medição antes/depois, mesma consulta, dado vivo de 29/09:

```
ClickUp devolveu:            1222 tarefas
abertas de verdade:           411
bloco ao vivo sempre disse:   411 tarefa(s) aberta(s) em 38 cliente(s)

BRIEFING ANTES  (lista crua): 1222 tarefa(s) | 146 atrasada(s) | 157 sem responsável
BRIEFING DEPOIS (openTasks):   411 tarefa(s) | 146 atrasada(s) | 130 sem responsável
```

Os dois caminhos agora concordam. O invariante ficou travado em teste (`build-operational-context.test.ts`, 4 casos novos: exclusão de `done`/`closed`, `openTasks.length === summary.total`, vazio quando não há consulta, vazio quando a consulta falha). Suíte do `context-engine`: 259/259 verdes. Typecheck de `apps/api` e `packages/context-engine` limpos.

O tipo fez o trabalho de encontrar os outros pontos: o compilador apontou seis lugares que construíam `OperationalContext` à mão, todos agora explícitos sobre `openTasks`.

### O que AINDA NÃO foi provado ponta a ponta

A verificação acima é no módulo, contra o ClickUp real. **Ela ainda não aparece na resposta do chat.**

O processo da API está rodando sob o `pnpm dev` da máquina, sem `watch` sobre `packages/`, e foi iniciado antes do patch: ele tem a versão antiga do `context-engine` em memória. Rodando a pergunta-ouro ao vivo depois da correção, o Bento continuou dizendo "1.222 tarefas" e "157 sem responsável".

Não derrubei a stack de desenvolvimento para provar isso. Fica o passo, para quem for validar:

```bash
# reiniciar a API (e o worker) e repetir a pergunta-ouro
node scripts/benchmark/intelligence-benchmark.mjs GOLD && node scripts/benchmark/rescore.mjs
```

O critério de aceite é objetivo: a resposta precisa dizer **411**, não 1.222, e **130 sem responsável**, não 157.

**Nada além disto foi alterado.** Os demais itens do P0 são mudanças de arquitetura e não cabem numa rodada de auditoria — o critério de §29 é implementar só o que o diagnóstico justifica sem ambiguidade, e essa é a única correção desse tipo aqui.

---

# I. QUICK WINS

Mudanças pequenas, efeito desproporcional:

1. ~~**P0-1**~~ — **feito nesta rodada** (ver H-bis). Parou de inflar o volume da operação em 3×.
2. **P1-7** (uma lista) — devolve dado a "Quem está sobrecarregado?", "Qual cliente tem mais atrasos?" e a toda a família comparativa.
3. **P1-1** (um filtro) — tira 52 tarefas de fixture do briefing executivo da agência.
4. **P1-3** (ordem de precedência) — "Quais tarefas dependem do Endrigo?" passa a ter resposta.
5. **P1-6** (remover um `??`) — devolve 22.338 caracteres de dado real que já foram buscados e pagos.

As cinco somadas não chegam a 100 linhas e endereçam 6 das 24 dimensões.

---

# J. TEST PLAN

Criado e commitável:

- **`scripts/benchmark/intelligence-benchmark.mjs`** — o DESIGUAL INTELLIGENCE BENCHMARK. 25 perguntas (20 do briefing + 1 golden + 4 de vantagem), cada uma com golden set de fatos esperados, só leitura. `node scripts/benchmark/intelligence-benchmark.mjs [IDs]`
- **`scripts/benchmark/rescore.mjs`** — relê as execuções e recalcula cobertura (o `GET /executions/:id` devolve `completed` um instante antes de os steps estarem persistidos).
- **`apps/worker/scripts/intelligence-benchmark-context.mts`** — mede a camada de CONTEXTO sem gastar LLM: escopo, tarefas entregues e caracteres por pergunta. É o teste de regressão barato: se o número de perguntas com `operational=false` subir, houve regressão.
- **`apps/worker/scripts/intelligence-census.mts`** — censo do que o sistema tem gravado.

Artefatos desta rodada em `artifacts/intelligence-benchmark/`, incluindo `GOLD-contexto-bruto.txt` (o que foi montado) e `GOLD-contexto-enviado.txt` (o que foi enviado) — a prova do C-04 lado a lado.

**Critério de regressão:** o número de perguntas com `operational=false` e a cobertura factual agregada. Hoje: 12/21 e o valor registrado em `SUMMARY.json`.

---

# K. RISCOS

| Risco | Mitigação |
|---|---|
| **P0-1 muda os números que a equipe já viu.** O briefing passa a dizer 411 onde dizia 1222 | é a correção, não o risco — mas avisar a equipe, senão parece que "sumiram tarefas" |
| **P0-2 tira o portão léxico**, que hoje é a defesa contra consultar o ClickUp à toa | manter o léxico como piso (sempre operacional quando ele casa) e deixar o planner só ampliar; medir custo antes de inverter |
| **P0-3 (espelho local) introduz um segundo caminho de verdade** — o erro clássico | o espelho carrega `last_source_update_at` por linha; o bloco declara a idade; frescor degradado é estado observado, não suposição (a `integration-health` já faz isso) |
| **P0-5 muda o contrato do `bento-qa`**, que é externo e opaco | campo aditivo; o serviço ignora o que não conhece |
| **P1-2 (separar projeto de cliente) mexe em `clients`**, que tem FK em campanhas, memórias e relações | migração aditiva com flag, nunca `DELETE` |
| **Coexistência com o cutover do core do Bento** (ADR de convergência, em andamento) | tudo aqui é caminho de LEITURA; o core novo abstém de leitura por desenho. Os dois trabalhos não se cruzam |

---

# Apêndice — o que o sistema JÁ tem e não usa

Vale registrar, porque muda a natureza do trabalho: isto não é construir do zero.

| Ativo | Estado | Usado na resposta? |
|---|---|---|
| 860 campanhas reconciliadas (104 ativas) | fresco, reconciliado hoje | só via Otto, por campanha |
| 23 pessoas, 289 relações | 13 dias desatualizado | não |
| 633 eventos operacionais | gravados, processados | **não** (`eventsSince` sem chamador) |
| 101 dossiês de cliente | migrados 14/09 | não chegam ao Bento |
| 2.062 execuções, 2.054 passos | gravados | não |
| ContextPack com ordem por autoridade e piso por bloco | implementado e testado | **não** (loop desligado) |
| Grounding, count-consistency, evidência | implementados e testados | **não** (loop desligado) |
| Tabelas `clickup_*` | no schema | **vazias** |
| `event-intelligence` (`updatesState`) | implementado | retorno ignorado |

O Desigual OS não perde do Claude por ter menos. Perde por não ligar o que tem.
