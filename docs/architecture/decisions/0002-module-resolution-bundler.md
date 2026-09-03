# ADR 0002: moduleResolution "Bundler" no monorepo inteiro, sem extensão em imports relativos

## Contexto

O `tsconfig.base.json` começou com `module`/`moduleResolution: "NodeNext"`, que exige extensão `.js` em todo import relativo (`from './foo.js'`) mesmo apontando pra um arquivo `.ts`, seguindo a regra de ESM nativo do Node. Ao rodar `pnpm db:generate` na Fase 2, o `drizzle-kit` (que carrega o schema via `require()` puro em CJS, sem o mapeamento `.js` → `.ts` que `tsx` faz) quebrou com `Cannot find module './enums.js'`.

A correção inicial foi trocar só `packages/database` e `packages/types` para `moduleResolution: "Bundler"` (sem extensão). Isso quebrou de novo assim que outro pacote em NodeNext (`apps/api`, `packages/node-protocol`, `nodes/desigual-node`) importou algo desses pacotes: `moduleResolution` é uma configuração de programa inteiro no `tsc`, não por pacote, então o arquivo `.ts` importado passa a ser checado com as regras do consumidor, não as do pacote de origem.

## Decisão

`tsconfig.base.json` usa `module: "ESNext"` e `moduleResolution: "Bundler"` para o monorepo inteiro. Todo import relativo entre arquivos `.ts` é escrito sem extensão (`from './foo'`, não `from './foo.js'`). Isso elimina a inconsistência entre pacotes e evita o problema resolvido caso a caso.

`tsx` (usado em todo `dev`/`db:migrate`/`db:seed`) já resolve imports sem extensão nativamente, então nada muda em tempo de execução no dia a dia.

## Consequência

- Import relativo sem extensão em todo código novo do monorepo, daqui pra frente.
- Os scripts `build` (`tsc`) de cada pacote ainda não foram exercitados de verdade: `moduleResolution: "Bundler"` não garante que o `.js` emitido rode direto no Node (que exige extensão em ESM nativo). Isso é um problema real só na hora de empacotar pra produção, que é escopo da Fase 17 (Production Deployment): o build de produção provavelmente precisa de um bundler de verdade, tipo esbuild/tsup, em vez de `tsc` puro. Registrado aqui pra não esquecer.
