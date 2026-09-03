# ADR 0005: Studio gera asset stub (sem GPU real integrada), `@supabase/supabase-js` e `@fastify/websocket`

## Contexto

A Fase 7 (Studio Node + GPU Worker) pede jobs assíncronos de imagem/vídeo com progresso via WebSocket. Não há runtime de GPU real (ComfyUI ou equivalente) disponível pra integrar; o prompt mestre já previa isso ("pode ser stub de imagem no MVP", seção 12).

## Decisões

1. **Stub de asset real, não fake.** `nodes/studio-node` gera um SVG de verdade (arquivo válido, abre em qualquer visualizador) com o prompt, resolução e timestamp, em vez de um arquivo fingindo ser imagem. Fica óbvio pra quem olhar que é um placeholder, não um resultado de IA de verdade. Troca por geração real (ComfyUI/runtime) é um ADR futuro, sem mudar o contrato do job (`POST /studio/jobs` → `asset_url`).
2. **`@supabase/supabase-js`** em `nodes/studio-node`, pra upload direto no Supabase Storage (bucket `studio-assets`, criado via API do Supabase, público pra leitura). Não estava na lista da seção 4, mas é decorrência direta da ADR 0001 (Storage é Supabase).
3. **`@fastify/websocket`** em `apps/api`, pro canal `/ws` da seção 9 (`execution.progress`, `studio.job.progress`, etc). Broadcast simples pra todo cliente conectado nesta fase; sem filtro por usuário/cliente ainda (a conexão WS não carrega autenticação própria, só o REST tem). Eventos são publicados via Redis pub/sub (`packages/orchestrator/src/pubsub.ts`), porque quem gera o evento (`studio-node`) pode estar numa máquina diferente do processo que serve o WS (`apps/api`).

## Consequência

Progresso de job funciona de ponta a ponta (testado), mas o asset em si é sempre um placeholder até uma integração de GPU real existir. `studio_assets.metadata` marca `stub: true` em todo asset gerado assim, pra nunca confundir com geração real no futuro.
