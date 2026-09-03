---
tags: [fase, desigual-os]
fase: 1
status: concluida
---

# Fase 01 - Core e Database

## Escopo

Monorepo, docker-compose (Redis; Postgres/Auth/Storage agora vêm do Supabase, ver [[0001 - Supabase Completo]]), schema Drizzle com todas as tabelas de [[05 - Modelo de Dados]], migrations, seeds mínimos, packages `types` e `logging`.

## Definition of Done

- `docker-compose up` sobe Redis
- `pnpm db:generate`, `pnpm db:migrate` e `pnpm db:seed` rodam contra o Postgres do Supabase
- Healthcheck da API responde

## Status

DoD 100% verde, validado de ponta a ponta nesta máquina (não só escrito, executado de verdade):

- `pnpm install` ✓ (Node v24.20.0 e pnpm 9.9.0 instalados localmente em `~/.local/toolchain`, sem Homebrew, ver nota abaixo)
- `docker compose up` ✓ sobe o Redis (porta ajustada via `REDIS_HOST_PORT`, ver nota abaixo)
- `pnpm db:generate` ✓ gerou `database/migrations/0000_marvelous_shocker.sql` (45 tabelas)
- `pnpm db:migrate` ✓ aplicado no Postgres real do Supabase
- `pnpm db:seed` ✓ confirmado por query direta: 4 agentes, 2 papéis, 17 linhas em `agent_tools`
- `pnpm turbo run lint typecheck` ✓ limpo nos 4 packages (api, database, logging, types)
- `GET /health` ✓ respondeu `200 {"status":"ok",...}` com o servidor rodando de verdade

### Bugs reais encontrados e corrigidos ao validar (não apareceriam só lendo o código)

1. **Ambiente sem Node/pnpm/Docker no PATH padrão desta sessão**: Node e pnpm instalados localmente via tarball oficial (sem sudo/Homebrew) em `~/.local/toolchain`; PATH também adicionado ao `~/.zshrc` do usuário. O `docker` do `/usr/local/bin` era um symlink quebrado (apontava pra `/Volumes/Docker`, não montado); o binário real está em `/Applications/Docker.app/Contents/Resources/bin/docker` e fala normalmente com o socket em `~/.docker/run/docker.sock`.
2. **Conflito de porta**: já havia containers de outro projeto (`orvyn-*`) usando as portas 6379 e 5432 nesta máquina. `docker-compose.yml` agora usa `${REDIS_HOST_PORT:-6379}` (default normal pra outros devs, ajustável via `.env` sem tocar no arquivo versionado).
3. **`drizzle-kit generate` falhava** (`Cannot find module './enums.js'`): o carregador de schema do drizzle-kit 0.24 resolve imports relativos via `require()` puro, sem o mapeamento `.js` → `.ts` que o `tsx`/Node ESM fazem. Solução: `packages/database` e `packages/types` passaram a usar `moduleResolution: "Bundler"` e imports relativos sem extensão (os outros packages, que não entram na cadeia do drizzle-kit, mantiveram `NodeNext` com `.js`).
4. **`unique().on(...)` em array não tipava** no drizzle-orm 0.33 (`(table) => [unique()...]`): essa forma só existe em versões mais novas. Trocado pra forma de objeto (`(table) => ({ nomeUnique: unique()... })`), compatível com a versão instalada.
5. **`Fastify({ loggerInstance: logger })` não existe no Fastify 4.29**: removido; a API configura o logger nativo do Fastify direto (pino via `logger: {...}`), e `createLogger` de `packages/logging` fica só pros logs de aplicação fora do ciclo de request.
6. **`exactOptionalPropertyTypes: true` rejeitava `transport: undefined` explícito** (tanto em `packages/logging` quanto no server): trocado por branch condicional que só inclui a chave `transport` quando ela de fato existe, em vez de atribuir `undefined`.
7. **Faltava `@types/node`** em `apps/api`, `packages/logging` e `packages/database` (pnpm não hoisteia automaticamente pra dentro de cada package): adicionado explicitamente em cada um.

### Instalação local (fora do monorepo, específico desta máquina)

Node e pnpm ficaram em `~/.local/toolchain/node` porque não havia Homebrew instalado. Isso não faz parte do repositório, é só desta máquina.

## Arquivos criados

`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.prettierrc.json`, `eslint.config.js`, `.env.example`, `.env`, `README.md`, `docker-compose.yml`, `packages/types/*`, `packages/logging/*`, `packages/database/*` (schema, client, migrate, seed), `apps/api/*`, `docs/architecture/decisions/0001-supabase-completo.md`.
