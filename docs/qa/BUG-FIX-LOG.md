# BUG FIX LOG — Auditoria Final Desigual OS (2026-09-11)

Base: commit `fb79a2f` + working tree dos dois chats de desenvolvimento (68 arquivos modificados + 20 novos, integrados na FASE 2).
Ambiente: dev local (API :3001 via launchd, web :3000, Redis, agentes via Tailscale).

Convenção: FIXED = corrigido e retestado com evidência real. OPEN = permanece.

---

## BUG-QA-01 — P1 — FIXED
- **Problema:** `POST /clickup/tasks` e `POST /clickup/tasks/:id/comments` retornavam 400 "Expected object, received string" em 100% das chamadas. Criação de task pela API estava completamente quebrada.
- **Causa raiz:** o `addContentTypeParser('application/json', parseAs: 'string')` exigido pelo HMAC do webhook estava registrado no escopo do plugin inteiro (`apps/api/src/clickup/routes.ts`), fazendo TODAS as rotas do plugin receberem string crua. A rota de comments tinha um `JSON.parse` manual como workaround; a de tasks, não.
- **Arquivo:** `apps/api/src/clickup/routes.ts`
- **Alteração:** parser de raw body encapsulado num scope só do webhook (`app.register` aninhado); workaround de parse manual removido da rota de comments.
- **Como foi testado:** task real criada no ClickUp (`86bbz5gtb`, 201), consultada na lista do cliente, comentada e relida (201/200). Webhook retestado: sem assinatura → 401, assinatura errada → 401, assinatura HMAC válida → 200.
- **Resultado:** PASS.

## BUG-QA-02 — P1 — FIXED
- **Problema:** idempotência zero nos endpoints de custo real. Evidência: double submit simultâneo criou 2 tasks reais no ClickUp (`86bbz5h7q` e `86bbz5h7v`).
- **Causa raiz:** nenhuma dedup de intenção em `/chat`, `/clickup/tasks`, `/studio/jobs`.
- **Arquivos:** `apps/api/src/lib/idempotency.ts` (novo), `apps/api/src/chat/routes.ts`, `apps/api/src/clickup/routes.ts`, `apps/api/src/studio/routes.ts`
- **Alteração:** dedup via Redis (SET NX, janela 15s, chave = hash do escopo+intenção). Reenvio dentro da janela recebe o MESMO recurso (replay) ou 409 controlado se ainda em voo; falha no meio libera a chave (retry legítimo não é punido); Redis fora = falha aberta sem dedup.
- **Como foi testado:** 2 submits simultâneos idênticos de task → 1 task criada (201) + 1 resposta 409 com mensagem humana; idem `/chat` → 1 execution (202) + 1 409.
- **Resultado:** PASS.

## BUG-QA-03 — P1 — FIXED
- **Problema:** `GET /conversations` levava 5.1–7.3s (4 amostras ao vivo).
- **Causa raiz:** N+1 — uma query de lastMessage por conversa (~50) contra Postgres remoto (~130ms RTT), serial.
- **Arquivo:** `apps/api/src/conversations/routes.ts`
- **Alteração:** uma query `selectDistinctOn(conversation_id)` com `inArray` + `orderBy(createdAt desc)`, agregada em Map. Wire format intacto.
- **Como foi testado:** equivalência campo a campo das duas abordagens contra o banco real (0 divergências, 50 conversas: 13.270ms serial → 400ms); end-to-end pós-restart: **0.67–1.2s** (de 5.1–7.3s).
- **Resultado:** PASS (melhoria ~8x; ainda acima da meta P95<500ms por causa do RTT remoto — ver riscos).

## BUG-QA-04 — P2 — FIXED
- **Problema:** `GET /admin/users` ~0.94s (3 queries por usuário).
- **Arquivo:** `apps/api/src/admin/routes.ts`
- **Alteração:** 3 queries em lote com `inArray` + Maps. Equivalência validada contra banco real (1.411ms → 272ms). End-to-end: **0.46s**.
- **Resultado:** PASS.

## BUG-QA-05 — P1 — FIXED
- **Problema:** falha do Redis no enqueue deixava execution/workflow em `queued` para sempre (job fantasma; UI "pensando" eterna).
- **Arquivos:** `packages/orchestrator/src/chat-service.ts`, `packages/orchestrator/src/workflow-service.ts`
- **Alteração:** try/catch no enqueue com compensação (execution → failed, step com motivo, workflow → failed) e erro controlado 503 com mensagem humana.
- **Como foi testado:** typecheck + 65 testes do orchestrator verdes; revisão de código do caminho de compensação (inclui falha dupla Postgres+Redis).
- **Resultado:** PASS.

## BUG-QA-06 — P1 — FIXED
- **Problema:** fetches sem timeout: 7 chamadas em `clickup-client.ts`, 5 em `clickup-oauth.ts` (uma resposta que nunca fecha segurava request da API + conexão do pool de 3), e o classifier Anthropic (default ~10min) no caminho SÍNCRONO do POST /chat.
- **Arquivos:** `packages/tool-gateway/src/clickup-client.ts`, `packages/tool-gateway/src/clickup-oauth.ts`, `packages/router/src/classifier.ts`
- **Alteração:** timeout 20s em todo fetch ClickUp com mensagem amigável; classifier com `timeout: 10s, maxRetries: 0`, timeout → fallback para regras (null) com warn.
- **Como foi testado:** 14 testes novos/atualizados (clickup-client 4, clickup-oauth 8, classifier 8) — todos verdes.
- **Resultado:** PASS.

## BUG-QA-07 — P1 — FIXED
- **Problema:** `apiFetch` do frontend sem timeout/abort — request pendurado congelava o composer do chat e mutations.
- **Arquivo:** `apps/web/src/lib/api/client.ts` (+ teto de 120s nos hooks de upload)
- **Alteração:** AbortController com timeout default 30s (configurável), erro `ApiRequestError` com mensagem pt-BR; uploads com teto 120s.
- **Como foi testado:** typecheck/lint/testes do web verdes (58 testes).
- **Resultado:** PASS.

## BUG-QA-08 — P2 — FIXED
- **Problema:** worker morrendo no meio deixava o balão do chat "pensando" para sempre (polling 700ms infinito); envio falho sem retry; scroll não acompanhava `message.delta`.
- **Arquivos:** `apps/web/src/components/chat/chat-thread.tsx`, `apps/web/src/components/chat/chat-message.tsx`
- **Alteração:** watchdog de 6min (balão vira failed com "Tentar novamente" e corta o poll), botão de retry reenviando a mesma mensagem (sem reupload de anexos), scroll reagindo ao texto do delta.
- **Como foi testado:** typecheck/lint verdes; guards históricos de dupla bolha preservados (revisão).
- **Resultado:** PASS (comportamento visual validado parcialmente — ver UI smoke no relatório).

## BUG-QA-09 — P2 — FIXED
- **Problema:** página /tasks — `useMyTasks` disparava no escopo "agency" (409 desnecessário a cada visita de quem não vinculou e-mail); após vincular e-mail a lista não recarregava; input de e-mail não era preenchido se /me resolvesse após o mount.
- **Arquivos:** `apps/web/src/app/(shell)/tasks/page.tsx`, `apps/web/src/hooks/use-tasks.ts`
- **Alteração:** `enabled: scope === 'mine'`; invalidação de `['clickup','tasks','me']` no sucesso do vínculo; prefill via useEffect sem sobrescrever digitação.
- **Como foi testado:** typecheck/lint/testes verdes.
- **Resultado:** PASS.

## BUG-QA-10 — P2 — FIXED
- **Problema:** nenhum `removeOnComplete`/`removeOnFail` nas filas BullMQ — histórico de jobs crescendo sem teto no Redis.
- **Arquivos:** `packages/orchestrator/src/queues.ts`, `packages/orchestrator/src/studio-queue.ts`
- **Alteração:** `defaultJobOptions` { removeOnComplete: 100, removeOnFail: 500 }. Repeatables de automação preservados (jobId determinístico intacto).
- **Como foi testado:** typecheck + testes verdes.
- **Resultado:** PASS.

## BUG-QA-11 — P2 — FIXED
- **Problema:** `flushPendingLearnings` sem nenhum chamador — aprendizado pendente nunca reenviado.
- **Arquivo:** `apps/worker/src/index.ts`
- **Alteração:** flush agendado a cada 5min com catch próprio, unref e clearInterval no shutdown.
- **Como foi testado:** typecheck + 27 testes do worker verdes.
- **Resultado:** PASS.

## BUG-QA-12 — P0 — FIXED
- **Problema:** `apps/api/_scratch_login.mjs` commitado com credencial real em plaintext (e desatualizada — a senha do arquivo nem é mais a vigente).
- **Alteração:** arquivo deletado; grep confirma zero referências.
- **Pendência:** a senha que constava no arquivo esteve no histórico do git — rotação recomendada (decisão do usuário, que proíbe rotação de credenciais operacionais; esta é a senha de login humano, caso diferente).
- **Resultado:** PASS (arquivo removido; risco residual documentado).

## BUG-QA-13 — P3 — FIXED
- **Problema:** JSON malformado no body retornava detalhe cru do parser ("Expected property name or '}'...").
- **Arquivo:** `apps/api/src/server.ts`
- **Alteração:** error handler mapeia SyntaxError 400 → `{error: 'Invalid JSON body'}`.
- **Como foi testado:** curl com body inválido → 400 com mensagem limpa.
- **Resultado:** PASS.

## BUG-QA-14 — P2 — FIXED
- **Problema:** Suzy vazou sintaxe interna no chat ("`pergunta pro bento: ...`" em backticks).
- **Arquivo:** `apps/worker/src/processors/execute-job.ts`
- **Alteração:** filtro na borda (mesmo ponto do filtro "No response from OpenClaw"): diretiva embutida é removida; resposta só-diretiva vira falha controlada. Causa raiz está no prompt do susy-service (máquina remota) — saneamento local aplicado.
- **Como foi testado:** 2 testes novos em execute-job.test.ts, verdes. Observação: a remoção pode deixar frase com espaço duplo quando a diretiva vinha no meio da sentença (P3 residual).
- **Resultado:** PASS.

## BUG-QA-15 — P1 — FIXED
- **Problema:** typecheck do monorepo quebrado no working tree entregue pelos dois chats (`worker-heartbeat.test.ts` com `vi.fn` de 2 type args, inválido no Vitest 3).
- **Arquivo:** `packages/orchestrator/src/worker-heartbeat.test.ts`
- **Alteração:** assinatura `vi.fn<(key: string) => Promise<string|null>>()`.
- **Como foi testado:** typecheck + 65 testes verdes.
- **Resultado:** PASS.

## BUG-QA-16 — P2 — FIXED
- **Problema:** fila do Studio piscava vazia a cada job novo (JobProgressCard retornava null no primeiro fetch); fan-out de até 50 GETs de runs no load de /workflows.
- **Arquivos:** `apps/web/src/components/studio/job-progress-card.tsx`, `apps/web/src/app/(shell)/workflows/page.tsx`
- **Alteração:** skeleton no lugar do null; semáforo de concorrência 6 nos fetches de runs.
- **Como foi testado:** typecheck/lint/testes verdes.
- **Resultado:** PASS.

---

## Issues ABERTAS (não corrigíveis neste ambiente)

### OPEN-P1-A — Bento sem motor de texto
- **Evidência:** `POST /ask` no bento-qa retorna 502 em 3/3 probes (30s, 4.5s, 30s); Ollama (porta 11434) não responde na máquina do Bento (100.93.182.83); `/health` do bento-qa responde ok (sonda rasa — monitoramento reporta "online" com o agente quebrado).
- **Impacto:** Bento não responde no chat (falha honesta e rápida: execution failed em ~0.3s, balão de erro na UI).
- **Ação necessária:** reiniciar o Ollama no Mac Mini do Bento. Sem acesso SSH a partir desta sessão (publickey negado).
- **Follow-up de código:** a sonda de saúde deveria incluir verificação profunda do motor de texto (hoje `diagnoseTextEngine` existe mas o /health superficial passa).

### OPEN-P1-B — Máquina do Studio offline
- **Evidência:** 100% packet loss em 100.107.198.50; ComfyUI e Ollama inalcançáveis; último heartbeat 11:51 (mais de 1h antes da auditoria). Diagnóstico do próprio sistema: "máquina provavelmente desligada, dormindo ou fora da Tailscale".
- **Impacto:** geração de imagem/vídeo indisponível; NOT VERIFIED. Comportamento do sistema sob a falha é correto: chat com STUDIO → 503 imediato com mensagem humana; jobs diretos falhariam com erro controlado.
- **Ação necessária:** ligar/conectar a máquina do Studio e reexecutar a bateria do Studio.

### OPEN-P1-C — Otto: caminho criativo DEEP estoura 300s e derruba a conexão
- **Evidência:** probe direto ao node com pedido de conceito criativo falhou aos 301s com "fetch failed" (conexão cortada); pergunta trivial completa em 13–56s. O código local do otto-node devolve `status:'failed'` estruturado em qualquer exceção — o corte abrupto sugere deploy desatualizado ou timeout de servidor na máquina do Otto.
- **Impacto:** fluxos criativos profundos (conceito → production_spec → Studio) falham sem resposta amigável.
- **Ação necessária:** acesso à máquina do Otto para verificar versão deployada, logs e `OTTO_LLM_TIMEOUT_MS`; considerar subir o timeout ou quebrar o planner DEEP em etapas.

### OPEN-P2-A — Continuidade fraca de conversa em Jarbas/Suzy
- **Evidência:** bateria 2 — T1 "qual cliente tem o melhor custo por resultado?" respondido com dados reais; T2 "E o pior?" na MESMA conversa → "Sobre qual cliente você tá falando?". O worker envia `sessionId = conversationId` e o bloco de contexto com as últimas mensagens; o serviço remoto (agentes-desigual, fora do repo) aparentemente não os usa.
- **Ação necessária:** corrigir o uso de sessão no serviço remoto (Jarbas/Suzy).

### OPEN-P2-B — Ack do chat ~2.6–3.4s
- **Evidência:** medido em 6 envios (warm). Causa: ~10 round-trips sequenciais ao Postgres remoto (~130ms cada) + resolução operacional ao vivo (ClickUp) quando aplicável. Paralelização buildContext+operationalTurn aplicada (ganho marginal).
- **Mitigação existente:** a UI otimista mostra a mensagem imediatamente; o ack só atrasa o início do tracking.
- **Alavanca estrutural:** reduzir RTT (API perto do banco em produção) ou pool maior que 3.

### OPEN-P2-C — `/clickup/tasks/agency` 8.7–11.2s
- **Causa:** varredura ao vivo de dezenas de listas no ClickUp (latência externa, até 20 páginas × 100 tasks).
- **Mitigação possível:** cache curto (stale-while-revalidate) ou materialização via webhook/event-store. Não aplicado (risco de dado operacional desatualizado).

### OPEN-P3 — diversos
- Flash de tema no first paint (tema aplicado post-mount).
- Página /knowledge inteiramente com dados de amostra (`SAMPLE_KNOWLEDGE_SOURCES`).
- `system_events` sem escritor (tabela morta); `emitSignal` sem chamadores.
- Default `NEXT_PUBLIC_API_MODE=mock` — deploy sem env sobe com dados falsos (há banner, mas não fail-fast).
- WS com token na query string (vaza em access logs de proxy).
- `hasClientAccess` retorna sempre true (decisão deliberada de 03/09, mas é o maior furo potencial de RBAC se client_users voltar a ser gate sem revisar canvas-routes).
