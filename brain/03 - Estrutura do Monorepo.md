---
tags: [monorepo, estrutura, desigual-os]
---

# Estrutura do Monorepo

Fonte: prompt mestre, seção 5. pnpm workspaces + Turborepo. Local confirmado: `~/Downloads/Desigual OS` (a mesma pasta deste vault).

```
desigual-os/
├── apps/
│   ├── api/          # Orchestrator HTTP + WebSocket (Fastify)
│   ├── worker/        # Consumidores BullMQ
│   └── web/           # Frontend Next.js
├── packages/
│   ├── router/         # AI Router
│   ├── orchestrator/   # planejamento e coordenação
│   ├── context-engine/
│   ├── token-engine/
│   ├── tool-gateway/
│   ├── node-protocol/  # contrato compartilhado Orchestrator <-> Node
│   ├── auth/
│   ├── database/       # schema Drizzle + migrations + seeds
│   ├── logging/
│   └── types/
├── nodes/
│   ├── desigual-node/   # Node Agent para Mac Mini (Bento/Jarbas/Suzy)
│   └── studio-node/     # Node Agent para PC RTX 5090
├── database/
│   ├── migrations/
│   └── seeds/
├── infrastructure/
│   ├── docker/
│   ├── nginx/
│   ├── networking/
│   └── monitoring/
├── docs/
│   └── architecture/decisions/   # ADRs (espelha Decisoes/ deste vault)
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── .env.example
└── README.md
```

Estrutura criada na [[Fase 01 - Core e Database]] (`apps/api`, `packages/types`, `packages/logging`, `packages/database`) e ampliada na [[Fase 02 - Node Protocol e Node Agent base]] (`packages/node-protocol`, `nodes/desigual-node`, mais as rotas de node em `apps/api/src/nodes`). O resto (`apps/worker`, `apps/web`, `nodes/studio-node`, os demais `packages/`) segue como esqueleto de pastas para as fases seguintes. Ver status em [[99 - Pendencias]].
