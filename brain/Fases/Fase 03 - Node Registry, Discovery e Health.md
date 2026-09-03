---
tags: [fase, desigual-os]
fase: 3
status: concluida
---

# Fase 03 - Node Registry, Discovery e Health

## Escopo

Sweep de saúde (warning 10s, degraded 30s, offline 60s) rodando a cada 5s dentro do próprio processo da API (sem BullMQ ainda, isso é Fase 9), `GET /health/infrastructure`, `GET /nodes/:node_id` com métricas mais recentes, `POST /nodes/:node_id/command` (maintenance/resume) e discovery (`findHealthyNodeForAgent`) que o Router (Fase 8) vai consumir.

## Definition of Done

Validado em tempo real, sem atalho: registrei um node, deixei ele em silêncio (sem heartbeat) e confirmei a progressão exata online → warning (~12s) → degraded (~32s) → offline (~65s, dentro da janela de 60s + granularidade do sweep de 5s). `GET /health/infrastructure` reflete o resumo por status. `POST /command` testado (maintenance tira da rotação, resume volta). `findHealthyNodeForAgent('bento')` retornou `null` com o node em warning e o node de verdade assim que voltou a mandar heartbeat.

## Decisão: o que é o "circuit breaker" aqui

O prompt mestre menciona circuit breaker tanto na seção 6.1 (discovery) quanto na 6.7 (filas), sem separar claramente o que cabe a cada fase. Interpretação adotada: a própria máquina de estados de saúde baseada em heartbeat (se o node não fala há N segundos, cai de severidade) já cumpre o papel de circuit breaker pro discovery, porque `findHealthyNodeForAgent` só considera `status = 'online'`. Um segundo tipo de breaker, que conta falhas de chamadas de verdade (timeout, erro do agente), só faz sentido a partir da Fase 9, que é onde chamadas de verdade passam a existir. Não construí esse segundo breaker agora pra não ser abstração sem chamador.

## Bug real encontrado

`NODE_STATUSES` em `packages/types` estava faltando o valor `'warning'` desde a Fase 1 (só tinha online/busy/degraded/offline/maintenance/rendering). Só apareceu ao tentar usar o enum na Fase 3. Corrigido, e gerei uma migration nova (`ALTER TYPE node_status ADD VALUE 'warning'`) aplicada no Supabase.

## Arquivos criados

`apps/api/src/health/thresholds.ts`, `apps/api/src/health/scheduler.ts`, `apps/api/src/health/routes.ts`, `apps/api/src/nodes/discovery.ts`, mais o endpoint de comando em `apps/api/src/nodes/routes.ts` e o registro do sweep em `apps/api/src/server.ts`.
