# PERFORMANCE REPORT — Auditoria Final Desigual OS (2026-09-11)

Método: medições reais com `curl` autenticado (scripts/qa/api.sh, token Supabase real) contra o ambiente dev local (API :3001, Supabase Postgres remoto, agentes via Tailscale). Cada número é uma medição, não estimativa. RTT do Postgres remoto: ~130ms por query (limitante estrutural do ambiente dev).

## APIs internas (antes → depois)

| Endpoint | Antes | Depois | Ganho | Gargalo | Correção |
|---|---|---|---|---|---|
| GET /conversations | 5.1–7.3s | **0.67–1.2s** | ~8x | N+1: 1 query de lastMessage por conversa (~50) serial | `selectDistinctOn` único + Map (BUG-QA-03) |
| GET /admin/users | 0.94s | **0.46s** | 2x | 3 queries por usuário | queries em lote com inArray (BUG-QA-04) |
| GET /executions | 0.48–0.56s | 0.29s | ~1.7x | cache frio JWKS | (aquecimento; sem mudança de código) |
| GET /notifications | 0.34–0.67s | 0.34s | — | dentro da meta | — |
| GET /health/infrastructure | 0.51–1.08s | 0.51s | — | sonda de 5 nodes | aceitável (master-only) |
| GET /messages/threads | ~0.55s | ~0.55s | — | janela fixa de 500 | dentro do aceitável no volume atual |
| GET /automations | ~0.15s | ~0.15s | — | — | ok |
| GET /clients | ~0.14s | ~0.14s | — | — | ok |
| GET /studio/assets | 0.87–1.88s | idem | — | storage + query | não alterado |
| GET /clickup/tasks/agency | 8.7–11.2s | idem | — | latência da API do ClickUp (varredura ao vivo de ~50 listas) | OPEN-P2-C: cache SWR recomendado, não aplicado |
| POST /chat (ack 202) | 2.3–3.4s | 2.6–2.9s | marginal | ~10 RTTs sequenciais ao Postgres remoto + contexto operacional | buildContext ∥ operationalTurn (Promise.all); alavanca estrutural = reduzir RTT |
| POST /clickup/tasks | quebrado (400) | **1.7–1.8s (201)** | ∞ | parser JSON quebrado no plugin | BUG-QA-01 |
| GET /health | 0.9ms | 0.9ms | — | — | ok |

## Chat (medido ponta a ponta, agentes reais)

| Fluxo | Medição | Observação |
|---|---|---|
| Ack (POST /chat → 202) | 2.3–3.4s | mensagem aparece na UI imediatamente (optimistic update); ack só inicia tracking |
| Jarbas: pergunta operacional completa | 4.4–20.5s | dados reais Meta Ads; resposta completa e correta |
| Suzy: resposta comercial | 68–77s | latência da máquina Suzy (probe ~3.4s) + LLM local |
| Otto: pergunta trivial | 13–56s | 13s com Ollama quente, 56s frio |
| Otto: copy de Instagram | 61s | completed |
| Otto: conceito criativo DEEP | **falha aos 301s** | OPEN-P1-C: conexão cortada no timeout interno do node |
| Bento: qualquer pergunta | **falha (~0.3–35s)** | OPEN-P1-A: motor de texto (Ollama) fora na máquina do Bento |

## Frontend (Next dev, Turbopack quente)

| Métrica | Valor |
|---|---|
| `/login` TTFB (quente) | 13–18ms (primeira carga: 70ms) |
| `/` redirect | ~2ms |
| Envio de DM (POST /messages) | 0.53–1.08s por mensagem |

Detalhes de UI (console errors, viewports, screenshots): ver seção de UI smoke no FINAL-QA-REPORT.md.

## Metas vs medido

| Meta da missão | Status |
|---|---|
| Ação local com feedback < 150ms | UI otimista no chat (mensagem aparece na hora); DMs não otimistas (P3) |
| Navegação < 300ms percebida | skeletons client-side; sem loading.tsx de rota (P3) |
| API P50 < 150ms / P95 < 500ms | maioria dentro; /conversations ainda ~670ms (era 7.3s); /clickup/tasks/agency fora (externo) |
| Nenhum request pendurado | timeouts adicionados: ClickUp 20s, classifier 10s, apiFetch 30s/120s |

## Maiores alavancas restantes (não aplicadas)

1. **RTT do Postgres remoto (~130ms/query, pool de 3):** domina o ack do chat e o piso de ~500ms das listas. Em produção, API perto do banco (ou pool maior) é a alavanca real.
2. **Cache SWR para `/clickup/tasks/agency`** (8-11s de latência externa).
3. **Índices ausentes** em `executions` (user_id/client_id/status), `jobs`, `job_attempts`, `studio_jobs(requested_by,status)`, `messages(conversation_id,created_at)` — sem efeito mensurável no volume atual, vão doer com escala.
