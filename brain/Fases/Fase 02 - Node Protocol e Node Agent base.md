---
tags: [fase, desigual-os]
fase: 2
status: concluida
---

# Fase 02 - Node Protocol e Node Agent base

## Escopo

Package `node-protocol` (contratos e tipos), `desigual-node` genérico com `/health`, `/status`, `/capabilities`, heartbeat e coletor de métricas. Autenticação NODE_ID/NODE_SECRET. Também entrou uma versão simples de `POST /nodes/register`, `POST /nodes/:node_id/heartbeat` e `GET /nodes` no Orchestrator, porque o DoD desta fase exige um node aparecendo em `GET /nodes` (a versão completa, com máquina de estados de saúde e circuit breaker, é da [[Fase 03 - Node Registry, Discovery e Health]]).

## Definition of Done

Validado de ponta a ponta nesta máquina: subi a API, subi um node fake (`NODE_BENTO_TEST_01`, agente bento), ele se registrou, mandou heartbeat a cada 10s, e apareceu em `GET /nodes` com status `online` e `last_heartbeat_at` avançando a cada ciclo. Confirmado também direto no Postgres: linha em `nodes`, 4 em `node_capabilities`, heartbeats acumulando em `health_checks`. Autenticação testada: secret errado ou ausente devolve 401.

## Decisões

- Sem "token de sessão" fictício no registro (o prompt mestre, seção 6.1, menciona um, mas nada o validaria de fato no MVP). A autenticação real é o `NODE_SECRET` compartilhado em todo request node → Orchestrator, como a seção 10 já previa para o MVP.
- `GET /nodes` nesta fase é cru: mostra o `status` que o próprio node reportou. Não há ainda downgrade automático pra `warning`/`degraded`/`offline` por heartbeat atrasado, nem circuit breaker; isso é [[Fase 03 - Node Registry, Discovery e Health]].
- `openclaw/` e `obsidian/` continuam vazios; a integração real é por agente, a partir da [[Fase 04 - Bento Node]].

## Limitação conhecida

A métrica de RAM usa `os.freemem()/os.totalmem()` e no macOS isso fica sempre perto de 100%, porque o macOS usa memória livre agressivamente como cache de disco (confirmado comparando com `vm_stat`: "Pages free" fica na casa de dezenas de MB mesmo com memória disponível de verdade). Não é bug do código, é a métrica errada pra macOS. Vale revisitar quando o dashboard de infraestrutura ([[Fase 03 - Node Registry, Discovery e Health]] ou [[Fase 15 - Security Hardening]]) depender de precisão real de memória.

## Arquivos criados

`packages/node-protocol/*` (schemas Zod de register/heartbeat/status), `nodes/desigual-node/*` (config, server, metrics, heartbeat, security, register, entrypoint), `apps/api/src/nodes/*` (auth do node, rotas register/heartbeat/GET nodes), `nodes/desigual-node/.env.example`.
