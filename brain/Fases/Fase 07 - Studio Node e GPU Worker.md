---
tags: [fase, desigual-os]
fase: 7
status: concluida
---

# Fase 07 - Studio Node e GPU Worker

## Escopo

`POST /studio/jobs` (com RBAC, primeira rota de negócio a usar `requirePermission`, ver [[Fase 12 - Tool Gateway e RBAC]]), fila própria (`studio-jobs`, separada da `queue-studio` usada pelo chat), `nodes/studio-node` como worker BullMQ que consome direto da fila (não recebe HTTP como os outros nodes, arquitetura diferente de propósito: seção 7.3 do prompt mestre), upload real no Supabase Storage, progresso via WebSocket (`/ws` na API, propagado via Redis pub/sub porque o studio-node pode estar numa máquina diferente do processo que serve o WS).

## Definition of Done

Testado de ponta a ponta com infraestrutura real: `POST /studio/jobs` autenticado, job assíncrono processado pelo worker real, upload de verdade no bucket `studio-assets` do Supabase (URL pública confirmada com `curl`, HTTP 200), 4 eventos de progresso (`10 → 50 → 80 → 100`) recebidos ao vivo por um cliente WebSocket conectado em `/ws`, `GET /studio/jobs/:id` e `GET /studio/assets?client_id=` retornando os dados certos.

## Decisão: asset é stub de verdade, não GPU real

Sem runtime de GPU (ComfyUI) integrado ainda. Gera um SVG de verdade (arquivo válido, não um fake), marcado `stub: true` no metadata, pra nunca ser confundido com geração real. Ver ADR 0005.

## Arquivos criados

`nodes/studio-node/*` (config, generate, storage, worker), `packages/orchestrator/src/studio-queue.ts`, `packages/orchestrator/src/pubsub.ts`, `apps/api/src/studio/routes.ts`, `apps/api/src/ws/routes.ts`, bucket `studio-assets` criado no Supabase Storage (público).
