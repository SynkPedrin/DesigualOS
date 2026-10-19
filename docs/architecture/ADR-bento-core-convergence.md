# ADR — FASE C: Convergência do Bento para um caminho operacional canônico

- **Status**: Proposta (aguardando aceite para início da Etapa 1)
- **Data**: 2026-09-26
- **Decisores**: arquitetura Desigual OS (a ratificar pelo owner do release)
- **Base de evidência**: FASE A — `docs/audits/forensic-discovery-2026-09-25.md`; FASE B — `docs/audits/forensic-diagnosis-2026-09-26.md`; código confirmado no commit `a15f6e9` (branch `feat/otto-motion-engine`)

---

## 1. Contexto

O Bento — agente operacional que escreve no ClickUp — executa hoje sobre **dois caminhos coexistindo** no mesmo processo do worker, selecionados por precedência em `apps/worker/src/processors/execute-job.ts:1188-1235`:

1. **Core novo** (`apps/worker/src/processors/bento-openai-core.ts`, atrás de `BENTO_OPENAI_CORE_ENABLED`): planner LLM **sem tools** que devolve uma ação estruturada (`packages/bento-core/src/planner.ts`) → policy determinística e pura que valida ação, permissão, cardinalidade e resolve o alvo contra o estado da conversa (`packages/bento-core/src/policy.ts:42`) → execução por um único provider (MCP via tool nativa da OpenAI Responses, ou gateway REST legado) → read-back → persistência do `ConversationResourceState` em `conversation_context` (`bento-resource-state.ts`).
2. **Guard legado** (`apps/worker/src/processors/bento-action-guard.ts`): classificação de intenção por regex PT + "portão 1" (`classifyActionIntent`, `:1245-1330`) → executores REST com read-back campo-a-campo. Quando o portão não autoriza escrita, `return null` (`:1330`) despacha o pedido para o serviço externo `bento-qa` (:8791, fora do repo), que possui credencial real de escrita e nenhuma idempotência conhecida.

Como consequência, existem também **dois estados de recurso paralelos**: o `ConversationResourceState` novo (append-only em `conversation_context`, contextType `bento_resource_state`) e o snapshot legado em `messages.metadata.selecao` — historicamente desconectados, unidos apenas por uma ponte recente (`bento-legacy-selection-bridge.ts`, 25/09) que só dispara com foco vazio.

**Evidência da FASE B** (comparação ao vivo dos dois caminhos, sem tocar configuração): a configuração viva tem `BENTO_OPENAI_CORE_ENABLED=true`; o benchmark forense de 25/09 rodou no caminho legado e a bateria de 26/09 (T00–T12 + DUP1/DUP2, artefatos em `artifacts/fase-b-2026-09-25/`) rodou no core novo. Isso provou, lado a lado, os defeitos do legado e as falhas próprias do core.

## 2. Problemas do caminho legado

- **F-01 (P0) — fallback externo de escrita opaco**: 16 de 31 phrasings naturais de UPDATE-intent (51,6%) morrem em `READ_ONLY`/null no portão 1 e caem no `bento-qa` externo — payload de 3 campos, sem idempotency key, sem task_id de retorno, sem estado de conversa, com credencial real de escrita. Incidente real documentado: meta-pedido virou task real criada fora do dispatch (`bento-action-guard.ts:38-46`; `execute-job.ts:1218-1226`). BullMQ ainda re-tenta o job 1× sobre esse serviço não idempotente.
- **F-02 (P0) — UPDATE→CREATE local**: `decideFallbackIntent` sem referente reclassifica update como `criacaoPadrao`; provado em harness com `createTask=1` sobre frase de atribuição. Somando F-01 + F-02, **54,8% dos UPDATE-intent são inseguros** no legado (17/31).
- **Fragilidade estrutural de regex**: o modo de falha dominante não é a regex de campo, é o portão 1 (`classifyActionIntent` V2) — 17/33 frases morrem ali, inclusive frases que a regex acertaria. Cada phrasing novo é um incidente potencial (D-02).
- **Sem invariante estrutural**: a regra "UPDATE nunca vira CREATE" existe apenas como comentário e boa vontade da regex; nada no tipo ou na máquina de estados impede a violação.

## 3. Vantagens e falhas do core novo

**Vantagens provadas**:

- **Invariante UPDATE≠CREATE estrutural**: a policy é código puro e determinístico (`policy.ts:62-69`) — update/comment sem `resolvedResourceId` devolvem `target_unresolved` e viram esclarecimento, nunca create. "The model proposes. Code validates."
- **Zero violações ao vivo**: bateria de 13 turnos no cliente QA com resolução de alvo correta em 13/13; os P0 do legado desaparecem no core.
- Falha explícita (sem fallback silencioso pro guard), dedup estrutural de ambiguidade, esclarecimento honesto.

**Falhas provadas (fault injection + bateria ao vivo)**:

- **F-03 (P0)**: create via MCP duplica em retry — sem reconcile-first nem idempotency key (fault-injection CASO 1b: 2 creates).
- **F-04 (P1)**: dedup de operação repetida morto no caminho novo — `envelopeToExecuteResponse` (`bento-openai-core.ts:46-61`) não grava `metadata.execucao`/ExecutionRecord, que o parser do dedup exige.
- **F-06/F-07 (P1)**: token OAuth MCP sem checagem de expiração nem refresh (`clickup-mcp-oauth.ts:142-146,164-171`); token ausente → `selectWriteProvider` cai pro LEGACY sem log (`bento-mcp-executor.ts:40-47`), contradizendo o doc do próprio arquivo.
- **F-08 (P1)**: extração de task_id do output MCP é best-effort (`bento-mcp-executor.ts:137-146`); create sem id parseável persiste sucesso sem registrar foco → follow-up perde a referência. Read-back MCP é só de existência, não campo-a-campo (`:148-156`).
- **Abstinência para reads**: `read_tasks`/`get_task`/`analyze_tasks` devolvem `null` de propósito (`bento-openai-core.ts:97-99`) e caem no guard legado — o core ainda depende do legado para leitura/análise.
- **F-09 (P1, latente)**: `loadResourceState` não filtra `contextType` (`bento-resource-state.ts:52`) — linha estrangeira em `conversation_context` zera o estado na leitura (correção de 1 linha).
- **F-14/F-15/F-17/F-18**: fast_path `knowledge_statement` captura UPDATE-intent antes do core (T05/T12); geração de texto do update falhou em T06/T07; remove-assignee fora do schema do planner (T10); comment sem conteúdo vira placeholder em vez de esclarecimento (T11).

## 4. Decisão

**O core novo (planner + policy + MCP/REST) torna-se o caminho canônico de operação do Bento. O legado entra em deprecation em duas etapas:**

- **Etapa 1 — matar o rabo perigoso** (independe do cutover completo): o fallback externo `bento-qa` torna-se **somente leitura** (`BENTO_EXTERNAL_WRITE_ENABLED=false`); `criacaoPadrao` ganha invariante anti-create (UPDATE-intent nunca cai em create padrão sem referente resolvido).
- **Etapa 2 — aposentar o guard**: somente após o core cobrir reads (`read_tasks`/`get_task`/`analyze_tasks`) e fechar os blockers da seção 6, o guard é removido do caminho quente.

Princípios permanentes da decisão:

1. **UM caminho canônico** de operação por turno — `guardedResult` exclusivo já garante executor único; o que acaba é a coexistência de lógicas.
2. **UM estado de recurso** — `ConversationResourceState` em `conversation_context`; o snapshot legado só é lido pela ponte durante a transição (seção 9).
3. **Side effects controlados** — toda mutação passa por policy pura, reconcile-first, ExecutionRecord e read-back verificado; nenhuma escrita acontece fora de um envelope auditável.

## 5. Alternativas consideradas e rejeitadas

**(a) Manter os dois caminhos indefinidamente.** Rejeitada: a coexistência é o perigo real de hoje (diagnóstico, item 15 do executive summary) — dois estados de recurso, dois dedups, dois read-backs e o fallback externo cego no rabo do legado. Cada dia de coexistência mantém F-01/F-02 ativos em 54,8% dos UPDATE-intent.

**(b) Endurecer só a regex do guard.** Rejeitada: a FASE B provou que o modo de falha dominante é o portão 1 de classificação, não a regex de campo — e que cada phrasing novo é um incidente (D-02/F-02). Regex não pode gerar invariante estrutural; a forense anterior já havia provado que os P0 são estruturais (cardinalidade, memória de recurso, idempotência), não de modelo nem de parser.

**(c) Rewrite total do Bento.** Rejeitada: o core novo já existe, é arquiteturalmente superior e demonstrou 0 violações em 13 turnos ao vivo; o legado tem executores verificados (read-back campo-a-campo, reconcile-first REST) que o caminho MCP ainda precisa herdar. Um rewrite descartaria evidência viva e peças boas comprovadas — risco de regressão maior que a convergência cirúrgica.

**(d) Trocar o modelo LLM.** Rejeitada: a FASE A já registrou como hipótese errada ("trocar modelo resolve") — os P0 são estruturais (fallback sem idempotência, dois estados, UPDATE→CREATE por construção). O planner novo em `gpt-5.6-terra` resolveu 13/13 alvos ao vivo; o modelo não é o gargalo evidenciado.

## 6. Plano de migração

| Fase | Conteúdo | Critério de entrada | Critério de saída |
|---|---|---|---|
| **0. Correção de blockers** | F-03 (reconcile-first ou idempotency key no create MCP), F-04 (ExecutionRecord gravado pelo caminho novo), F-06/F-07 (expiração + refresh OAuth, downgrade logado), F-08 (não persistir execução sem resourceId; read-back por listagem), F-09 (filtro `contextType`), F-14 (fast_path não captura UPDATE sobre recurso em foco) | ADR aceita | Fault-injection 16/16 verde; bateria ao vivo T00–T12 sem P0; F-01 fechado por config (`BENTO_EXTERNAL_WRITE_ENABLED=false`) |
| **1. Shadow mode** | Core e guard rodam em paralelo; o shadow executa planner+policy e registra decisão proposta (intent, target, teria-executado) em log/tabela estruturada com executores mockados (dry-run envelope) — zero double execution por construção | Fase 0 concluída; `BENTO_SHADOW_MODE` implementada | ≥ 5 dias úteis de shadow em produção; divergência de decisão < 5% dos turnos com escrita; nenhuma divergência que criaria task indevida |
| **2. Canary por organização** | `BENTO_CORE_ORGS` ativa o core como caminho único para 1 conversa QA + 1 usuário interno | Shadow limpo | 2 semanas sem P0; invariantes INV-001..015 verdes em ambiente canary |
| **3. Full rollout** | Core canônico para 100%; guard reduzido a reads; MCP writes via `CLICKUP_MCP_WRITES_ENABLED` conforme F-03/F-06 | Canary limpo | 2 semanas em 100% sem P0; métricas da seção 11 estáveis |
| **4. Remoção do guard** | Core cobre `read_tasks`/`get_task`/`analyze_tasks`; guard e fallback externo removidos do caminho quente; ponte legada vira leitura somente para estado antigo | Core com cobertura de reads verificada por harness | 2 semanas sem incidente após remoção; guard apagado ou arquivado fora do dispatch |

Os P1 de memória/contexto (F-11, F-12, F-13) são transversais e **não bloqueiam** o cutover — seguem em trilha própria.

## 7. Rollback

- **Kill switch por flag/process**: `BENTO_OPENAI_CORE_ENABLED=false` + restart do worker (launchd) restaura o guard legado como caminho completo em minutos. Por organização, basta remover o id de `BENTO_CORE_ORGS`.
- **Sem migração reversa de dados**: o estado legado (`messages.metadata.selecao`) nunca é apagado; o estado novo é append-only, então rollback não exige undo — apenas troca de leitor/escritor.
- **Rollback parcial de provider**: `CLICKUP_MCP_WRITES_ENABLED=false` devolve as escritas ao gateway REST legado (com reconcile-first) sem desligar o core.
- **Limite conhecido**: rollback reativa F-01/F-02 se `BENTO_EXTERNAL_WRITE_ENABLED` voltar a `true` — a Etapa 1 (fallback somente leitura) é permanente e não participa de rollback.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| **Cobertura de reads do core incompleta** — hoje abstém (`bento-openai-core.ts:97-99`) e depende do guard | Fase 4 só começa com harness de reads verde; até lá o guard sobrevive reduzido a reads |
| **Latência do planner LLM** — observado ~25-60s/turno ao vivo vs regex instantânea | Medir p50/p95 por turno (métricas, seção 11); budget tier `normal`; cache de estado; avaliar fast-path determinístico para intents óbvios sem comprometer o invariante |
| **Dependência dupla externa** — OpenAI (planner + execução MCP server-side) + MCP remoto `mcp.clickup.com` | `CLICKUP_MCP_WRITES_ENABLED=false` isola MCP; falha de planner é explícita (sem escrita); retry com backoff+jitter (F-22) |
| **Drift de schemas MCP sem `allowed_tools`** — decisão deliberada (`bento-mcp-executor.ts:17-22`), mas sem enumeração de schemas o servidor ClickUp pode mudar e passar despercebido | Contract test diário contra o MCP (listar tools, validar create/update/comment); alerta em drift; read-back por listagem como rede de segurança (F-08) |
| **Congelamentos observados durante a bateria (F-25)** — causa indeterminada | Investigar separadamente; soak test na FASE E antes do full rollout |
| **Estado de recurso sem dimensão de usuário** — dois usuários na mesma conversa compartilham foco | Registrar como limitação conhecida; adicionar dimensão de ator em fase posterior (não bloqueia cutover) |

## 9. Compatibilidade e migração de estado

- **Não destrutiva**: nenhuma migração de dados. O snapshot legado (`messages.metadata.selecao`) continua lido pela ponte (`bento-legacy-selection-bridge.ts`) enquanto o estado novo estiver vazio — leitura dual por 1 ciclo de release, convergência de escrita apenas no estado novo.
- **ExecutionRecord universal**: a partir da Fase 0, **todos os caminhos de escrita gravam ExecutionRecord** (`metadata.execucao` ou equivalente parseável), restaurando o dedup no caminho novo (F-04) e unificando a trilha de auditoria.
- Conversas antigas sem estado novo: primeiro update usa a ponte; creates sempre populam o estado novo via `applyExecutionToState`.

## 10. Feature flags

| Flag | Default | Papel |
|---|---|---|
| `BENTO_OPENAI_CORE_ENABLED` | `false` (doc) / `true` no `.env` vivo — divergência F-26 a alinhar | **Master switch** do core novo; kill switch global |
| `BENTO_EXTERNAL_WRITE_ENABLED` | **`false`** | Mata F-01 por configuração: bento-qa externo vira somente leitura (Etapa 1, permanente) |
| `BENTO_CORE_ORGS` | vazio | **Canary por organização**: lista de org ids que usam o core como caminho único |
| `BENTO_SHADOW_MODE` | `false` | Executa core em paralelo com dry-run envelope (sem escrita) e registra divergências |
| `CLICKUP_MCP_WRITES_ENABLED` | `false` até F-03/F-06 fecharem | Liga escritas via MCP; desligado, o core usa só o gateway REST legado (reconcile-first) |

Todas as flags devem constar do `.env.example` (F-26) e do handoff de release.

## 11. Observabilidade

O diagnóstico não contém uma "lista FASE D.23" publicada; a lista abaixo é a **proposta desta ADR**, derivada diretamente das lacunas medidas na FASE B (F-16, item 13 do executive summary) e passa a valer como requisito da FASE D:

**Registro**:
- ExecutionRecord completo em todo caminho de escrita: operation, resourceIds, provider, verified, idempotency key, resultado do read-back.
- Trace estruturado ponta a ponta por `execution_id` (hoje ausente em 11/13 turnos de log): decisão de rota, decisão da policy (reason), provider selecionado, envelope, resposta ao usuário.
- Prompts e respostas do planner persistidos (ou hash + referência), `usage` de tokens real (hoje sempre 0).

**Métricas** (dashboard da FASE D):
- `bento_turns_total` por caminho (core/guard/externo) e por intent — meta: externo = 0 para escritas.
- `bento_fallback_external_writes_total` — **deve ser 0 permanentemente** (alarme se > 0).
- `bento_invariant_violations_total` (UPDATE→CREATE detectado por reconcile/auditoria) — meta 0.
- `bento_dedup_hits_total` e `bento_reconcile_first_hits_total` — eficácia da idempotência.
- `bento_shadow_divergence_rate` — divergência guard vs core durante shadow mode.
- `bento_planner_latency_ms` (p50/p95/p99) e `bento_turn_latency_ms`.
- `bento_mcp_failures_total` por causa (auth expirado, sem tool chamada, erro de tool, output sem id).
- `bento_oauth_downgrade_total` — fallback MCP→LEGACY (F-07), deve ser logado e contado.
- `bento_resource_state_lost_total` — execuções persistidas sem resourceId (F-08), meta 0.
- `execution_id_log_coverage` — % de turnos com trace completo, meta 100%.

## 12. Critérios de saída (exit criteria) da migração

A migração só é declarada concluída quando **todos** os itens estiverem PASS:

1. **INV-001..INV-008 PASS** — invariantes com harness executável já definidos no diagnóstico (seção 10): UPDATE nunca cria sem autorização; operação repetida não duplica; sucesso só após verificação; referência resolvida permanece correta na sessão; memória de Cliente A não contamina B; conhecimento antigo não sobrescreve recente; tool failure nunca apresentada como sucesso; fallback de escrita externo proibido.
2. **INV-009..INV-015 PASS** — o diagnóstico formaliza apenas INV-001..008; esta ADR **propõe** os sete seguintes, a ratificar na FASE D com harness próprio:
   - INV-009: create MCP nunca duplica em retry (reconcile-first ou idempotency key) — fecha F-03.
   - INV-010: todo caminho de escrita grava ExecutionRecord — fecha F-04.
   - INV-011: token OAuth MCP expirado nunca executa nem degrada silenciosamente — fecha F-06/F-07.
   - INV-012: nenhuma execução é persistida como sucesso sem resourceId — fecha F-08.
   - INV-013: leitura do resource state filtra `contextType` (estado nunca zerado por linha estrangeira) — fecha F-09.
   - INV-014: fast_path nunca captura verbo de ação sobre recurso em foco — fecha F-14.
   - INV-015: 100% dos turnos com escrita têm trace por `execution_id` — fecha F-16.
3. **Stateful 50 turnos PASS** — bateria stateful de 50 turnos (criação, update encadeado, referência indireta, ordinal, cross-turno) sem violação de invariante e sem perda de referência; hoje existem 13 turnos ao vivo + 21 testes de continuidade, a bateria de 50 é trabalho da FASE D/E.
4. **Adversarial PASS** — suíte adversarial (phrasings ambíguos, negação explícita, duplo clique, timeout pós-create, webhook duplicado, MCP disconnect) estendendo o fault-injection de 16 testes, sem escrita indevida.
5. **2 semanas de canary sem P0** — core como caminho único em canary por organização, com métricas da seção 11 dentro das metas.

---

## Referências

- `docs/audits/forensic-discovery-2026-09-25.md` — FASE A (mapa real, D-01..D-16)
- `docs/audits/forensic-diagnosis-2026-09-26.md` — FASE B (F-01..F-26, comparativo legacy vs core, proposta FASE C)
- `apps/worker/src/processors/execute-job.ts:1188-1235` — precedência core → guard
- `apps/worker/src/processors/bento-openai-core.ts` — core novo (null-abstains :97-99; envelope sem ExecutionRecord :46-61; ponte legada :109-131)
- `apps/worker/src/processors/bento-action-guard.ts:1245-1330` — portão 1 e `return null` → externo
- `apps/worker/src/processors/bento-mcp-executor.ts` — seleção de provider (:40-47), parse best-effort de task_id (:137-146), read-back só de existência (:148-156)
- `packages/bento-core/src/planner.ts` / `policy.ts` — planner sem tools; policy pura com `target_unresolved` (:62-69)
- `apps/worker/src/processors/bento-resource-state.ts:52` — load sem filtro `contextType` (F-09)
- `artifacts/fase-b-2026-09-25/` — bateria ao vivo T00–T12 + DUP1/DUP2
