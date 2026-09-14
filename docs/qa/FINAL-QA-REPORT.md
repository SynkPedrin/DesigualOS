# FINAL QA REPORT — Desigual OS

- **Data:** 2026-09-11
- **Versão analisada:** commit `fb79a2f` + working tree dos dois chats de desenvolvimento (integrado e revisado na FASE 2) + correções da auditoria
- **Ambiente:** dev local (Mac do usuário) — API Fastify :3001 (launchd), web Next 16 :3000, worker BullMQ, Redis docker, Supabase remoto, agentes via Tailscale
- **Método:** nada foi marcado PASS sem evidência. Testes rodaram contra as integrações REAIS (ClickUp, Meta Ads via Jarbas, Ollama via Otto, Supabase). O que não pôde ser testado está NOT VERIFIED com o motivo.

## Resumo executivo

O monorepo saiu da auditoria significativamente mais forte: 16 correções aplicadas e retestadas (1 P0 de segurança, 8 P1, resto P2/P3), incluindo um bug que quebrava 100% da criação de tasks ClickUp, idempotência inexistente em todos os endpoints de custo real, e o endpoint mais lento do sistema 8x mais rápido. O gate de engenharia está verde: lint, typecheck, ~250 testes e build de produção.

**Mas o veredito é DEPLOY BLOCKED por condições externas ao código:** o Bento está com o motor de texto fora (Ollama parado no Mac Mini — 502 em 4/4 probes), a máquina do Studio está offline (100% packet loss) e o caminho criativo profundo do Otto morre aos ~300s na máquina dele. As três correções dependem de acesso físico/SSH às máquinas, que esta sessão não tem. Com as máquinas de pé, o desbloqueio é reexecutar as baterias (scripts prontos em `scripts/qa/`).

## Arquitetura encontrada (real, verificada em código)

Monorepo pnpm+Turbo. `apps/api` (Fastify, ~20 grupos de rotas, JWKS Supabase, RBAC próprio, rate limit 300/min/IP, webhook ClickUp público com HMAC) → `packages/router` (menção → regras → classifier Anthropic com timeout de 10s) → filas BullMQ por agente → `apps/worker` (dispatch, timeouts por agente 120s–25min, attempts 1-2) → máquinas via Tailscale (Bento bento-qa :8791, Jarbas/Suzy agentes-desigual :3102, Otto otto-node :4002, Studio studio-node BullMQ → ComfyUI RTX 4090). Frontend Next 16 com TanStack Query (polling 0.5–20s) + WS `/ws` (message.delta, execution.*, dm.received). Sem streaming token-a-token (um delta final + polling de 700ms). Postgres Supabase remoto (~130ms RTT, pool de 3) sem RLS (enforcement na aplicação, decisão deliberada).

## Testes executados (evidências no BUG-FIX-LOG e PERFORMANCE-REPORT)

**Agentes (2 baterias independentes cada, prompts diferentes, conversas novas):**

| Agente | Bateria 1 | Bateria 2 | Status |
|---|---|---|---|
| Bento | FAIL (502, answer null) | FAIL (502 no probe direto) | 🔴 OPEN-P1-A (externo: Ollama fora) |
| Jarbas | PASS (19.3s, carteira Meta Ads real) + PASS concorrência (4.4s) | PASS T1 (20.5s); T2 follow-up perdeu o fio | 🟡 OPEN-P2-A (serviço remoto) |
| Otto | PASS trivial (56s/13s) + copy (61s) + continuidade Reels (65s) | PASS briefing incompleto (46s, inventou objeto — nota P3); DEEP FAIL 301s | 🟡 OPEN-P1-C (máquina) |
| Suzy | PASS (68s, honesta) + PASS concorrência (74s) | PASS objeção (77s, recusou inventar preço) | 🟢 (vazamento de sintaxe corrigido) |
| Studio | NOT VERIFIED (máquina offline) | NOT VERIFIED | ⚫ OPEN-P1-B (externo) |

**Concorrência:** 3 agentes simultâneos, 3 conversas, zero contaminação cruzada, todos completed.

**Tasks ClickUp (real, cliente "teste"):** criar/consultar/comentar/reler/deletar-com-aprovação = PASS (apos fix do parser). Update de task não existe por design (gap documentado). Idempotência: antes = 2 tasks reais de um gesto; depois = 1 task + 409 controlado. As 5 tasks de QA foram deletadas via fluxo de aprovação (que também foi testado: 5/5 aprovadas e executadas, 0 restantes no ClickUp).

**Mensagens:** 8 DMs em 2 bursts consecutivos — ordem, timestamps, sem duplicar/perder/trocar conversa. Envio ~0.55s (UI não otimista, P3).

**Chaos controlado:** agente offline (chat→STUDIO) → 503 humano em 2s; token inválido/ausente → 401; JSON malformado → 400 limpo; webhook sem/com assinatura errada → 401, assinatura válida → 200; Bento quebrado → falha honesta rápida com balão de erro + retry na UI.

**UI (Playwright + Chromium real, login real):** 12 rotas × 1440x900 + dashboard/chat em 1920/1366/1024/390 — **0 pageerrors, 0 requests 5xx, 0 overflow horizontal** em todos os viewports. 22 console errors, todos 401 de resource na sequência pós-login (ruído de corrida entre sessão e primeira query — P3). Flash de tema claro antes do dark confirmado visualmente (P3). Notificações de aprovação não saem do inbox depois de aprovadas (P3).

## Problemas encontrados

Ver `BUG-FIX-LOG.md`: 16 corrigidos (P0: 1, P1: 8, P2: 5, P3: 2) + abertos (P1 externos: 3, P2: 3, P3: 6).

## Riscos

1. Bento e Studio dependem de ação física nas máquinas antes do teste interno.
2. Postgres remoto com pool de 3 e ~130ms de RTT é o gargalo estrutural (ack do chat ~2.6s; piso ~500ms nas listas).
3. Sem backup real (Supabase free, sem PITR) — dado de cliente é irrecuperável hoje.
4. Senha que estava em `_scratch_login.mjs` consta no histórico do git.
5. `hasClientAccess` sempre true: RBAC por cliente é nominal (decisão deliberada de 03/09, mas canvas-routes agora depende disso ser verdade para sempre).

## Resultado final

**DEPLOY BLOCKED** — não pelo código (P0=0, P1 de código=0, gates verdes), mas porque dois fluxos principais (Bento no chat, geração no Studio) não puderam ser verificados funcionando, e a missão proíbe aprovar o que não foi testado. Desbloqueio: 3 ações nas máquinas (DEPLOY-CHECKLIST.md, seção final) + reexecutar `scripts/qa/`. Estimativa: menos de 1h depois que as máquinas estiverem de pé.
