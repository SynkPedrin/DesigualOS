---
tags: [adr, decisoes, desigual-os]
---

# Decisões de Arquitetura (ADRs)

Índice da pasta `Decisoes/`. Espelha `docs/architecture/decisions/` do monorepo assim que ele existir (o monorepo em si ainda não foi criado, ver [[99 - Pendencias]]). Formato de cada ADR: contexto, decisão, consequência.

## ADRs registrados

- [[0001 - Supabase Completo]]: Postgres, Auth e Storage do Orchestrator passam a ser o Supabase gerenciado, em vez de self-hosted (Docker Postgres + JWT custom + MinIO).
- [[0002 - Module Resolution Bundler]]: monorepo inteiro em `moduleResolution: "Bundler"`, sem extensão `.js` em imports relativos, pra compatibilizar com o `drizzle-kit`.
