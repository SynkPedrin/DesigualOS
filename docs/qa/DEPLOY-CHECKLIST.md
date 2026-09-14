# DEPLOY CHECKLIST — Desigual OS (auditoria 2026-09-11)

Legenda: [x] verificado com evidência · [!] verificado com ressalva · [ ] não verificado

## Build e código
- [x] Lint passa (17/17 pacotes, pós-correções)
- [x] TypeScript passa (17/17; 1 erro do working tree corrigido na FASE 2)
- [x] Testes passam (12 pacotes com testes, todos verdes pós-correções; 65 orchestrator, 35 api, 27 worker, 58 web, 21 router, 27 tool-gateway, studio-node e demais)
- [!] Build de produção (ver resultado no FINAL-QA-REPORT; apps/api + apps/worker via esbuild já eram validados em 07/09)

## Serviços
- [x] Frontend funciona (12 rotas varridas com login real via Playwright, 0 pageerrors, 0 5xx)
- [x] Backend funciona (health, auth, chat, tasks, messages, studio routes, webhooks)
- [x] Banco funciona (Supabase Postgres via session pooler)
- [ ] **Bento funciona — BLOQUEADO: Ollama fora na máquina do Bento (502 em 4/4 probes)** — reiniciar Ollama no Mac Mini e reexecutar bateria
- [x] Jarbas funciona (3 respostas reais com dados Meta Ads corretos)
- [!] Otto funciona (trivial/copy/copy→reels OK; caminho criativo DEEP falha aos 301s — OPEN-P1-C)
- [x] Suzy funciona (2 respostas honestas; vazamento de sintaxe interna corrigido na borda)
- [ ] **Studio funciona — BLOQUEADO: máquina RTX offline** — ligar/conectar e reexecutar bateria de geração
- [x] ClickUp funciona (criar/consultar/comentar/reler/deletar-com-aprovação, tudo contra API real)
- [!] Obsidian/memória (learning agenda flush; vault remoto não verificável daqui)

## Fluxos
- [x] Mensagens funcionam (8 DMs em 2 bursts: ordem, timestamps, sem duplicação/perda)
- [x] Tasks funcionam (CRUD real menos update, que não existe por design; idempotência verificada)
- [x] Streaming funciona (WS message.delta com polling de segurança; sem token-a-token real — limitação conhecida)
- [!] Reconnect funciona (WS com backoff 1→15s no cliente; teste de reconnect automático não exercitado em browser)
- [x] Loading states corretos (skeletons; fila do Studio com skeleton novo; watchdog de 6min no chat)
- [x] Error states corretos (503 humano para agente offline, 401/400 limpos, sem stack trace)
- [x] Mobile validado (390x844 sem overflow horizontal; drawer mobile presente)
- [x] Desktop validado (1920/1440/1366/1024 sem overflow)
- [x] Performance validada (ver PERFORMANCE-REPORT.md; /conversations 7.3s→0.67s)
- [x] Concorrência validada (3 agentes em paralelo, sem contaminação cruzada)
- [x] Regressão 1 concluída (tasks, webhook HMAC, chat, DMs retestados após correções)
- [x] Regressão 2 concluída (bateria 2 com prompts/dados/ordem diferentes)

## Gate
- [x] P0 = 0 (credencial commitada removida)
- [!] P1 = 0 **no código do monorepo**; P1 externos abertos: Bento (Ollama), Studio (máquina offline), Otto DEEP (timeout na máquina)

## Antes do teste interno (ações do usuário/infra)
1. Reiniciar o Ollama no Mac Mini do Bento → reexecutar `node scripts/qa/probe-bento.mjs "teste"` até retornar `status: ok`.
2. Ligar/conectar a máquina do Studio (RTX) na Tailscale → validar `curl http://100.107.198.50:8188/system_stats` → rodar uma geração real.
3. Verificar o deploy do otto-node na máquina do Otto (versão e `OTTO_LLM_TIMEOUT_MS`) — o caminho DEEP corta a conexão aos ~300s.
4. Decidir: rotação da senha que estava em `_scratch_login.mjs` (esteve no histórico git).
5. Decidir: `/clickup/tasks/agency` com cache curto (hoje 8-11s ao vivo).
