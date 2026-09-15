# 01 — Mapa de Execução Real (Bento e Otto)

Traçado por leitura do código, não por suposição. "Onde nasce a mensagem" até
"como o resultado volta ao usuário" (seção 6).

## Fluxo de um turno agêntico (AGENT_LOOP_V2)

```
usuário / menção @Bento no ClickUp
        │
        ▼
apps/api  (chat/routes.ts | integrations/clickup-sync.ts)
        │   auth, resolve conversa/cliente/usuário
        │   Bento: apps/api/src/lib/operational-context.ts
        │     └─ resolveOperationalScope → buildOperationalContext
        │        └─ tool-gateway.queryOperationTasks (ClickUp AO VIVO)
        │           → injeta bloco "ao vivo, consultado agora" na mensagem
        ▼
orchestrator/dispatch → fila BullMQ (AgentJobData)
        │
        ▼
apps/worker/processors/agentic-dispatch.ts  ← runtime vive aqui
        │  classifyTask → taskClass (teto de iterações)
        │  runAgentLoop(hooks):
        │    understand → goalFor(agent) + successCriteriaFor(agent)
        │    gatherContext → recallMemories(episódios do agente + prefs do user)
        │    plan → [FIXO hoje]
        │    act(attempt) → callAgent(message)  ─────────────┐
        │       estratégia 1: mensagem completa              │
        │       estratégia 2: sem blocos de contexto         │
        │    observe → grava observação real                 │
        │    evaluate → evaluatorFor(agent) determinístico   │
        │    pass? → finalize;  fail+recoverable? → replan   │
        │  checkpoint por fase (agent_execution_states)      │
        │  outcome final (agent_outcomes) + episódio memória │
        ▼                                                    ▼
resposta (ExecuteResponse)                       nodes/desigual-node (Bento/Jarbas)
  + metadata.agentic (task_class,                  openclaw client (LLM) + obsidian
    iterations, strategies, score, phase)        nodes/otto-node (Otto)
        │                                          LLM local, brain próprio
        ▼
web (streaming) / comentário de volta no ClickUp
```

## Bento — o que é real hoje
- Recuperação operacional REAL (ClickUp ao vivo, escopo+timezone, membro por nome).
- Anti-alucinação: falha de ferramenta vira aviso honesto, nunca número inventado.
- Resposta fundamentada verificada pelo evaluator (resposta curta reprova).
- Menção @Bento no ClickUp recebe o mesmo dado ao vivo (commit 4be34c4).
- Memória de cliente escopada + episódios do próprio agente.
- FALTA: OperationalState consolidado, risk/priority-engine, next-best-action,
  verificação read-back de escrita (criar task → reler → conferir campos, seção 32).

## Otto — o que é real hoje
- Node dedicado (otto-node, 1.7k LOC) com LLM local e brain próprio (`Brain-Marketing/`),
  timings de fase medidos (classify_ms/retrieval_ms/llm_ms) propagados no metadata.
- Passa pelo mesmo runtime (objetivo/critério/evaluator/replan/outcome).
- Existe também o "Otto skill" (diretor criativo do Claude Code) — sistema SEPARADO,
  com brains de cliente em `.claude/skills/otto/` (ver CLAUDE.md: não confundir os dois).
- FALTA no runtime: CreativeState com histórico aprovado/rejeitado, research externo
  multi-fonte, avaliador criativo (fit de marca/anti-genérico) e self-revision como
  estágios de 1a classe (seções 65-77).

## Jarbas e Suzy
- Jarbas: passa pelo runtime, evaluator próprio exige dado numérico OU declaração de
  limitação. Funciona — NÃO mexer (seção 89).
- Suzy: compatível com o runtime; migração completa (Contact/Conversation State,
  next-best-action) fica para depois (seção 90).
