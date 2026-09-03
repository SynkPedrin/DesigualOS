---
tags: [fase, desigual-os]
fase: 9
status: concluida
---

# Fase 09 - Queue e Orchestrator (single agent)

## Escopo

`POST /chat` real: Router (Fase 08) decide o agente, circuit breaker checa node saudável (Fase 03), grava `executions`/`router_decisions`, enfileira no BullMQ (`packages/orchestrator`), `apps/worker` consome, chama `POST /execute` do node de verdade, grava tokens/status/`audit_logs`. `GET /executions` e `GET /executions/:id` (com RBAC: colaborador só vê o próprio, master vê tudo).

## Definition of Done

Testado de ponta a ponta com dado real, não simulado: usuário real (criado via Supabase Admin API) chamou `POST /chat` com "Qual é o processo de onboarding do cliente Z?", o Router classificou certo (`knowledge_query` → bento → P3), a execution foi criada e enfileirada, o worker processou (2 tentativas, conforme `MAX_ATTEMPTS`), despachou pro node real, que chamou o OpenClaw real e falhou do jeito esperado (agent id de teste inexistente). `GET /executions/:id` mostrou o status final `failed` com timestamps corretos. `audit_logs` recebeu as duas tentativas.

## Bug real encontrado

BullMQ rejeita `:` em nome de fila (`Error: Queue name cannot contain :`), mas o prompt mestre nomeia as filas `queue:bento` etc. Troquei pra `queue-bento` (hífen), mesma intenção. Só descobri rodando o worker de verdade.

## Decisões

- Timeout por agente (seção 6.7) é imposto pelo worker via `AbortSignal.timeout()` na chamada HTTP pro node, não é uma feature nativa do BullMQ.
- `execution_id` (`EXE-2026-NNNNNN`) não é sequencial de verdade, usa os últimos dígitos do timestamp; evita condição de corrida de um contador no banco. Documentado em `packages/orchestrator/src/execution-id.ts`.
- Convenção de porta: Node Agents genéricos escutam na 4001 por padrão; `private_host` pode incluir a porta explicitamente (`host:porta`) pra permitir testar vários nodes fake na mesma máquina em dev. Em produção, cada agente é uma máquina física separada, então a porta fixa não colide.
- `estimated_cost`/`actual_cost` ficam nulos por enquanto: cálculo de custo de verdade é a [[Fase 11 - Context Engine e Token Cost Engine]].

## Arquivos criados

`packages/orchestrator/*` (discovery movido da Fase 03, queues, execution-id, chat-service), `apps/worker/*` (processor, entrypoint), `apps/api/src/chat/routes.ts`, `apps/api/src/executions/routes.ts`.
