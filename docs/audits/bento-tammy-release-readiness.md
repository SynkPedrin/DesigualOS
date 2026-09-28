# Bento — Release Readiness para Teste da Tammy

Data: 2026-09-28. Branch: `feat/otto-motion-engine`. Escopo: CREATE / UPDATE / DELETE de task, resolução de funcionários, resource memory, idempotência — conforme a missão de release mínimo operacional do Bento.

## 1. Status final

**READY FOR TAMMY QA** — com uma ressalva P2 registrada na seção 12 (latência de resposta do frontend em alguns turnos de DELETE, sem impacto na correção do backend).

**FOUNDATION STATUS: STABLE**, com um P1 conhecido e não bloqueante (cost ledger não instrumentado no caminho novo — seção 11).

Nenhum P0 aberto neste escopo. Todos os P0 encontrados durante os testes reais foram corrigidos, testados (unitário + regressão) e reverificados ao vivo contra o ClickUp real (lista QA, não produção).

## 2. Contexto — o que já existia vs. o que foi corrigido agora

Uma investigação anterior (subagente, ver handoff desta sessão) confirmou que o "BENTO CORE CUTOVER" (`packages/bento-core`, `apps/worker/src/processors/bento-openai-core.ts`) já fechava a maioria dos P0/P1 dos audits de 25-26/09 (F-01 a F-14): kill switch de escrita externa, anti UPDATE→CREATE estrutural, reconcile-first no create MCP, extração de task_id em camadas, read-back real. A suíte estava 986/986 verde.

Dessa base, esta sessão:
1. Fechou um bug latente documentado e não corrigido (F-09).
2. Fechou DELETE, que nunca tinha sido implementado no core novo (era escopo declaradamente fora, "audit P0-19").
3. Encontrou e corrigiu **5 bugs novos e reais**, todos descobertos ao vivo rodando os dois testes de aceite do frontend contra o ambiente de QA real (não em teste unitário) — exatamente o tipo de falha que "funcionou uma vez" ou "os testes passaram" não captura.

## 3. Alterações feitas

| # | Arquivo:linha | O que mudou |
|---|---|---|
| 1 | `apps/worker/src/processors/bento-resource-state.ts` | F-09: `loadResourceState` agora filtra por `conversationId` **e** `contextType` (antes só por conversationId — uma linha de outro escritor na mesma tabela apagava o estado do Bento na leitura). |
| 2 | `packages/bento-core/src/types.ts`, `planner.ts`, `apps/worker/src/processors/bento-openai-core.ts` | DELETE agora é um intent de primeira classe (`delete_task`) que o core **defere** para o guard legado (que já tem confirmação em duas voltas + read-back de ausência) em vez de arriscar um caminho novo sem MCP/policy próprios. |
| 3 | `apps/worker/src/processors/bento-resource-state.ts` (`clearResourceFocusIfDeleted`) + `execute-job.ts` | Depois de um DELETE confirmado pelo guard legado, o foco do `ConversationResourceState` **novo** é limpo — sem isto, um "coloca X na mesma" depois de apagar resolveria contra uma task que não existe mais. |
| 4 | `apps/worker/src/processors/bento-openai-core.ts` (create/update), `bento-mcp-executor.ts` (create MCP) | **Bug real, achado ao vivo**: CREATE com responsável e prazo pedidos na mensagem original nascia só com título — nem `assigneeName` nem `dueDate` eram repassados pro executor (nem no MCP, nem no legado). Corrigido nos dois providers, com read-back estendido pra conferir os dois campos. |
| 5 | `apps/worker/src/processors/bento-openai-core.ts` (update) | **Bug real, achado ao vivo**: UPDATE de prazo nunca era repassado pro `executeTaskUpdate` — "muda o prazo pra sexta" respondia "já estava assim" sem nunca ter existido prazo nenhum. |
| 6 | `apps/worker/src/processors/bento-openai-core.ts` (dedup) | **Bug real, achado ao vivo**: o dedup de idempotência (`sameExecutionAlreadyDone`) só comparava operação+recurso — a SEGUNDA mutação distinta sobre a mesma task (ex.: depois de adicionar responsável, mudar o prazo) era engolida como "já tinha feito isso" e nunca executava. Corrigido exigindo também bater o `argsHash` do pedido atual (retrocompatível com recibos antigos sem esse campo). |
| 7 | `packages/tool-gateway/src/clickup-client.ts` (`normalizePersonName`) | **Bug real, achado ao vivo**: "remove a Jamile Galdino" fazia o planner devolver `assignee: "remove Jamile Galdino"` (verbo colado no nome) e a busca de membro falhava procurando um funcionário com esse nome literal. Rede de segurança: strip de verbos de operação (`remove`, `tira`, `troca`...) antes de normalizar o nome — corrige pra qualquer caller, não só o que expôs o bug. |
| 8 | `packages/bento-core/src/planner.ts` (`describeResourceState` + prompt) | **Bug real, achado ao vivo — o mais sério**: "volta na primeira e muda o nome" renomeava a task ERRADA (a última criada, não a primeira) com o CONTEÚDO da task certa — contaminação cruzada de recurso. Causa-raiz: o estado da conversa só listava ids opacos pro planner, nunca títulos, então "a primeira"/"aquela chamada X" não tinha como ser resolvido. Corrigido: lista agora traz título + ordinal de criação, e o prompt instrui a casar referência nomeada/ordinal contra essa lista. |
| 9 | `apps/worker/src/processors/bento-action-guard.ts` (`isTaskDeleteRequest`) | **Bug real, achado ao vivo**: "agora apaga ela" (sem a palavra "task"/"tarefa") não era reconhecido como pedido de exclusão — o objeto explícito era tratado como obrigatório. Corrigido: pronome de referência sozinho (sem nenhum objeto de campo tipo "briefing"/"prazo") já basta. |
| 10 | `apps/worker/src/processors/bento-action-guard.ts` (gate de escrita não-autorizada) | **Bug real, achado ao vivo, mesma frase do #9**: mesmo com o #9 corrigido, "agora apaga ela" continuava caindo no kill switch de "escrita não reconhecida" ANTES de chegar na checagem de delete — a ordem do dispatcher intercepta ali primeiro. Corrigido: pedidos de delete verdadeiros agora furam esse gate, igual já acontecia para correção de escopo de delete. |

Todas as mudanças são aditivas/corretivas dentro dos arquivos existentes — nenhuma tabela nova, nenhuma migration.

## 4. CREATE

**PASS.**

Fluxo real (MCP quando token OAuth do usuário está presente, LEGACY_GATEWAY caso contrário — ambos com read-back real e reconcile-first): mensagem → planner (LLM, sem tools) → `StructuredAction` → policy → executor único → verificação → persistência de estado → resposta.

Evidência (teste real, lista QA "Lista QA" / espaço "QA DESIGUAL OS", cliente "Cliente Teste 7"):
- `"Bento, cria uma task de teste para a Matheus Sain chamada QA BENTO CRUD ..., com prazo para amanhã."` → task real criada (`86bc8jy6a` na 3ª rodada de validação), confirmado via API do ClickUp: `assignees: ['Matheus Sain']`, `due_date` presente com a data de amanhã.
- Antes da correção #4: a mesma mensagem criava a task só com título (`assignees: []`, `due_date: None`) — reproduzido 2x, corrigido, revalidado 1x com sucesso.

## 5. UPDATE

**PASS.**

Casos testados ao vivo, todos aplicando a mudança E confirmando por releitura real do ClickUp:
- Adicionar responsável (`assigneeOperation: 'add'`).
- Mudar prazo (`assigneeOperation` n/a) — só passou a funcionar depois da correção #5.
- Remover responsável (`assigneeOperation: 'remove'`) — só passou a funcionar depois da correção #7 (nome vinha com verbo colado).
- Atualização por referência ordinal ("volta na primeira e muda o nome") — só passou a resolver a task certa depois da correção #8; testado 2x depois da correção, os dois com sucesso (task A renomeada, task B intacta).
- Continuidade de foco: depois de mover o foco pra A por ordinal, um update seguinte ("nessa mesma coloca prazo pra amanhã") permaneceu em A, não voltou pra B.

Invariante crítico confirmado por evidência de retry real: duas mutações DISTINTAS na mesma conversa/task (add assignee → due date) agora aplicam as duas — antes da correção #6 a segunda era descartada como duplicata.

## 6. DELETE

**PASS.**

Fluxo real: pedido → guard legado detecta intenção de exclusão (com ou sem a palavra "task" na frase) → pergunta de confirmação com marcador auto-contido → segunda mensagem afirmativa → `taskExiste` antes → `deleteTask` → `taskExiste` depois (read-back de AUSÊNCIA, não só de sucesso) → resposta honesta.

Evidência:
- `"apaga essa task"` → `"sim, confirmo"` → task deletada e confirmada ausente por releitura (3 rodadas, todas com sucesso depois da correção do delete-wiring no core).
- `"agora apaga ela"` (sem a palavra "task") → confirmação pendente aberta corretamente (correção #9/#10) → `"sim, confirmo"` → **task realmente deletada e confirmada ausente via API do ClickUp** (`err: "Task not found, deleted"`), mesmo num turno em que a resposta na tela do teste automatizado não chegou a estabilizar dentro do timeout de 180s (ver seção 12 — problema de latência de UI/observação, não de execução).
- Task B, presente na mesma conversa, nunca foi tocada em nenhuma das duas rodadas.

INV-10 (task apagada não continua em foco) confirmado: `clearResourceFocusIfDeleted` roda sempre que o guard legado confirma um delete, independente de qual caminho (core novo ou legado) executou.

## 7. Employees (resolução de funcionários)

**PASS** dentro do que a fonte permite.

Fonte canônica: API real do ClickUp (`resolveMemberByName`/`findMemberByName` em `packages/tool-gateway/src/clickup-client.ts`), não uma tabela local — o que é uma escolha arquitetural correta (nunca desatualiza). Matching em 4 níveis (nome completo exato → primeiro nome exato → prefixo → contido), nunca inventa id: distingue `resolved` / `ambiguous` / `not_found` e cada camada consumidora (create, update, MCP read-back) trata os três casos honestamente.

Workspace real usado no teste não tem "Sofia"/"Matheus" (os nomes do roteiro original da missão) — usei membros reais existentes (Matheus Sain, Jamile Galdino) mantendo a estrutura do teste.

Rede de segurança nova (correção #7): nome com verbo de operação colado ("remove Jamile Galdino") agora resolve corretamente.

**Limitação conhecida, não bloqueante (P2)**: não há tabela de aliases custom (ex.: "Sofi" → "Sofia" funciona por prefixo, mas "Mateus" → "Matheus" com grafia diferente não resolveria) — variações fonéticas fora de prefixo/substring exigiriam alias explícito, que não existe hoje. Como o sistema nunca inventa um id nesse caso (cai em `not_found` → esclarecimento), isto é uma lacuna de conveniência, não um risco de segurança.

## 8. Resource Memory

**PASS**, com um limite conhecido documentado.

`ConversationResourceState` (foco, seleção, criadas/atualizadas recentemente, última execução) persistido append-only na tabela `conversation_context` (`contextType='bento_resource_state'`), 1 linha por escrita verificada. Resolução de alvo: id explícito → foco → seleção única → última execução — nunca busca global.

Corrigido nesta sessão:
- F-09 (isolamento contra outros escritores da mesma tabela).
- Referência ordinal/por nome contra recursos que não são o foco atual (correção #8) — antes, "a primeira" sempre resolvia pro foco (o mais recente), silenciosamente.
- Foco limpo após DELETE (correção #3).

**Limite conhecido, não bloqueante neste escopo**: o estado não carrega dimensão de "quem" — duas pessoas na mesma conversa compartilham um foco só. Fora do roteiro de teste desta release (uma pessoa por conversa).

## 9. Idempotência

**PASS.**

- CREATE: reconcile-first real (busca por título antes de criar) tanto no MCP quanto no legado — retry de uma mesma operação não duplica.
- UPDATE/COMMENT: dedup por `(operação, recurso, argsHash)` — correção #6 fechou o caso em que esse dedup bloqueava mutações LEGÍTIMAS e distintas sobre o mesmo recurso, mantendo intacta a proteção original contra repetição do MESMO pedido.
- DELETE: idempotente por natureza (segunda tentativa de apagar uma task já ausente responde "já pode ter sido apagada antes", nunca erro nem efeito colateral).

## 10. Front Test 01 — CRUD completo (turno a turno, última rodada, todas com sucesso)

Conversa única, cliente "Cliente Teste 7":

| Turno | Pedido | Resultado observado | Evidência |
|---|---|---|---|
| 1 | cria task c/ responsável + prazo amanhã | Criada, responsável e prazo aplicados | ClickUp: `assignees:['Matheus Sain']`, due_date=amanhã |
| 2 | coloca outra pessoa também | Atualizada, responsável extra confirmado por releitura | resposta: "🔄 ClickUp: alteração conferida por releitura" |
| 3 | muda o prazo pra sexta | Atualizada, novo prazo confirmado | resposta: "📅 Prazo: 02/10/2026" |
| 4 | remove a pessoa adicionada no turno 2 | Atualizada, removido confirmado | resposta: "👤 Responsável (remover ...): removido" |
| 5 | apaga essa task | Confirmação pendente aberta | marcador `CONFIRMAÇÃO PARA APAGAR` |
| 6 | sim, confirmo | Task apagada e confirmada ausente | "apagada e CONFIRMADA por leitura: ela não existe mais no ClickUp" |

Nenhuma duplicata de bolha/task em nenhum turno.

## 11. Front Test 02 — memória / referência entre duas tasks (última rodada, todas com sucesso)

| Turno | Pedido | Resultado observado |
|---|---|---|
| 1 | cria task A c/ pessoa 1 | Criada |
| 2 | cria task B c/ pessoa 2 | Criada (mesma lista, id diferente) |
| 3 | "volta na primeira e muda o nome pra X" | Task **A** renomeada (confirmado pelo id na resposta = id real de A) |
| 4 | "nessa mesma coloca prazo pra amanhã" | Continuou em A (foco não voltou pra B) |
| 5 | "agora apaga ela" | Confirmação pendente aberta (mesmo sem a palavra "task" na frase) |
| 6 | "sim, confirmo" | **A apagada, B intacta** — confirmado via leitura direta da API do ClickUp após o teste, já que a resposta na tela não estabilizou a tempo nesta rodada (ver seção 12) |

Antes das correções #8/#9/#10: turno 3 renomeava a task ERRADA (B) com o nome pretendido pra A — contaminação cruzada real, reproduzida 2x e corrigida.

## 12. Uso de tokens GPT

**Não disponível via `ai_usage_ledger`.** A tabela existe, tem índice por `conversationId`/`agent`, e a função `recordOpenAIUsage` (`packages/openai-provider/src/ledger.ts`) está pronta e exportada — mas nada no caminho real do Bento (`bento-openai-core.ts`, `bento-mcp-executor.ts`, planner) chama essa função. Consultei a tabela filtrando por `agent='bento'` nas últimas 24h, incluindo toda a janela dos testes de aceite: **zero linhas**, apesar de dezenas de chamadas reais confirmadas por comportamento observável (respostas corretas do LLM, mutações reais no ClickUp).

**Isto é um P1 registrado para follow-up, não bloqueante para esta release**: a mission pede para medir uso real; a infraestrutura de medição existe mas está desconectada. Corrigir isso corretamente (decidir on de pendurar a chamada — após cada `callResponses`, com qual `organizationId`/`conversationId`) é uma decisão de escopo que prefiro não tomar às pressas dentro desta entrega.

Como proxy, medi a **duração por turno** (tempo de resposta ponta a ponta, do envio da mensagem até a resposta estabilizar na tela), real, dos dois testes na última rodada bem-sucedida:

**TESTE 1 (CRUD)**: 1: 38.8s · 2: 19.7s · 3: 42.9s · 4: 39.5s · 5: 62.1s · 6: 36.9s — total 4,3 min, média 39.9s/turno.

**TESTE 2 (memória)**: 1: 51.9s · 2: 40.9s · 3: 50.8s · 4: 45.1s · 5: 149.1s · 6: >180s (timeout de observação, ver abaixo) — total >6 min.

Os turnos de DELETE (5 e 6, e principalmente o 5) são visivelmente mais lentos: fazem 2 leituras de existência + a exclusão + 1 releitura de ausência = 4 chamadas sequenciais ao ClickUp, além do planejamento LLM. No turno 6 da última rodada do Teste 2, a resposta não apareceu na tela dentro dos 180s do teste automatizado, mas a exclusão de fato aconteceu no ClickUp (confirmado via API logo depois) — ou seja, o backend terminou o trabalho, mas algo entre o backend e a renderização da bolha no frontend (WebSocket, polling, ou geração da resposta final em texto) não chegou a tempo. **P2 registrado, não bloqueante**: investigar a latência ponta-a-ponta de DELETE especificamente quando a rodada envolve o caminho de esclarecimento anterior (o turno 5 desta mesma rodada já tinha levado 149s). Recomendo profiling dedicado antes de qualquer aumento de volume de uso.

## 13. Regressão / suíte automatizada

Todas as suítes relevantes rodando 100% verdes após todas as correções:

- `@desigual-os/worker`: **1010/1010** (51 arquivos).
- `@desigual-os/bento-core`: **32/32**.
- `@desigual-os/tool-gateway`: **100/100**.
- `tsc --noEmit` limpo nos três pacotes.

Testes novos adicionados nesta sessão (todos cobrindo um bug real encontrado ao vivo, não hipotético):
- F-09: 3 casos em `bento-resource-continuity.test.ts` (contextType isolado, mais o novo `clearResourceFocusIfDeleted`).
- Delete deferral do core: 1 caso em `bento-openai-core.test.ts`.
- CREATE/UPDATE repassando assignee+dueDate: 2 casos em `bento-openai-core.test.ts`.
- Dedup por argsHash: 1 caso em `bento-fault-injection.test.ts` (regressão específica do bug real).
- `normalizePersonName` contra verbo colado: 3 casos em `clickup-client.test.ts`.
- `describeResourceState` com título+ordinal: 1 caso em `planner.test.ts`.
- `isTaskDeleteRequest`/gate de delete pronominal: 4 + 3 casos em `bento-action-guard.test.ts` e `bento-guard-matrix.test.ts`.

## 14. Smoke test dos demais agentes

Não gastei tokens de LLM real nos outros agentes (instrução explícita da missão de não consumir sem necessidade). Evidência de base, coletada do próprio ambiente de QA vivo usado nos testes:

- `/ready`: `database: true`, `queue: true`, `worker_heartbeat: true`, `openai_credential_configured: true`, `clickup_mcp_oauth_infra_ready: true` — todos true durante toda a sessão de testes.
- Log de boot do worker: `Worker started, listening on all agent queues — agents: [bento, jarbas, suzy, studio, otto]` — as 5 filas registradas e o worker respondendo heartbeat.
- Nenhum erro de boot, nenhuma exceção não tratada observada nos processos durante ~1h de testes reais contínuos.

Isto cobre BASE-07 (mudança no Bento não quebra os demais) no nível estrutural: nenhuma das correções tocou código compartilhado por Otto/Jarbas/Suzy/Studio fora de `bento-action-guard.ts`/`bento-resource-state.ts`/`bento-openai-core.ts`/`packages/bento-core`/`packages/tool-gateway` (este último É compartilhado — `normalizePersonName` agora corrige qualquer chamador, não só o Bento; rodei a suíte inteira de `tool-gateway` para confirmar). Não constitui um E2E completo de Otto/Jarbas/Suzy/Studio.

## 15. Bugs restantes (não bloqueantes)

- **P1** — cost ledger não instrumentado no caminho novo do Bento (seção 12).
- **P1** — token OAuth do MCP não tem verificação de expiração nem usa o `refresh_token` capturado no exchange (achado por investigação anterior, não deste turno; hoje degrada para LEGACY_GATEWAY sem log explícito de downgrade).
- **P2** — latência de DELETE em turnos de confirmação, especialmente após um turno de esclarecimento anterior na mesma conversa (seção 12).
- **P2** — sem alias table para funcionários com grafia muito diferente do nome oficial no ClickUp (seção 7).
- **P2** — dimensão de "ator" ausente no `ConversationResourceState` (duas pessoas na mesma conversa compartilham foco).

Nenhum destes afeta CREATE/UPDATE/DELETE/memória/funcionários no fluxo de uso real (uma pessoa, uma conversa por vez) que é o que a Tammy vai testar.

## 16. Instruções para a Tammy

1. Conversa nova com o Bento, cliente selecionado — cada pedido, uma coisa de cada vez.
2. Pode pedir "cria uma task pra [pessoa] com prazo [dia]" — os dois campos são aplicados de verdade agora.
3. Pra mudar algo depois, "muda o prazo/responsável dela" funciona mesmo já tendo mudado outra coisa antes.
4. Pra apagar, pode falar "apaga ela"/"apaga essa task" — sempre vai perguntar "tem certeza?" antes.
5. Se DELETE demorar mais que o normal pra responder na tela, a exclusão já pode ter acontecido de verdade — confere no ClickUp antes de repetir o pedido.
6. Referências como "a primeira"/"aquela chamada X" já funcionam mesmo se não for a última task criada na conversa.
7. Qualquer resposta esquisita ou "não entendi", me avisa com a frase exata — isso alimenta a próxima rodada de correção.
