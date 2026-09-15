# 02 — Matriz de Gaps e Scorecard

Verificação: cada linha foi confirmada lendo a implementação (seção 7). "Existe"
significa que funciona, não que há um arquivo com o nome.

> **Atualização 15/09/2026 (sprint A→B→C→D):** notas de Evidence, Tool Reliability,
> Bento Ops, Otto e Evaluator revisadas após a implementação das quatro frentes.
> Ver `implementation-ledger.md` para o que foi feito e verificado em cada uma.

## Matriz de capacidades (seção 7)

| Capacidade | Estado | Evidência / Falta |
|---|---|---|
| multi-step reasoning | PARCIAL | loop com fases existe; mas `act` é single-shot ao node, sem tool-loop interno de múltiplos passos |
| persistent agent state | SIM | `agent_execution_states`, checkpoint por fase |
| planning | NÃO | hook `plan` retorna array fixo; sem plano adaptativo (seção 14) |
| adaptive replanning | PARCIAL | replan existe e proíbe repetir estratégia; mas só há 2 estratégias (completa / sem-contexto) |
| real-time retrieval | SIM | ClickUp ao vivo via tool-gateway, injetado com marca temporal |
| semantic retrieval | PARCIAL | fora do repo (bento-qa); dentro do repo memória é por escopo/kind, sem embedding |
| keyword retrieval | SIM | busca + filtros no context-engine/tool-gateway |
| reranking | NÃO | ausente |
| evidence (1a classe) | NÃO | sem tabela `evidence`, sem linkage CLAIM→EVIDENCE (seções 24-26) |
| tool verification (read-back) | NÃO | criar/editar não relê para conferir campos (seção 32) |
| retry | SIM | política no loop, recoverable flag, corte de estratégia repetida |
| idempotency | PARCIAL | `execution-id` + onConflict; sem idempotencyKey por operação de tool (seção 33) |
| memory | SIM | dedup/supersessão/escopo/confiança/expiração (memory-engine) |
| memory consolidation | PARCIAL | supersessão por subject sim; consolidação semântica não (sem LLM por escrita) |
| client-scoped memory | SIM | escopo clientId/agentId/userId aplicado na recuperação |
| event handling | PARCIAL | webhook + event-store + queues; sem `OperationalEvent` normalizado |
| background execution | SIM | BullMQ workers, scheduler (daily-digest) |
| evaluation | SIM | evaluator determinístico + por agente; controla entrega |
| observability | PARCIAL | outcomes + checkpoints + system_events + logging; sem trace por-step com timings de retrieval/tool no store (seção 80) |
| human approval | SIM | tool-gateway requiresApproval → notifica masters → approve |
| permissions | SIM | matriz agent_tools, nega por omissão; hasClientAccess (hoje aberto por decisão de produto) |
| cost control | PARCIAL | token-engine/pricing + limites de iteração; sem maxTokens/maxCost por run aplicado |
| loop control | SIM | MAX_ITERATIONS por classe + guard de estratégia repetida |

## Scorecard (seção 143) — notas justificadas, não infladas

| Eixo | Nota | Justificativa |
|---|---|---|
| Agent Runtime | 8/10 | state machine real, limites, replan honesto, checkpoints. **(Frente E)** planner adaptativo implementado; falta tool-loop multi-passo DENTRO do `act` (hoje o multi-tool do Bento vive no action-guard). |
| Context Engineering | 7/10 | escopo/temporal/cliente/operacional reais, precedência ao-vivo>memória. Falta budget/freshness explícitos como camada. |
| Retrieval | 5/10 | ClickUp ao vivo forte; memória sem embedding; sem reranking; semântico fora do repo. |
| Evidence Grounding | 6/10 | **(Frente A)** entidade Evidence de 1a classe + tabela `agent_evidence` + gate de grounding no evaluator (turno factual sem evidência reprova). Falta claim-grounding semântico por-item (§26). |
| Tool Reliability | 8/10 | **(Frente B)** read-back real nas 4 escritas do Bento (relê e confere nome/responsável/prazo/status) + idempotência no create (não duplica). Falta schema Zod por tool. |
| Memory | 7/10 | pipeline real e escopado. Falta consolidação semântica e recuperação por similaridade. |
| Bento Operations Intelligence | 7/10 | **(Frente C)** priority-engine transparente com motivo + next-best-action por risco, disparados por intents de priorização/análise. Falta dependência entre tarefas e OperationalState estruturado até o worker. |
| Otto Creative Intelligence | 6/10 | **(Frente D)** porta determinística anti-genérico (§74) no evaluator do runtime dispara auto-revisão; CreativeState, memória criativa por cliente e feedback-learning já existiam no node. Falta research externo multi-fonte como estágio. |
| Evaluator | 8/10 | **(Frentes A+D)** ganhou eixo de grounding factual e porta criativa determinística. Falta grounding semântico por-claim. |
| Observability | 5/10 | outcomes+checkpoints+eventos. Falta trace por-step inspecionável com timings de retrieval/tool. |
| Security | 7/10 | isolamento por escopo, matriz de permissão nega-por-omissão, approval de master. hasClientAccess aberto (decisão de produto documentada). |
| Performance | 6/10 | checkpoints fire-and-forget, fast/deep path, paralelismo no gatherContext. Falta cache com TTL e budgets aplicados. |

**Leitura geral**: a FUNDAÇÃO (runtime, memória, permissão, evaluator, outcomes,
retrieval operacional ao vivo) é real e boa. O salto de qualidade pendente está em
quatro frentes: (1) Evidence layer + grounding factual, (2) planner adaptativo e
tool-loop multi-passo com read-back, (3) OperationalState do Bento (risco/prioridade/
próxima ação), (4) CreativeState do Otto (research + avaliação criativa + self-revision).
