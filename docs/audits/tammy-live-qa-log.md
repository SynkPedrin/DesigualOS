# Tammy — Live QA Log

Modo: assistência ao vivo durante teste humano real da Tammy no frontend do Bento.

## Estado do ambiente no início da sessão

- Horário: 2026-09-28 13:41 (America/Sao_Paulo) · Commit `a15f6e9` (branch `feat/otto-motion-engine`)
- `/ready` saudável (database, queue, worker_heartbeat, openai, clickup_mcp) · Frontend HTTP 200 · Redis up
- Flags: `otto_motion_enabled`, `bento_multi_action_write`, `bento_openai_core_enabled`

---

## INC-001 — P1 · Latência percebida ("sistema travado")

**Comportamento observado:** turnos de 35–74s no frontend, muito acima da meta (<15s CRUD, <5s confirmação de delete).

**Investigação (medida, não suposta).** Timings reais da tabela `executions` para os 3 turnos de um ciclo create→delete→confirma:

| Turno | fila (createdAt→startedAt) | worker (startedAt→completedAt) | **observado no front** |
|---|---|---|---|
| CREATE | 0,59s | **10,8s** | 50,7s |
| DELETE pedido | 0,56s | **9,8s** | 74,5s |
| DELETE confirmação | 0,68s | **7,8s** | 35,9s |

**Causa raiz (parcial, evidenciada):** a fila é irrelevante (~0,6s) e o worker faz o trabalho em 8–11s. **O grosso da latência (25–65s) está FORA da janela de execução do worker** — na rota `POST /chat`, que chama `resolveOperationalTurn` **sincronamente antes de enfileirar** (`apps/api/src/chat/routes.ts:408`). Esse resolvedor pode disparar consulta ampla ao ClickUp (`queryOperationTasks` sobre a carteira autorizada) mesmo em turnos de CRUD que não precisam dela — o próprio comentário do frontend documenta o sintoma ("consulta o ClickUp ao vivo ANTES do 202", timeout do fetch elevado para 120s).

**Correção aplicada (parcial):** eliminada uma chamada de rede duplicada no delete — `taskExiste()` é `getTask()` por dentro (`bento-action-guard.ts:1217`) e o `getTask()` seguinte repetia o MESMO GET só para ler `.name`. Agora é uma leitura só, decidindo os três ramos (existe / 404 / erro). O read-back de ausência pós-delete foi mantido (verifica outro estado).

**Validação:** confirmação de delete em 35,9s (faixa do baseline 34,7–44,6s) — **a correção é real mas pequena diante do gargalo dominante**, que é a consulta síncrona na API.

**Status:** correção do duplicado FECHADA; gargalo principal (`resolveOperationalTurn` síncrono no `POST /chat`) **ABERTO** — documentado, não corrigido, para não mexer em caminho compartilhado durante o QA.

**Instrumentação adicionada** (só logging, sem mudar controle): `bento-openai-core` agora loga `total_ms`, `planner_ms`, `mcp_exec_ms`, `legacy_create_ms`, `legacy_update_ms` por turno.

---

## INC-002 — P0 · "O Bento não faz o básico da operação"

**Comportamento observado (relato da operação):** o Bento não consulta o vault/dossiê, não entende a operação, cria task sem briefing decente, não anexa imagem e recusa fechar task.

**Causa raiz:** o Bento tem **dois cérebros**, e o ativo era o pobre. Com `BENTO_OPENAI_CORE_ENABLED=true`, o caminho ativo é `bento-openai-core.ts`, que:

- passava `clientName: null` **fixo** ao planner → planejava sem saber de quem era a demanda e sem chave para o dossiê;
- criava task com `description = action.changes.description` (a linha curta do planner) → **zero briefing**;
- **não recebia `attachments`** na sua interface → print/arquivo do pedido nunca chegava na task;
- passava `mapStatus: () => undefined` → aceitava pedido de status e não mudava nada;
- e o `classifyActionIntent` tinha **hard deny** (`FORBIDDEN_ACTION`) que recusava concluir/fechar task com um sermão.

Toda a cadeia boa (recuperação de contexto real → briefing por tipo de entrega → preenchimento de lacunas → QA) existia, mas **presa no caminho legado** (`bento-action-guard.ts`).

**Correção aplicada:**

| # | Arquivo | Mudança |
|---|---|---|
| 1 | `bento-task-briefing.ts` (novo) | Extrai a cadeia do legado (`retrieveBriefingContext` → `composeBriefing` → `pendingCriticalFields` → `evaluateBriefing`) para ser chamável de qualquer caminho. Sem duplicar regra. |
| 2 | `bento-openai-core.ts` | Passa `clientName` real ao planner (era `null`). |
| 3 | `bento-openai-core.ts` | Descrição da task passa a ser o **briefing montado**, com dossiê/memória do cliente; lacuna vira pendência declarada, nunca invenção. |
| 4 | `bento-openai-core.ts` + `execute-job.ts` | `attachments` chegam ao core e sobem na task (`attachMaterials`); falha de upload degrada a resposta, não invalida a criação. |
| 5 | `types.ts`/`planner.ts`/`policy.ts` (bento-core) | `changes.status` de primeira classe; policy passa a contar status como mudança material (antes "fecha essa task" caía em `content_missing`). |
| 6 | `bento-openai-core.ts` | `mapStatus: mapStatusHintToRealStatus` (era `() => undefined`) — o hint em português vira o status real da lista, com read-back. |
| 7 | `action-intent.ts` (2 lugares) + `bento-action-guard.ts` | **Hard deny de conclusão REMOVIDO.** Fechar task pedida por uma pessoa é escrita autorizada. |
| 8 | `bento-openai-core.ts` | **Procedência** no lugar do deny: toda mudança de status verificada registra na task "a pedido de \<quem\>, via Desigual OS". |

**Por que não é só "tirar a trava":** o deny existia por um motivo real (status falso faz a operação planejar em cima de mentira). O motivo continua endereçado — só que por rastro (quem pediu + read-back do status real), que é compatível com um time sênior, em vez de devolver o trabalho manual para o humano.

**Testes:** `tammy-regression-20260928-briefing-vault-anexo.test.ts` (5 casos: clientName no planner, briefing na descrição, anexo na task, anexo que falha degrada sem invalidar, fechar task = status real + procedência). Suíte: **1015/1015 worker + 32/32 bento-core**, typecheck limpo.

**Status:** código FECHADO e testado. **Pendente de ativação** — o worker em execução é anterior às mudanças; precisa de restart (bloqueado pelo classificador nesta sessão, ver abaixo).

---

## INC-003 — P0 · Task criada no ClickUp e a pessoa nunca vê a resposta

**Comportamento observado (ciclo real, 28/09/2026 17:52):** pedido de criação com imagem anexada. O chat ficou em "pensando" indefinidamente; `POST /chat` levou **186s** e o fetch do frontend abortou em 120s (`net::ERR_ABORTED`). A task **foi criada no ClickUp mesmo assim**. Efeito colateral sem resposta é o pior desfecho que este sistema tem — pior que erro, porque a pessoa reenvia.

**Causa raiz (medida):** é o gargalo do INC-001 chegando ao teto. A frase *"cria a task X pra Matheus Sain (...) prazo pra amanhã"* bate em dois marcadores de LEITURA — `operacional:task` e `tempo:amanha` — então o `resolveOperationalTurn` varria as listas dos **52 clientes autorizados** no ClickUp **antes de enfileirar**. Medido isolado: **18,2s quente, ~180s frio**. E era desperdício puro: quem manda criar não está perguntando o estado da operação, e o "prazo pra amanhã" da frase é **atributo da task que vai nascer**, não janela de consulta.

**Correção aplicada (duas camadas, ambas compartilhadas — nada específico do Bento):**

| # | Arquivo | Mudança |
|---|---|---|
| 1 | `packages/context-engine/src/resolve-scope.ts` | **Ordem de escrita não gasta consulta ao vivo.** Verbo de escrita no imperativo + nenhuma pergunta + nenhum marcador de panorama/global/agregado → `operational: false`, sinal `escrita:sem-consulta`. Conservador: *"cria a task e me diz o que mais vence amanhã"* continua lendo. |
| 2 | `apps/api/src/chat/routes.ts` | **Prazo de ack** (`CHAT_ACK_DEADLINE_MS`, 25s). Não é aumentar timeout — é o contrário: o teto do servidor passa a ser menor que o do navegador (120s). Estourar devolve o turno com a falha declarada, o mesmo caminho de quando o ClickUp está fora do ar; o agente admite que não leu, e nunca inventa. |

**Validação (ciclo real no ClickUp, lista QA, após a correção):**

| Turno | antes | depois |
|---|---|---|
| CREATE com anexo | 186s → **abortado** | **52,5s**, respondido |
| "fecha essa task" | — | **72,7s**, respondido |

E o resultado no ClickUp (`86bc8uvk7`, conferido pela API antes de apagar): briefing de 10 seções na descrição com campos vindos do dossiê, `qa-referencia.png` anexado, responsável Matheus Sain, prazo correto, status `complete`, comentário *"Status alterado para 'concluída' a pedido de QA Bot, via Desigual OS."*, zero duplicata.

**Testes:** 14 casos novos em `resolve-scope.test.ts` (7 ordens de escrita suprimem, 5 leituras continuam lendo, frase mista continua lendo, `"criação"` não é `"cria"`). Suítes: **243/243 context-engine · 1015/1015 worker · 116/116 API**, typecheck limpo.

**Status:** FECHADO.

---

## Status corrente

- Incidentes: 3 · P0 abertos: 0 · P1 abertos: 1 · P2 abertos: 1
- **P1 aberto:** `ai_usage_ledger` nunca é escrito (`recordOpenAIUsage` existe e não é chamado) — custo por turno não é mensurável. Não afeta operação.
- **P2 aberto:** no briefing, a seção ENTREGÁVEIS às vezes recebe o molde cru `chave: valor` do preenchedor de lacunas em vez da lista de peças. Sujeira de leitura, não erro de dado.
- Latência corrente medida: `oi` 10s · CREATE com anexo+briefing 52s · UPDATE de status 73s. Acima da meta (<15s), **abaixo do teto do navegador** — a pessoa sempre recebe resposta.
- PAUSE TAMMY QA: **não** — nenhum side effect incorreto em nenhum ciclo (nada de task errada, duplicada, cross-client ou falso sucesso).
