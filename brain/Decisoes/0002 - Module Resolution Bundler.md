---
tags: [adr, typescript, desigual-os]
adr: 2
status: aceito
data: 2026-09-01
---

# ADR 0002: moduleResolution "Bundler" no monorepo inteiro

Espelho de `docs/architecture/decisions/0002-module-resolution-bundler.md`. Editar os dois em conjunto.

## Contexto

`tsconfig.base.json` começou em `NodeNext` (exige `.js` em imports relativos mesmo apontando pra `.ts`). O `drizzle-kit` (usado em `db:generate`, ver [[Fase 01 - Core e Database]]) carrega o schema via `require()` CJS puro e não entende essa convenção, quebrando com `Cannot find module './enums.js'`.

Tentei consertar só `packages/database` e `packages/types`, mas `moduleResolution` é configuração de programa inteiro no `tsc`, não por pacote: assim que um pacote em NodeNext (`apps/api`, `packages/node-protocol`, `nodes/desigual-node`) importa algo desses dois, o `.ts` de origem é checado com as regras do consumidor.

## Decisão

Monorepo inteiro em `module: "ESNext"` + `moduleResolution: "Bundler"`. Imports relativos sem extensão em todo lugar, daqui pra frente.

## Consequência

- `tsx` (usado em dev e nos scripts de banco) já resolve isso nativamente, sem mudança de comportamento no dia a dia.
- Os scripts `build` (`tsc` puro) de cada pacote ainda não foram testados de verdade. `moduleResolution: "Bundler"` não garante que o `.js` emitido rode direto no Node (ESM nativo exige extensão). Provável que a [[Fase 17 - Production Deployment]] precise de um bundler de verdade (esbuild/tsup) em vez de `tsc` puro pro build de produção.
