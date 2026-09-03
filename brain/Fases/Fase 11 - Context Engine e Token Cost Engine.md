---
tags: [fase, desigual-os]
fase: 11
status: concluida
---

# Fase 11 - Context Engine + Token & Cost Engine

## Escopo

Contexto mínimo por execução (nunca o Obsidian inteiro), estimativa e medição de tokens, economia por agente/usuário/cliente, custos do [[Studio]].

## O que já está pronto (Token & Cost Engine)

`packages/token-engine` (tabela de preço por milhão de tokens) + `packages/orchestrator/src/cost-service.ts` (`recordCostEvent` grava uma linha em `cost_records` por chamada de agente, `finalizeExecutionCost` soma e atualiza `executions.actual_cost`). Wireado no worker: single agent grava e finaliza na hora, workflow grava uma linha por etapa (atribuída ao agente certo daquela etapa) e finaliza só no fim. `GET /costs/overview`, `/costs/by-agent`, `/costs/by-client`, `/costs/by-user` na API.

Testado de ponta a ponta com dado real: execution real gerou tokens reais (10 input / 20 output do node fake), custo calculado bateu exatamente com a tabela de preço ($0.00033 = 10×$3/M + 20×$15/M), refletido corretamente em `/costs/overview` e `/costs/by-agent`.

## Limitação conhecida (herdada da Fase 04)

Custo é aproximado, não exato: o Node ainda não devolve qual modelo o OpenClaw usou de verdade, então todo cálculo cai no preço padrão (`unknown`, nível Sonnet) em `packages/token-engine/src/pricing.ts`. Corrigir isso depende de confirmar o schema real de saída do `openclaw agent --json` numa execução de verdade (ver [[Fase 04 - Bento Node]]).

## Context Engine (concluído)

`packages/context-engine`: monta o recorte mínimo (User Context, Client Context incluindo tom de voz do brand kit, Conversation Context com as últimas 5 mensagens) e injeta como um bloco de texto curto no final da mensagem antes de despachar. `POST /chat` agora participa da cadeia completa da seção 6.3 (User → Conversation → Execution): cria ou continua uma `conversation`, grava a mensagem do usuário, e o worker grava a resposta do agente como mensagem também (só a resposta final no caso de workflow, não cada etapa intermediária). Novo: `GET /conversations` e `GET /conversations/:id/messages`.

Testado de ponta a ponta: duas mensagens na mesma conversa, cliente com tom de voz cadastrado, confirmei o contexto (nome do cliente, tom de voz) chegando de verdade na mensagem que o Node recebeu, e as 4 mensagens (2 do usuário, 2 do agente) gravadas na ordem certa.

## O que falta

- **Economy records** (economia estimado vs real, `economy_records`): não implementado. Não existe ainda uma etapa de estimativa de custo ANTES da execução pra comparar com o real depois.
- Custo do [[Studio]] (`gpu_time`, diferente de custo de tokens): `studio_jobs` já tem as colunas (`estimated_cost`, `actual_cost`, `gpu_time_ms`), mas nada preenche ainda.
- Agent Knowledge / Memory / Assets (seção 6.4) não entram no contexto ainda: hoje só client/conversation. Memory (`memories`) e Assets ainda não são lidos por nada.

## Arquivos criados

`packages/token-engine/*`, `packages/orchestrator/src/cost-service.ts`, `apps/api/src/costs/routes.ts`, `packages/context-engine/*`, `apps/api/src/conversations/routes.ts`, mudanças em `apps/api/src/chat/routes.ts` e `apps/worker/src/processors/execute-job.ts` pra fechar o ciclo de conversa.
