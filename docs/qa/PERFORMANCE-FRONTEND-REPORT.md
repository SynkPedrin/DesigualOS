# RELATÓRIO — AUDITORIA TOTAL DE PERFORMANCE + FRONTEND (2026-09-12)

Método: build de PRODUÇÃO (`next build` + `next start`), medido com Playwright/Chromium real (login real, credenciais QA), vitals via Performance API, network capturada por rota. Nada é estimativa: cada número abaixo veio de uma medição (scripts em /tmp/desigual-qa-ui/, relatórios JSON perf-*.json).

## BASELINE (antes)

| Métrica | Valor |
|---|---|
| FCP por rota (prod, cache quente) | 248–528ms |
| Navegação SPA (clique na sidebar) | 53–63ms |
| Chat: envio → balão na tela | 54ms (optimistic OK) |
| Chat: envio → indicador de atividade | 59ms |
| Chat: envio → resposta real (Jarbas, Meta Ads) | ~17–25s (latência real da máquina) |
| JS transferido por rota | 231–682KB (fabric/echarts fora do caminho inicial, lazy) |
| Requests 401 por carga de página | 1 (`/me` disparado sem token em TODA rota; 9 no sweep) |
| GET /conversations na página /messages | 5 (1 base + 1 por agente, cada uma com scan completo em messages) |
| GET /health/infrastructure por página | 2 |
| Galeria Studio | **43 imagens, ~80MB por carga** (originais Flux de 1.8–17MB como thumbnail) |
| Tema no primeiro paint | tema errado até /me resolver (flash claro → dark) |
| loading.tsx de rota | nenhum |

## GARGALOS ENCONTRADOS (problema → causa → impacto)

1. **Galeria baixava 80MB** → assets servidos como original full-res direto do Supabase Storage, sem thumbnail → P1, a pior lentidão percebida do sistema.
2. **401 /me em toda rota** → efeitos de filhos rodam antes dos pais: queries disparavam antes do `wireSupabaseAccessToken()` (useEffect no provider) → roundtrip desperdiçado + erro de console em toda navegação.
3. **5× /conversations em /messages** → `AgentRow` chamava `useConversations(agent)` por agente (4 filtros server-side com selectDistinct full-scan) → ~3.3s de backend desperdiçado por carga.
4. **2× /health/infrastructure** → query com staleTime 0 remontada por sidebar+spotlight em sequência.
5. **Flash de tema** → `data-theme` aplicado só em useEffect pós-hidratação.
6. **Studio modal/media sem lazy** → imagens fora da tela baixadas na abertura.
7. Sem gargalo estrutural novo no bundle: fabric (684KB), echarts (420KB) e supabase (232KB) já carregam lazy/fora do first paint. Não mexido.

## ALTERAÇÕES IMPLEMENTADAS

Backend:
- `packages/database`: migration 0026 — `studio_assets.thumb_url`.
- `packages/orchestrator/src/thumbnail-queue.ts` (novo): fila BullMQ `studio-thumbnails`, jobId=assetId (idempotente).
- `apps/worker/src/processors/generate-thumbnail.ts` (novo): sharp 480px webp q70, upload `thumbs/`, update no banco; backfill no boot (500 mais novos). `apps/worker/src/index.ts`: worker registrado (concurrency 2) + dreno no shutdown.
- `apps/api/src/studio/routes.ts`: GET /studio/assets retorna `thumb_url` e enfileira (fire-and-forget) os que faltam.
- `apps/api/src/conversations/routes.ts`: resposta inclui `agents` por conversa (1 query DISTINCT ON agrupada substitui 4 scans).

Frontend:
- `lib/supabase/client.ts` + `lib/api/client.ts`: provider assíncrono de token com teto de 2s + wiring em escopo de módulo (fim da corrida do 401).
- `hooks/use-infrastructure-health.ts`: staleTime 10s (poll de 15s segue).
- `components/messages/messages-sidebar.tsx`: `AgentRow` deriva "última conversa do agente" da lista base compartilhada.
- `lib/api/contracts.ts`: `thumb_url`/`thumbUrl` + `agents` nos contratos.
- `components/studio/asset-lightbox.tsx`: `AssetPreview` com variant thumb/full (lazy+async na grade, original no lightbox).
- `app/layout.tsx` + `app/theme-provider.tsx`: script inline aplica o tema cacheado antes do primeiro paint; provider grava o cache.
- `app/(shell)/loading.tsx` (novo): placeholder no tamanho do conteúdo (sem spinner gigante, sem layout shift).
- `styles/tokens.css`: tokens de motion (`--transition-fast/normal`) + default global 150→120ms.
- `components/chat/chat-message.tsx`: data-testid para observabilidade de QA.

## RESULTADO (antes → depois, medido)

| Métrica | Antes | Depois |
|---|---|---|
| Galeria Studio (payload de imagens) | 43 imgs / **80.398KB** | 17 imgs / **477KB** (~168x) |
| 401 /me por sweep de 9 rotas | 9 | **0** |
| /conversations por carga de /messages | 5 (4 full scans) | **1** |
| /health/infrastructure por carga | 2 | **1** (na maioria) |
| Tema no primeiro paint (retorno, cache quente) | tema errado até /me | **dark no primeiro paint** (validado) |
| Navegação SPA | 53–63ms | 53ms (já era ótimo) |
| Chat: envio → balão | 54ms | 53ms |
| Chat: envio → atividade visível | 59ms | 60ms |
| Chat: fases REAIS do agente na UI | (não existia) | UNDERSTANDING→...→COMPLETED via WS (V2) |
| Chat: envio → resposta (Jarbas real) | ~17–25s | 25.1s (inalterado — latência real da máquina) |
| Studio: card → lightbox | n/m | 384ms |
| Console pageerrors no sweep | 0 | 0 |
| Overflow horizontal (4 viewports) | nenhum | nenhum |

Regressão das jornadas (missão §22): LOGIN→DASHBOARD PASS · DASHBOARD→CHAT PASS (53ms) · CHAT enviar→resposta PASS · STUDIO galeria→lightbox PASS · MENSAGENS DM PASS · WORKFLOWS PASS · RELOAD chat PASS. Gates: lint 18/18, typecheck 18/18, testes 13/13, build 6/6.

## PENDÊNCIAS (não resolvidas com segurança)

1. **Primeira visita absoluta** (browser sem cache, sem login): o tema resolve via prefers-color-scheme até o /me chegar — não dá pra saber o tema do servidor antes da auth sem cookie de tema.
2. **Latência real dos agentes** (Jarbas ~17–25s, Suzy ~70s) é das máquinas/LLMs — fora do frontend. A UI já mostra vida real (fases do agent loop).
3. **`/clickup/tasks/agency` 8–11s**: latência da API do ClickUp (varredura ao vivo). Cache SWR recomendado e não aplicado (risco de dado operacional velho).
4. Ack do POST /chat ~2.6s (RTT do Postgres remoto). Mitigado por optimistic UI.
5. Bento (Ollama) e Studio (máquina RTX) seguem como pendências de infra da auditoria de 11/09.

## PRÓXIMOS GARGALOS

1. Cache SWR para dados operacionais do ClickUp (tasks/agency, tasks/me).
2. Índices em executions/jobs/studio_jobs quando o volume crescer.
3. Streaming token-a-token real (o canal WS já aceita deltas parciais).
4. Pool do Postgres > 3 e/ou API co-localizada com o banco em produção.
5. Paginação de /conversations/:id/messages para conversas longas.
