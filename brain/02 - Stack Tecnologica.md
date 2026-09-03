---
tags: [stack, desigual-os]
---

# Stack Tecnológica Obrigatória

Fonte: prompt mestre, seção 4. Não introduzir dependência fora desta lista sem justificar em [[Decisoes|ADR]].

## Orchestrator (servidor central)

- Node.js LTS + TypeScript (strict)
- Fastify (API HTTP)
- WebSocket (ws) para streaming e eventos
- BullMQ + Redis (filas e jobs)
- PostgreSQL via Drizzle ORM (migrations versionadas), hospedado no Supabase (ver [[0001 - Supabase Completo]])
- Zod (validação de schemas)
- Pino (logs estruturados JSON)
- Storage: Supabase Storage (substitui o MinIO/S3 self-hosted do plano original, ver [[0001 - Supabase Completo]])
- Auth: Supabase Auth (substitui o JWT custom do plano original; RBAC continua custom, ver [[0001 - Supabase Completo]])

## Node Agent (Macs e PC RTX)

- Node.js + TypeScript
- Fastify (endpoints locais) + WebSocket client
- Integração com OpenClaw (Macs) e GPU runtime / ComfyUI (RTX)
- Coletor de métricas de sistema

## Frontend (Desigual OS)

- Next.js (App Router) + React + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query + Zustand
- WebSocket client

## Infra

- Docker + docker-compose
- Tailscale (malha privada)
- Nginx (reverse proxy / TLS)
- Secret Manager (dev: env vars, prod: Vault)

Ver também [[03 - Estrutura do Monorepo]] e [[07 - Design System]].
