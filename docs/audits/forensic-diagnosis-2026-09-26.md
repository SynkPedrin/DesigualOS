# Auditoria Forense — FASE B (Diagnóstico) — 2026-09-26

Base: FASE A (`docs/audits/forensic-discovery-2026-09-25.md`). Nenhuma correção foi implementada; nenhuma flag foi alterada; nenhum commit foi feito. Toda evidência é reproduzível via artefatos e harnesses citados.

**Ambiente de prova:** commit `a15f6e9`, branch `feat/otto-motion-engine`, stack local viva (API :3001, worker, Redis, Postgres Supabase). Fato decisivo descoberto em B.1: o `.env` vivo tem `BENTO_OPENAI_CORE_ENABLED=true` (via `/ready`), em divergência com o handoff de release que declara a flag desligada. O benchmark forense das 10:54 de 25/09 rodou num worker anterior (caminho legado); a bateria desta fase (22:11+) rodou no worker atual (core novo). Isso deu comparação ao vivo dos dois caminhos **sem tocar em configuração**.

**Harnesses criados (todos novos, zero alteração de produção):**
- `apps/worker/src/processors/bento-guard-matrix.test.ts` + `artifacts/forensic-2026-09-25/bento-guard-matrix.json` (B.4, 33 frases)
- `apps/worker/src/processors/bento-fault-injection.test.ts` (B.8, 16 testes)
- `apps/worker/src/processors/bento-resource-continuity.test.ts` (B.7, 21 testes)
- `apps/worker/src/processors/bento-memory-trace.test.ts` (B.11, 21 testes)
- `apps/worker/src/processors/context-degradation.test.ts` (B.12, 10 testes; suíte worker 888/888 verde)
- `scripts/qa/fase-b-battery-20260925.mjs` + `artifacts/fase-b-2026-09-25/` (B.3/B.9 ao vivo, T00–T12 + DUP1/DUP2 + SUMMARY.md)
- `artifacts/baseline-2026-09-25/BASELINE.md` (B.1)

---

# 1. Executive diagnosis (15 pontos)

1. **O invariante UPDATE≠CREATE é violado pelo caminho legado em 54,8% dos phrasings naturais** (17/31 frases UPDATE-intent: 16 caem no fallback externo cego, 1 vira CREATE local real) — provado em harness que executa o guard real com mocks só de I/O.
2. **O modo de falha dominante do legado não é a regex de campo, é o portão 1** (`classifyActionIntent` V2, default ligado): 17/33 frases morrem em `READ_ONLY` e caem no `return null` → bento-qa externo, inclusive frases que a regex acertaria.
3. **O core novo, ao vivo, teve ZERO violações do invariante em 13 turnos** (bateria B.3 no cliente QA): toda resolução de alvo mirou a task correta. Os P0 do legado desaparecem no core.
4. **Mas o core novo tem seus próprios P0/P1 provados por fault injection**: create via MCP duplica em retry (sem reconcile-first); dedup de operação repetida está morto no caminho novo (ExecutionRecord nunca gravado); token OAuth MCP sem refresh e sem checagem de expiração; create MCP sem task_id parseável persiste sucesso sem registrar foco → follow-up perde a referência.
5. **O bento-qa externo é uma caixa-preta de escrita confirmada**: payload de 3 campos, sem idempotency key, sem task_id de volta, sem conversation state; já criou task real a partir de meta-pedido (incidente documentado em `bento-action-guard.ts:38-46`). BullMQ ainda re-tenta o job inteiro 1× sobre esse serviço sem idempotência.
6. **A continuidade de recurso tem 4 pontos de perda provados**: MCP com resourceId null; listagens via caminho antigo não gravam no estado novo (ponte só dispara com foco vazio); conversa nova; e linha de outro `contextType` em `conversation_context` **zera o estado na leitura** (bug latente, falta filtro — 1 linha).
7. **Foco de recurso não entende referência estrutural**: "voltar pra A" não move foco (único mutador é write); "naquela primeira" resolve a focada (B), não a primeira (A); referência por título parcial que casa com recurso fora do foco é ignorada silenciosamente.
8. **Estado de recurso é por conversa, sem dimensão de usuário**: dois usuários na mesma conversa compartilham foco (cross-user targeting).
9. **Memória semântica/episódica do Bento é boa no caminho feliz** (supersessão, isolamento de cliente e environment provados), **mas falha silenciosamente em 4 condições**: catch silencioso em 11/14 camadas de contexto; D-09 (dossiê/learnings sem filtro de environment em DOIS caminhos); recall factual com acentos retorna 0 ("orçamento" não acha "orçamento"); só 4/10 frases naturais de decisão viram episódio.
10. **A genericidade do Otto tem causa principal confirmada e medida**: perda de até 66% do contexto sem nenhum sinal em log/metadata; 50 catches silenciosos no caminho Otto (12 em execute-job, 4 em client-context, resto no loop); omissão silenciosa de brand kit/feedback por ausência de dados (nem falha precisa); gates de qualidade degradam junto (linguagem proibida extraída do contexto que sumiu); anti-genérico não roda no caminho de chat.
11. **O otto-node NÃO é a camada cega** — todos os catches dele logam warn/error com razão. A cegueira nasce no worker.
12. **Idempotência ao vivo funciona em duas camadas, com limite documentado**: janela de 15s no Redis (409/replay provados) + reconcile-first por nome no executor legado segurou duplicata fora da janela. Lacuna: variação de nome não é coberta; create via MCP não tem nenhuma das duas.
13. **Observabilidade não sustenta "por que esta mensagem criou outra task?"**: 11/13 turnos ao vivo sem nenhuma linha de log com execution_id; decisão de rota só existe em `messages.metadata`; prompts/respostas do LLM não são persistidos; `usage` sempre 0.
14. **Incidente de ambiente durante a bateria**: o stack congelou 2× (~5-15 min, watchdog "Worker doente"). Causa indeterminada — possivelmente induzido pela carga da própria auditoria (vitest paralelos + bateria ao vivo). Registrado como risco de reliability a investigar, não como bug confirmado.
15. **Hipótese errada corrigida**: "o caminho de produção é o guard legado" — na configuração viva atual, o core novo roda primeiro e o guard é o resíduo para o que o core abstém (reads) ou não cobre. O perigo real hoje é a **coexistência**: dois estados de recurso, dois dedups, dois read-backs, e o fallback externo cego no rabo do legado.

---

# 2. Tabela forense

| ID | Sev | Componente | Reprodução | Causa-raiz | Evidência | Legacy | New Core | Correção proposta |
|---|---|---|---|---|---|---|---|---|
| F-01 | P0 | guard→bento-qa | "coloca o Matheus nela" etc. | portão 1 V2 devolve null; externo tem escrita sem idempotência | guard-matrix (16/31); `bento-action-guard.ts:1330` | ATIVO | N/A (core não cai no externo) | cortar fallback de escrita pro bento-qa; externo vira somente leitura |
| F-02 | P0 | guard regex | "adiciona o Matheus também" → CREATE real | UPDATE_ASSIGNEE sem "adiciona"; `decideFallbackIntent` sem referente → `criacaoPadrao` | guard-matrix, contador createTask=1 | ATIVO | OK ao vivo (T04 noop correto) | VERBO_EDICAO + "adiciona"; invariante anti-create antes do criacaoPadrao |
| F-03 | P0 | core MCP | retry de create após timeout | sem reconcile-first no executor MCP | fault-injection CASO 1b: 2 creates | OK (reconcile no legado) | ATIVO | reconcile-first read-only no create MCP ou idempotency key por (conversa, ação) |
| F-04 | P1 | core dedup | mesmo update 2× na conversa | `envelopeToExecuteResponse` não grava `metadata.execucao`; parser exige | fault-injection CASO 2c | OK | ATIVO | gravar execucao no caminho novo ou parsear write_envelope |
| F-05 | P1 | core dedup | create repetido | filtro exige resolvedResourceId (create não tem) | fault-injection CASO 2b; `bento-openai-core.ts:158` | parcial | ATIVO | dedup por (operation, título normalizado, lista) |
| F-06 | P1 | MCP OAuth | token expira | `getClickUpMcpAccessToken` não confere expiração; refresh_token capturado e nunca usado | fault-injection CASO 4; `clickup-mcp-oauth.ts:142-146,164-171` | N/A | ATIVO | checar expiresAt + refresh flow; 401 → re-auth, não retry |
| F-07 | P1 | MCP fallback | token ausente | `selectWriteProvider` cai pro LEGACY sem log nem aviso; contradiz doc | fault-injection CASO 4a; `bento-mcp-executor.ts:40-47` | N/A | ATIVO | logar downgrade; alinhar doc↔código |
| F-08 | P1 | core MCP | output sem task_id | parse best-effort; persiste success sem foco | fault-injection CASO 5/6b; `bento-mcp-executor.ts:137-146` | OK (id estruturado) | ATIVO | não persistir execução sem resourceId; read-back por listagem |
| F-09 | P1 | resource state | outro writer em conversation_context | load não filtra `contextType`; parse defensivo zera estado | resource-continuity (bug latente); `bento-resource-state.ts:52` | N/A | ATIVO | `and(eq(conversationId), eq(contextType,...))` |
| F-10 | P1 | resource state | "voltar pra A" / "naquela primeira" | único mutador é write; policy cega a ordinal/título; ponte só com foco vazio | resource-continuity cenários 3/7 | parcial (snapshot) | ATIVO | resolver referência estrutural sobre recentCreated antes do foco |
| F-11 | P1 | contexto | qualquer falha de I/O nas camadas | 11/14 camadas com `.catch(() => [])` sem log; `:322` falha vira 'production' | memory-trace item 5; context-degradation | ATIVO | ATIVO | fail-visible: contador + warn + metadata de degradação por fonte |
| F-12 | P1 | memória | dossiê QA entra em prod | build-context e client-context sem filtro environment | memory-trace D-09 provado; `build-context.ts:121-140`; `client-context.ts:174-184` | ATIVO | ATIVO | adicionar environment às queries (D-09) |
| F-13 | P1 | memória | "orçamento" não acha "orçamento" | query normalizada sem acento × ILIKE em dado acentuado | memory-trace provado; `episodic-memory.ts:295-312,349-352` | ATIVO | ATIVO | unaccent nos dois lados |
| F-14 | P1 | intent routing | "troca o responsável pra Sofia" (T05), "corrige a task…" (T12) | fast_path knowledge_statement captura UPDATE-intent antes do core | bateria ao vivo T05/T12 | N/A | ATIVO | fast_path não pode capturar verbo de ação sobre recurso em foco |
| F-15 | P1 | core update | T06/T07 falharam (briefing/prioridade) | geração de texto do update falhou (conteúdo preservado) | bateria ao vivo T06/T07 | OK (regex específica) | ATIVO | investigar falha de geração; retry específico |
| F-16 | P1 | observabilidade | qualquer incidente | execution_id ausente em 11/13 turnos de log; decisão de rota não logada | bateria B.2 | ATIVO | ATIVO | trace estruturado ponta a ponta (FASE C/D) |
| F-17 | P2 | planner core | "não, tira o Matheus dela" (T10) | planner falhou com ação fora do schema (remove assignee não modelado?) | bateria ao vivo T10 | parcial | ATIVO | estender schema do planner p/ remoção de responsável |
| F-18 | P2 | core comment | "coloca essa observação…" (T11) | comentou placeholder "observação não especificada" em vez de esclarecer | bateria ao vivo T11 | N/A | ATIVO | policy: comment sem conteúdo → esclarecimento |
| F-19 | P2 | recall episódico | fato antigo relevante com termo comum | ILIKE + limit 6 por recência, sem ranking | memory-trace volume | ATIVO | ATIVO | tsvector/GIN ou ranking |
| F-20 | P2 | episódios | "tá decidido", "pode seguir" | FORMAS regex exigem dialeto exato (4/10) | memory-trace | ATIVO | ATIVO | ampliar formas + confirmação de turno anterior |
| F-21 | P2 | supersessão episódica | redação divergente revive fato velho | aposentadoria é só rótulo por similaridade lexical | memory-trace | ATIVO | ATIVO | superseded_by persistido em agent_episodes |
| F-22 | P2 | openai provider | 429/5xx | 1 retry imediato sem backoff/jitter | discovery D-14; `responses-client.ts:139-146` | ATIVO | ATIVO | backoff exponencial + jitter |
| F-23 | P2 | resource state | 50 writes = 50 linhas | append-only sem compactação; recentUpdated sem dedup | resource-continuity | N/A | ATIVO | job de retenção; dedup por resourceId |
| F-24 | P2 | temperatura Otto | qualquer copy | provider OpenAI descarta temperature silenciosamente | B.12; `openai-provider.ts:61-68` | N/A | ATIVO | repassar temperature no request |
| F-25 | P1 | reliability | freeze 2× durante bateria | indeterminado (possível carga da auditoria) | logs watchdog "Worker doente" 01:12-01:43 UTC | ? | ? | investigar separadamente; soak test na FASE E |
| F-26 | P2 | config | flags divergentes doc↔vivo | handoff diz flag off; .env vivo tem on; flags ausentes do .env.example | baseline B.1 | — | — | documentar flags; alinhar handoff |

---

# 3. Bento Legacy vs New Core (comparativo objetivo)

| Dimensão | Legacy (guard regex + externo) | New Core (planner+policy+MCP/REST) |
|---|---|---|
| Intent resolution | regex PT + portão V2; 54,8% de UPDATE-intent inseguros | LLM estruturado; ao vivo 13/13 alvos corretos |
| Resource resolution | snapshot `metadata.selecao`; perde referência (B04-B06 de hoje) | `ConversationResourceState` + ponte; falhas F-08/F-09/F-10 |
| UPDATE→CREATE | viola (F-01/F-02) | invariante estrutural (policy pura, provado CASO 7) |
| Read-back | campo-a-campo real | legado: idem; MCP: só existência (F-08) |
| Create retry | reconcile-first (1 task provado) | MCP duplica (F-03, P0) |
| Dedup operação | ExecutionRecord funciona | morto (F-04) |
| Ambiguidade | esclarece quando regex entende | esclarece estruturalmente (target_unresolved) |
| Continuidade | snapshot sobrevive reload; perde entre caminhos | append-only sobrevive restart; perde em 4 pontos |
| Latência | rápido (regex) / externo 100-120s | planner LLM + execução (observado ~25-60s/turno ao vivo) |
| Error recovery | honesto quando pega; cego quando cai no externo | explícito, sem fallback silencioso pro guard |
| Cobertura vocabular | limitada ao regex; cada frase nova = incidente | generaliza (LLM), mas falha em remove-assignee (F-17) |

**Conclusão da comparação**: o core novo é arquiteturalmente superior em todas as dimensões de segurança de intenção; o legado só vence em read-back de create (reconcile-first) e dedup — exatamente as duas peças que o caminho MCP do core não herdou.

---

# 4. Resource continuity report

Onde task_id **nasce**: (a) REST legado — `createVerifiedSeniorTask` retorna id estruturado; (b) MCP — parse best-effort de output livre (`bento-mcp-executor.ts:137-146`); (c) externo bento-qa — **nasce e morre lá** (schema de resposta nem tem campo).

Onde **circula**: WriteEnvelope.resourceIds → `applyExecutionToState` → foco/recentCreated/lastExecution; policy `resolveTargetResourceId` → executores.

Onde **persiste**: `conversation_context` append-only (contextType `bento_resource_state`), 1 linha por write verificado; snapshot legado em `messages.metadata.selecao`.

Onde **se perde** (4 pontos provados + 1 herança indevida): MCP sem id (F-08); listagens do caminho antigo não gravam no novo (ponte só com foco vazio, F-10); conversa nova (por design, mas amplifica os anteriores); linha estrangeira em conversation_context zera o estado (F-09); usuário diferente na mesma conversa **herda** o foco (sem dimensão de ator).

---

# 5. Idempotency report

| Operação | Proteção real | Prova | Lacuna |
|---|---|---|---|
| POST /chat (qualquer) | chave 15s Redis; 409 in-flight / 202 replay | DUP1 ao vivo: 409+202 ✔ | fail-open se Redis cai (deliberado) |
| Create task REST legado | reconcile-first por (lista, título exato) | DUP2 ao vivo (fora da janela): 1 task ✔ | variação de nome não coberta |
| Create task MCP | **nenhuma** | fault-injection: 2 tasks | F-03 (P0) |
| Update task | dedup por ExecutionRecord (legado) | fault-injection CASO 2a ✔ | caminho novo não grava record (F-04) |
| Webhook ClickUp | dedup commentId Redis SET NX + marker | código (`clickup/routes.ts:759-770`) | fail-open se Redis cai |
| Job BullMQ | attempts 2 (bento); pós-execução protegido | código | retry re-executa side effect se não dedupado (amplifica F-03) |
| bento-qa externo | **nenhuma conhecida** | contrato lido | EXTERNAL/OPAQUE |

---

# 6. MCP reliability report

| Item | Classificação | Evidência |
|---|---|---|
| Ausência de `allowed_tools` | P2 | decisão deliberada documentada; risco contido pela policy upstream; mas sem enumeração de schemas, drift do servidor ClickUp passa despercebido — adicionar contract test |
| Parsing livre de task_id | **P1** | F-08: foco perdido, read-back pulado, continuidade quebrada |
| Inexistência de refresh OAuth | **P1** | F-06/F-07: expiração → retry inútil ou fallback silencioso pro legado; contradiz doc do próprio arquivo |
| Read-back superficial (só existência) | **P1** | `bento-mcp-executor.ts:148-156`: update pode não ter aplicado os campos e success=true com ressalva |
| Ausência de ExecutionRecord | **P1** | F-04: dedup morto no caminho novo |
| Conexão atual | OK | `/ready`: clickup_mcp=authorized (1 conexão em integration_connections) |

Veredito: a OpenAI Responses executa o MCP com contrato **suficiente para happy path**, insuficiente para operação confiável (sem reconcile, sem id estruturado garantido, sem refresh).

---

# 7. Memory report

| Tipo | Estado | Efetivamente usada? | Falhas provadas |
|---|---|---|---|
| Working | PARCIAL (checkpoint) | sim | — |
| Conversation | EXISTE | sim | 6 turnos/1800 chars; perde fora da janela |
| Resource | PARCIAL | sim (core novo) | F-08/F-09/F-10; sem dimensão de usuário |
| Project | EXISTE | sim | — |
| Client | EXISTE | sim | **D-09: sem filtro environment em 2 caminhos (F-12)** |
| Agency | PARCIAL | estático + eventos | — |
| Episodic | EXISTE | sim | supersessão só por rótulo lexical (F-21); ILIKE acento-sensível (F-13); 4/10 decisões naturais capturadas (F-20); degrada com volume (F-19) |
| Semantic | EXISTE | sim | supersessão/dedup/isolamento provados OK |
| Procedural | PARCIAL | episódio de estratégia | — |

Cenário 4 dias: **passa** na camada semântica (versão vigente vence, sem contaminação de cliente/environment) e **passa parcialmente** na episódica (rótulo salva se redação similar; furo se redação diverge).

---

# 8. Otto degradation report

Medido com harness real (`context-degradation.test.ts`, 10 cenários, suíte worker 888/888 verde):

- Falha do nome do cliente → **−66% do contexto** entregue ao node, **zero** warn/error (cascata B completa: sem clientId → DNA unresolved → vault bloqueia material de cliente → copy de mundo).
- Falha do dossiê → bloco declara "sem dossiê" mas nenhum sinal operacional; gate de linguagem proibida vira no-op (extrai frases do contexto que sumiu).
- Brand kit/feedback **ausentes** (nem falha precisa) → campos omitidos por spread condicional → DNA nasce null.
- 50 catches silenciosos no caminho Otto (12 execute-job + 4 client-context + 21 agentic-dispatch + 13 satélites) vs 34 com log; otto-node: **0 silenciosos, 11 com log**.
- Onde não há catch (`execute-job.ts:1293,1311,1331`), o sistema crasha e a execution **fica presa em running** (failExecution fora de alcance).
- Agravantes medidos: anti-genérico (41 clichês) não roda no chat; âncora de especificidade é anulada pelo nome do cliente presente no pedido; temperature descartada no provider OpenAI (F-24).

**Veredito: silent fallbacks = causa principal confirmada**, reforçados por omissão silenciosa de campos e ausência de gate de genericidade no chat. A/B com LLM real ficou bloqueado por política de secrets (OPENAI_API_KEY não está no shell); infra documentada (deps.llm injetável + Ollama local) para execução futura.

---

# 9. Release blockers (P0/P1 comprovados)

**P0**: F-01 (fallback externo de escrita), F-02 (UPDATE→CREATE local no legado), F-03 (duplicata MCP em retry).

**P1**: F-04, F-05, F-06, F-07, F-08, F-09, F-10, F-11, F-12, F-13, F-14, F-15, F-16, F-25 (investigar).

Todos com reprodução executável nos harnesses/artefatos citados.

---

# 10. FASE C PROPOSAL — arquitetura de convergência

**Legado deve morrer?** Sim, em duas etapas — não numa. Etapa 1: matar o **rabo perigoso** (fallback de escrita pro bento-qa vira somente leitura; `criacaoPadrao` ganha invariante anti-create). Etapa 2: após o core cobrir reads (`read_tasks`/`get_task`/`analyze_tasks` hoje abstêm), aposentar o guard.

**Core novo vira caminho canônico?** Sim — a evidência ao vivo (0 violações, resolução de alvo perfeita) + a superioridade estrutural (policy pura, invariante UPDATE≠CREATE por construção) justificam. **Antes disso, corrigir obrigatoriamente**: F-03 (reconcile-first MCP), F-04 (ExecutionRecord), F-06/F-07 (OAuth refresh + fallback logado), F-08 (id obrigatório p/ persistir foco), F-09 (filtro contextType), F-14 (fast_path capturando UPDATE). Os P1 de memória/contexto (F-11/F-12/F-13) são transversais e independentes do cutover.

**Migração de estado?** Não destrutiva: o snapshot legado (`metadata.selecao`) continua lido pela ponte até o estado novo estar populado; nenhuma migração de dados — apenas convergência de escrita no estado novo + leitura dual por 1 ciclo de release.

**Rollback?** Flag `BENTO_OPENAI_CORE_ENABLED` já é o kill switch por processo. Adicionar: flag por-organização (`BENTO_CORE_ORGS`) para canary; rollback = desligar + restart do worker (launchd), sem migração reversa (estado legado nunca é apagado).

**Rollout progressivo:** (1) correções P0/P1 do core; (2) shadow mode (abaixo); (3) canary 1 conversa QA + 1 usuário interno; (4) 100% com guard reduzido a reads; (5) remoção do guard após 2 semanas sem incidente.

**Shadow mode:** executar core novo E guard em paralelo **sem que o shadow escreva**: o shadow roda planner+policy e registra a decisão proposta (intent, target, teria-executado) numa tabela/log estruturado; divergências viram métrica diária. Zero double execution por construção: só o caminho ativo tem executor; o shadow recebe executores mockados de gravação (dry-run envelope).

**Prevenção de double execution:** (a) executor único por turno (já é assim: `guardedResult` exclusivo); (b) reconcile-first em TODOS os creates (REST hoje, MCP a corrigir); (c) ExecutionRecord gravado por todos os caminhos; (d) idempotency key estável por (conversationId, hash da ação proposta) gravada antes da mutação.

**Feature flags:** manter `BENTO_OPENAI_CORE_ENABLED` (master); novas: `BENTO_CORE_ORGS` (canary), `BENTO_SHADOW_MODE` (comparação), `BENTO_EXTERNAL_WRITE_ENABLED=false` (mata F-01 por configuração), `CLICKUP_MCP_WRITES_ENABLED` (permite desligar MCP e usar só REST até F-03/F-06 fecharem).

**Invariantes como release gates** (todos já têm harness executável):
- INV-001 UPDATE nunca cria sem autorização — guard-matrix + bateria ao vivo + fault-injection CASO 7;
- INV-002 operação repetida não duplica — fault-injection CASO 1/2 + DUP ao vivo;
- INV-003 sucesso só após verificação — read-back campo-a-campo em todo caminho de escrita;
- INV-004 referência resolvida permanece correta na sessão — resource-continuity (21 testes);
- INV-005 memória de Cliente A não contamina B — memory-trace isolamento;
- INV-006 conhecimento antigo não sobrescreve recente — memory-trace supersessão;
- INV-007 tool failure nunca apresentada como sucesso — fault-injection CASO 3/5;
- INV-008 fallback de escrita externo proibido — F-01 fechado por config + teste.
