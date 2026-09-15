# Implementation Ledger

Registro por decisão (seção 125). Uma linha só entra aqui quando o código existe
e foi verificado no nível possível neste ambiente.

## Frente A — Evidence layer + grounding factual — 15/09/2026 — IMPLEMENTADA (migration a formalizar na máquina do repo)

**Decisão**: tornar Evidência uma entidade de 1a classe e transformar o evaluator
de "resposta plausível" em "resposta fundamentada", sem reescrever o contrato
API→node (que passa dado operacional como string por decisão registrada do time).

**Arquivos alterados**
- `packages/agent-runtime/src/state.ts` — interface `Evidence`; campos
  `evidence: Evidence[]` e `requiresEvidence: boolean` no `AgentExecutionState`;
  init em `createInitialState`.
- `packages/agent-runtime/src/evaluator.ts` — eixo `grounded` na `Evaluation`;
  gate determinístico: `requiresEvidence && evidence.length === 0` → não passa e
  penaliza score em 0.3.
- `packages/agent-runtime/src/loop.ts` — `UnderstandResult.requiresEvidence`;
  o loop seta `state.requiresEvidence` na fase UNDERSTAND.
- `packages/agent-runtime/src/index.ts` — export do tipo `Evidence`.
- `packages/agent-runtime/src/loop.test.ts` — 3 testes de grounding + asserts no
  estado inicial.
- `packages/database/src/schema/agent-runtime.ts` — tabela `agent_evidence`
  (executionId, agent, user/client, type, source, sourceId, confidence,
  retrievedAt, validAt, summary, metadata) com índices.
- `apps/worker/src/processors/agentic-dispatch.ts` — `operationalDataRetrieved()`
  (sinal determinístico de turno factual); `understand` seta `requiresEvidence`;
  `gatherContext` emite evidência (memória recuperada + dado ao vivo do ClickUp),
  grava em `state.evidence` e na tabela `agent_evidence` (fire-and-forget).
- `apps/worker/src/processors/agentic-profiles.ts` — `Evaluation` literal do
  evaluator por-agente atualizado com `grounded`.

**Por que o `act` não virou tool-loop aqui**: isso é a Frente B. A Frente A entrega
a CAMADA de evidência e o gate; o executor multi-passo com read-back vem depois.

**Verificação feita**
- `tsc --noEmit`: PASSOU em agent-runtime, database e worker (exit 0).
- Verificação comportamental REAL do gate de grounding via `node
  --experimental-strip-types` (evaluator.ts não tem import de runtime): 6/6 checks
  passaram — não-factual aprova sem evidência; factual sem evidência reprova com
  failure de grounding e score penalizado; factual com evidência aprova.
- `vitest`: NÃO executável neste ambiente (node_modules macOS em shell Linux).
  Os 3 testes novos estão no suite; rodar `pnpm --filter @desigual-os/agent-runtime
  test` na máquina do repo.

**Pendências para fechar a Frente A na máquina do repo**
1. `pnpm --filter @desigual-os/database db:generate` (gera migration+snapshot da
   tabela `agent_evidence`; SQL de referência em `frente-a-agent_evidence.sql`).
2. `pnpm --filter @desigual-os/database db:migrate` (aplica no Supabase).
3. `pnpm --filter @desigual-os/agent-runtime test` (roda os testes de grounding).
4. Fumaça: pergunta operacional ao Bento com `AGENT_LOOP_V2=bento` e conferir
   linhas em `agent_evidence` + `metadata.agentic` no outcome.

**Limite honesto declarado**: o grounding aqui é um GATE de presença de evidência
(turno factual sem nenhuma evidência reprova), não ainda o claim-grounding
semântico da seção 26 (cada afirmação ligada à evidência que a sustenta). A
evidência operacional é registrada de forma agregada (o worker recebe o dado ao
vivo como string, por contrato). O grounding por-item vem junto da Frente C, quando
o `OperationalState` estruturado passar a viajar até o worker.

## Frente B — Executor do Bento: read-back + idempotência — 15/09/2026 — IMPLEMENTADA

**Achado que mudou o plano**: o executor de escrita do Bento JÁ EXISTIA e é bom
(`apps/worker/src/processors/bento-action-guard.ts`): classifica intenção de
escrita de forma determinística, resolve referente ("atribua a ele"), executa
create/update via tool-gateway e mata o bug do "task nova chamada 'perfeito, a
ele'". As lacunas reais vs. a spec (§32-33, §59) eram cirúrgicas: o create dizia
"validada" SEM reler a task; update de prazo/status não relia nada; e não havia
idempotência (retry após timeout duplicava). Frente B fechou exatamente isso, sem
reescrever o que funciona.

**Arquivos alterados**
- `packages/tool-gateway/src/clickup-client.ts` — primitiva `getTask()` (read-back
  completo: nome, status, prazo, responsáveis, lista) + tipo `TaskDetail`.
  `getTaskListId` (que só provava existência) deixou de ser a confirmação.
- `packages/tool-gateway/src/task-verification.ts` — NOVO módulo PURO:
  `verifyTaskState(actual, expected)` (nome/responsável/prazo/status, com
  tolerância de prazo), `findDuplicateTask()` (idempotência por nome normalizado)
  e `normalizeTaskName()`.
- `packages/tool-gateway/src/task-verification.test.ts` — NOVO: cobre read-back e
  idempotência.
- `packages/tool-gateway/src/index.ts` — export do módulo novo.
- `apps/worker/src/processors/bento-action-guard.ts` — helper `readBackVerify()`;
  read-back real nas 4 escritas (create, assignee, due, status): a resposta só diz
  "CONFIRMADO por leitura" quando releu e bateu, é honesta quando não conseguiu
  reler, e sinaliza divergência quando a leitura contradiz a promessa. Create ganhou
  pré-checagem de idempotência (não duplica task de mesmo nome já aberta na lista) e
  verificação da presença do comentário do briefing. `metadata.verified` +
  `verification_mismatches` no recibo.

**Verificação feita**
- `tsc --noEmit`: PASSOU no repo inteiro (18 packages, rodados por filtro; turbo
  não acha o binário do pnpm via corepack, mas os filtros diretos passam todos).
- Verificação comportamental REAL dos comparadores puros via `node
  --experimental-strip-types` (task-verification.ts só tem import de tipo): 11/11
  checks (read-back de nome/responsável/prazo/status + tolerância + idempotência).
- `vitest`: não executável aqui (mesmo blocker de binário nativo). Testes no suite;
  rodar `pnpm --filter @desigual-os/tool-gateway test` na máquina do repo.

**Limite honesto declarado**: as chamadas de rede (getTask/getTaskComments contra o
ClickUp) não foram testadas de ponta a ponta aqui — sem credencial/sandbox. O que
foi verificado é a LÓGICA de verificação e idempotência (pura) + tipos. A prova de
fogo do §59 (criar task pro Pedro com briefing anexado e reler tudo) precisa rodar
na máquina do repo com CLICKUP_API_KEY de sandbox e `AGENT_LOOP_V2=bento`.

**Pendências para fechar na máquina do repo**
1. `pnpm --filter @desigual-os/tool-gateway test` (comparadores + idempotência).
2. Fumaça §59: "crie uma task pro Pedro, hoje, com título X, briefing anexado" e
   conferir no recibo "VERIFICADA" + `metadata.verified=true` + comentário do
   briefing presente; repetir o MESMO pedido e conferir que NÃO duplica (idempotência).

## Frente C — OperationalState do Bento: priorização + próxima ação — 15/09/2026 — IMPLEMENTADA

**Achado**: o OperationalState JÁ existia como `buildOperationalBriefing`
(context-engine): overview (overdue/dueToday/unassigned/blocked/awaitingApproval/
byStatus/byClient), riscos com evidência (nomes de tarefa) e oportunidades, tudo
puro e com procedência (KNOWN/DERIVED/MISSING). Faltava, do §50/§52: um RANKING de
prioridade transparente com o motivo, e a PRÓXIMA MELHOR AÇÃO por risco.

**Arquivos alterados**
- `packages/context-engine/src/briefing-engine.ts` — `scoreTaskPriority()` (pontuação
  transparente: vencida+dias, vence-hoje, prazo próximo, prioridade, bloqueio,
  sem-responsável, aguardando-aprovação, cada fator explicado em `reasons`),
  `rankPriorities()` (ordena desc, exclui concluída), `computeNextBestActions()`
  (uma ação por risco, com o "porque"). Adicionados ao `OperationalBriefing` e
  renderizados no prompt (seções PRIORIZAÇÃO e PRÓXIMAS AÇÕES).
- `packages/context-engine/src/resolve-scope.ts` — marcadores de priorização/análise
  ('prioriz', 'o que priorizar', 'analise a operacao', 'como esta a operacao'...)
  agora disparam o caminho ESTRUTURADO (§113, §137), não a lista crua.
- Testes: `briefing-engine.test.ts` (+3 describes) e `resolve-scope.test.ts` (+3).

**Verificação**: `tsc` limpo (context-engine, api, orchestrator). Verificação
comportamental REAL do scorer/ranker/NBA + render do prompt via node strip-types:
8/8 checks. `vitest` roda na máquina do repo.

**Limite honesto**: a priorização por DEPENDÊNCIA entre tarefas (§50) não entra —
o ClickUp desta conta não expõe dependência de forma confiável por task no payload
usado; os outros fatores cobrem o essencial. Evidência por-item liga na Frente A
quando o OperationalState estruturado viajar até o worker (hoje o ranking vive na
camada da API/briefing).

## Frente D — Otto: porta determinística de qualidade criativa (anti-genérico) — 15/09/2026 — IMPLEMENTADA (fatia testável)

**Achado**: Otto é bem mais completo do que o audit inicial supôs. Já existem
`creative/quality.ts` (QC por LLM contra o plano), `creative/dna.ts`,
`learning/pipeline.ts` + `learning/feedback.ts` (funil de aprendizado
observation→experimental→validated→trusted→core ligado ao feedback humano do
Studio, persistido como memória escopada por cliente), `brain/retrieval.ts`. Ou
seja: CreativeState, memória criativa por cliente e aprendizado por feedback já
são reais. A lacuna clara vs. §74/§76 era a AUSÊNCIA de um avaliador criativo
DETERMINÍSTICO antes do LLM.

**Arquivos alterados**
- `packages/otto/src/creative/anti-generic.ts` — NOVO, PURO: `assessCreativeCopy()`
  detecta copy que "serviria para qualquer marca" (clichês) e exige âncora
  concreta (marca/número). Conservador de propósito (não reprova criação boa).
- `packages/otto/src/creative/anti-generic.test.ts` — NOVO.
- `packages/otto/src/index.ts` — export.
- `apps/worker/src/processors/agentic-profiles.ts` — `evaluatorFor('otto')` agora
  roda a porta determinística DEPOIS da régua base: copy genérica reprova, e o
  loop replaneja — que é a auto-revisão criativa (§73) sem segundo LLM.

**Verificação**: `tsc` limpo (otto, worker). Verificação comportamental REAL via
node strip-types: 5/5 (múltiplos clichês reprovam; copy específica com marca/número
passa; copy criativa limpa passa; reason explica). `vitest` na máquina do repo.

**Limite honesto**: o QC por LLM (`evaluateCreative`) e a geração criativa vivem no
otto-node (LLM local) e não são testáveis de forma determinística aqui — o que a
Frente D adicionou e verificou é a CAMADA determinística que faltava e o gatilho de
auto-revisão no runtime. CreativeState/research externo multi-fonte como estágios de
1a classe do runtime continuam no roadmap (doc 03, Frente D completa).

## Frente E (parcial) — Planner adaptativo + resolução do blocker de testes — 15/09/2026

**Planner adaptativo (P0, §10-15)** — IMPLEMENTADO e testado (vitest real).
Substituída a lista fixa `['entender','buscar contexto',...]` por um planejador
determinístico que produz um plano ESTRUTURADO e diferente por intenção:
- `packages/agent-runtime/src/planner.ts` — NOVO: `PlanStep`/`AgentPlan` (steps com
  tipo retrieve/analyze/tool/verify/evaluate + dependsOn), `buildPlan()` adaptativo
  (fast-path p/ saudação; factual → retrieve/evidência/verify-grounding; escrita →
  resolver/tool/read-back/evaluate; organizar → estado/risco/prioridade/próxima-ação/
  verify; criativo → contexto/gaps/research/conceito/copy/QC), detecção de lacuna de
  conhecimento (§15), `inferPlanSignals()` (write/ops por marcadores).
- `packages/agent-runtime/src/state.ts` — campo `structuredPlan`.
- `packages/agent-runtime/src/index.ts` — exports.
- `packages/agent-runtime/src/planner.test.ts` — NOVO (7 testes).
- `apps/worker/src/processors/agentic-dispatch.ts` — hook `plan` agora chama
  `buildPlan()` e grava `structuredPlan`; `metadata.agentic` ganha `plan_steps`,
  `knowledge_gaps` e `evidence_count` (observabilidade, §77).

**Blocker de testes (§86) — RESOLVIDO para a lógica pura.** Montei um ambiente
vitest Linux-nativo ISOLADO (fora de `mnt/`, sem tocar no `node_modules` macOS do
usuário: `npm install vitest` no VM Linux baixa binários corretos) e rodei os suites
puros de verdade: **61/61 testes PASSARAM** — agent-runtime loop+evaluator+grounding
(15) + planner (7) + briefing/priority-engine (26) + task-verification/read-back (9)
+ anti-generic (4).

**Honestidade sobre o que NÃO foi executado aqui** (precisa da máquina do usuário ou
CI com plataforma nativa + serviços vivos):
- Suites que dependem de DB/rede/mocks completos: resolve-scope, memory-engine,
  bento-action-guard, clickup-client, execute-job, otto/* — NÃO RODADOS.
- Build de produção (rollup/esbuild/next nativos), `db:generate`/`db:migrate` no
  Supabase, e testes E2E comportamentais contra ClickUp/LLM reais — NÃO RODADOS.
- O `act` do runtime segue delegando ao node remoto: o multi-step tool-loop REAL do
  Bento vive no bento-action-guard (create+assign+comment+read-back), não no loop
  genérico. O planner é adaptativo e observável, mas a execução passo-a-passo dentro
  do runtime não foi re-arquitetada (exigiria validação com agentes vivos).

## FASE FINAL (1-7) — 15/09/2026 — runtime multi-step, grounding, eventos, Otto creative

**FASE 1 — Multi-step Agent Runtime real.**
- `packages/agent-runtime/src/step-loop.ts` (NOVO): `runStepLoop` controla a
  progressão do plano — próximo passo (respeitando dependsOn) → handler por tipo
  (retrieve/analyze/tool/verify/evaluate) → observação → evidência → verificação →
  avaliação → replan → término por critério de sucesso. Proteções de loop reais:
  maxSteps, maxToolCalls, maxRetriesPerStep, timeout, detecção de tool repetida
  (§71), dead-end. `TerminationReason` explícito. `nextRunnableStep` puro.
- `apps/worker/src/processors/agentic-dispatch.ts`: reescrito para usar `runStepLoop`
  como MOTOR. O node segue sendo a inteligência (passos analyze/tool, memoizado —
  não multiplica custo); o runtime manda no estado. Grounding vira passo verify;
  evaluator vira passo evaluate; estratégia reduzida vira replan. Preservados:
  checkpoint por fase, agent_outcomes, episódio, node metadata. `metadata.agentic`
  agora traz termination_reason, plan_steps (com status), steps_observed.
- Testes: `step-loop.test.ts` (11) cobrem progressão, observação alimentando o
  próximo passo, término por sucesso, replan, dead-end, maxSteps, maxToolCalls,
  tool repetida, timeout.

**FASE 2 — Claim grounding por afirmação (§20-24).**
- `packages/agent-runtime/src/grounding.ts` (NOVO): `classifyClaimType`
  (fact/inference/recommendation), `splitClaims`, `groundClaims` (liga fato a
  evidência por token saliente; fato sem evidência = não ancorado). Integrado no
  dispatch: `metadata.agentic.claims` + `ungrounded_facts`. Testes: `grounding.test.ts` (7).

**FASE 3 — Bento event-driven (§37-39).**
- Achado: event-store (idempotente), webhook parsers e proactivity (detecção +
  três portas anti-spam) JÁ existiam. Gap real: a decisão evento→reação.
- `packages/orchestrator/src/event-intelligence.ts` (NOVO): `reactToEvent`
  (task.overdue/creative.rejected → sinal com próxima ação; task.completed/
  approved/created/updated/comment/briefing/client → só estado, sem spam),
  `signalsFromEvents`. Testes: `event-intelligence.test.ts` (6).

**FASE 4-6 — Otto Creative Intelligence.**
- `packages/otto/src/creative/creative-state.ts` (NOVO): `assembleCreativeState`
  (§52) + `assessCreativeReadiness` (lacunas §54 + requiresResearch §55/§67).
- `packages/otto/src/research/research.ts` (NOVO): `classifySourceQuality` (§58),
  `synthesizeFindings` (multi-fonte, dedup por veículo, §57), `researchToEvidence`
  (§59), `runResearch` (provedor injetado; só pesquisa se preciso §67).
- `packages/otto/src/creative/creative-pipeline.ts` (NOVO): `runCreativePipeline`
  (§60, §66) — estado → lacunas → pesquisa → geração → porta anti-genérico →
  AUTO-REVISÃO (regenera com nota até passar ou esgotar; genérica persistente NÃO
  é entregue como aprovada). O anti-generic gate agora faz PARTE do fluxo.
- Testes: creative-state (4), research (6), creative-pipeline (4).

**FASE 7 — Memória.** Retrieval (episódios+preferências, escopados por client/user)
e write (episódio deduplicado via memory-engine) JÁ integrados no dispatch;
memory-engine já faz dedup/escopo/supersessão/confiança. A prova E2E multi-sessão
(§46-50) é validação AO VIVO (precisa de DB + duas sessões).

**Verificação desta fase**: typecheck 10/10 pacotes limpo; lint 0 erros; e **95
testes reais rodados** em ambiente vitest Linux isolado (ar 40, tool-gateway 9,
context-engine 26, otto 14, orchestrator 6) — execução de verdade, não type-strip.

**Separação IMPLEMENTATION vs LIVE VALIDATION**: todo o código acima está feito e
verificado no que não depende de serviço externo. Continua dependendo da máquina
do usuário / serviços vivos: build de produção (binário nativo macOS), migration
no Supabase, e os smokes E2E contra ClickUp/LLM reais (ver release-smoke-tests.md).

## LIVE VALIDATION — tentativa 15/09/2026 — BLOQUEADA por ambiente

Tentei executar a validação ao vivo (Release Gate ponta a ponta). Diagnóstico real
do ambiente desta sessão:
- O shell que alcança a máquina do usuário é uma **VM Linux (aarch64)**, NÃO o shell
  macOS. `uname -sm` = `Linux aarch64`.
- O `node_modules` montado tem binários **darwin-arm64** (`@rollup/rollup-darwin-arm64`).
  Logo `pnpm test` e `pnpm build` FALHAM na VM: pedem `@rollup/rollup-linux-arm64-gnu`
  (erro reproduzido). Só typecheck/lint (JS puro) rodam aqui.
- **Nenhum serviço do Desigual OS está no ar / alcançável** da VM: portas 3000/3001/
  4000 (api/web), 4001/4002 (agent/otto node), 8791 (bento-qa), 6379 (redis), 11434
  (ollama) todas fechadas.

Consequência: bring-up do stack, UI real no navegador, escrita real no ClickUp PELO
pipeline do Bento, migration no Supabase e smokes E2E com LLM ao vivo são
IMPOSSÍVEIS a partir desta sessão. Não é falha de código — é blocker de ambiente
externo (precisa do Terminal do macOS + serviços rodando + Ollama/Redis/Supabase).

O que FOI reconfirmado aqui (JS puro): typecheck 10/10 limpo; lint 0 erros; e a
suíte pura em vitest Linux isolado (95 testes) — já registrada acima. Isso certifica
a LÓGICA, não o comportamento ao vivo.

DECISÃO DE DEPLOY: NÃO LIBERADO. Gate ao vivo não executado (build, migration, smokes
E2E, regressão) = NOT TESTED. Os comandos para fechar estão em release-smoke-tests.md
e no scripts/release-gate.sh, para rodar no Terminal do macOS do usuário.
