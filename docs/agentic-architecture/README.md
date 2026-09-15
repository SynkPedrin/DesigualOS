# Agentic Architecture — Auditoria e Plano de Evolução

Documentos desta pasta refletem o CÓDIGO REAL do repositório, verificado em
15/09/2026 por leitura direta dos arquivos e `typecheck` das packages centrais.
Nada aqui é especulativo: cada classificação aponta o arquivo que a sustenta.

## Índice

| Doc | Estado |
|-----|--------|
| `00-current-state-audit.md` | Escrito — foto do sistema hoje |
| `01-current-agent-map.md`   | Escrito — como Bento e Otto executam de fato |
| `02-gap-matrix-and-scorecard.md` | Escrito — matriz de capacidades + scorecard justificado |
| `03-migration-roadmap.md`   | Escrito — fases priorizadas com definition-of-done |
| `04-19` (runtime, retrieval, evidence, memory, events, observability, evals...) | A escrever conforme cada fase for atacada |

## Metodologia da auditoria

Regra aplicada em todo o documento (seção 7 do prompt mestre): uma capacidade
NÃO conta como existente só porque há uma função ou arquivo com o nome dela.
Cada item foi verificado lendo a implementação. Classificação usada:
`GOOD` / `NEEDS_EVOLUTION` / `BROKEN` / `MISSING` / `DUPLICATED` / `DEPRECATED`.

## Blocker de verificação registrado (seção 144)

Os testes (`vitest`) NÃO puderam ser executados no ambiente desta auditoria:
o `node_modules` montado foi instalado no macOS (binários nativos arm64 de
`rollup`/`esbuild`), e o shell da auditoria roda em Linux, então o vitest falha
com `MODULE_NOT_FOUND` no binário nativo do rollup. Isto é limitação de
ambiente, não defeito de código. O que FOI verificado: `tsc --noEmit` passou
limpo (exit 0) em `types`, `agent-runtime`, `context-engine`, `tool-gateway`,
`orchestrator` e `router`. Os testes existem e são reais (lidos arquivo a
arquivo); a execução deve ser feita na máquina onde o repo foi instalado
(`pnpm test` / `pnpm --filter <pkg> test`).
