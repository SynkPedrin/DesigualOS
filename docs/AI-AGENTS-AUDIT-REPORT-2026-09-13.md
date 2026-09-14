# FINAL AGENT SYSTEM REPORT — 2026-09-13

Auditoria cognitiva + correção dos agentes do Desigual OS. Jarbas: golden agent, READ-ONLY, nenhuma alteração direta ou indireta intencional (portão de regressão executado antes e depois: 5/5 verde nas duas).

Base de trabalho: a auditoria forense de 12/09 (`docs/auditoria-forense-agentes-2026-09-12.md`, 26 bloqueadores com evidência) + baselines da Onda 0 (`docs/execucao-onda-0-2026-09-12.md`). Este relatório registra o que foi CORRIGIDO e PROVADO em 13/09, não o que falta por hipótese.

---

## BENTO

**Problemas encontrados:**
1. Motor de texto fora do ar: Ollama da máquina do Bento (100.93.182.83:11434) não responde desde 11/09. bento-qa `/ask` retorna 502 em 100% dos probes (8+ tentativas em 3 dias). A sonda de saúde `/health` responde ok mesmo assim (sonda rasa).
2. Timeout efetivo de 100s em vez dos 120s declarados (BL-23).
3. Edição de task, anexo em task e campos ricos de criação estruturalmente impossíveis (BL-01, BL-05, BL-15) — ferramentas ausentes.
4. Prompt binário "fonte ou silêncio" (BL-07) vive no serviço remoto — fora do repo.
5. Follow-up sem fio por desenho (BL-08, decisão documentada: contexto envenena a busca vetorial).

**Correções (todas verificadas):**
- BL-23 FIXED: `timeoutMs: AGENT_TIMEOUT_MS.bento` explícito no dispatch (`apps/worker/src/processors/execute-job.ts`).
- BL-15 FIXED + PROVADO: task criada com `priority:2`, `due_date` e tag `qa-auditoria`; verificado via API do ClickUp diretamente (todos os campos presentes).
- BL-01 FIXED + PROVADO ponta a ponta: `PATCH /clickup/tasks/:id` → fila de aprovação (seed `clickup.update_task` requiresApproval) → executor novo → verificado no ClickUp real (status e descrição alterados). Status inválido agora devolve a lista de status válidos da lista em vez de um 400 seco (medido ao vivo com a lista "teste").
- BL-05 FIXED + PROVADO: arquivo enviado via `/uploads` → anexado à task → `attachment_id` retornado pelo ClickUp → confirmado via GET direto na API do ClickUp (anexo presente na task).

**Testes:** eval ao vivo B01-B03 = failed com resposta honesta de falha (nunca sucesso simulado). Scores 29-54/100 refletem o agente fora do ar, não o código.

**Resultado (ATUALIZADO 14/09):** BENTO VIVO E VALIDADO. O Ollama da máquina dele estava preso (processo zumbi na porta 11434); após kill+restart pelo dono, o `/ask` respondeu (1ª chamada 47s com carga fria do modelo, 2ª 5.9s com 2 citações do vault). Eval ao vivo: B01 64/100 (resposta macro veio estreita demais, focou um cliente só), B02 89/100 ("6 tarefas vencem amanhã. Isso vem do ClickUp, consultado agora."), B03 96/100 (análise de risco citando clientes e padrões reais). **Média 83/100.** Infra de escrita ClickUp já provada (create rico, update com aprovação, anexo). Pendente menor: a pergunta macro genérica ainda tende a estreitar para um cliente — ajuste fino fica no prompt do serviço remoto.

Pendência operacional registrada: o Ollama foi subido em primeiro plano no terminal da máquina; se a janela fechar, o Bento morre de novo. Recomendado mover para pm2/launchd. E a sonda de saúde segue rasa (`/health` ok com motor fora) — monitoramento mostrava "online" com o agente morto.

---

(Seção original de 13/09 abaixo, quando o Bento estava fora:)

**Resultado (13/09):** INFRA DO BENTO PRONTA (ferramentas write do ClickUp completas e comprovadas). AGENTE BLOQUEADO por causa externa: **reiniciar o Ollama no Mac Mini do Bento**. Sem SSH desta sessão (publickey negado em 4 máquinas).

---

## SUZY

**Problemas encontrados:**
1. Vazamento de diretiva interna em 2 formatos (`` `pergunta pro bento:` `` conhecido + `` `cria uma task no clickup:` `` flagrado no baseline da Onda 0).
2. Prompt de produção com zero método de venda (BL-12) — vive no serviço remoto, fora do repo.
3. Latência alta (~70-90s) da máquina (probe ~3.4s).

**Correções:**
- Filtro de borda estendido para os 2 formatos (`stripInternalHandoffDirectives`, worker). Teste novo cobre o formato 2. 32/32 verdes.
- Loop V2 agora cobre a Suzy (com AGENT_LOOP_V2=true): objetivo, avaliação e replan por trás da resposta dela.

**Testes (eval ao vivo, 13/09):**
- S01 lead frio "quanto custa?": completed, 86s, **100/100** (sem saudação genérica, sem vazamento, substantiva).
- S02 objeção "tá caro": completed, 83s, **99/100**.

**Resultado:** FUNCIONANDO como especialista no que depende deste repo. Aprofundar o método comercial exige editar o prompt no serviço remoto (mesmo bloqueio de acesso do Bento).

---

## OTTO

**Problemas encontrados:**
1. BL-14 (PROVADO AO VIVO): jobs simultâneos empilhavam dentro do timeout um do outro (node single-thread de fato); minha própria suíte de eval reproduziu o empilhamento (2 cenários travaram >405s cada).
2. BL-09: 154/155 docs do STUDIO-BRAIN invisíveis ao retrieval (frontmatter `type/domain/topic` + tags em bloco YAML não lidas).
3. BL-13: caminho criativo DEEP lento demais na CPU (~10 tok/s, plano JSON de 18 campos; estoura 300s+).
4. Timings de fase do node (classify/retrieval/llm) descartados pelo worker (achado 4 da Onda 0).

**Correções:**
- BL-14 FIXED no worker (deployável daqui, vale na hora): `AGENT_QUEUE_CONCURRENCY = { otto: 1 }` — a fila do BullMQ serializa os jobs do Otto em vez de empilhar dentro do timeout.
- BL-09 FIXED: parser de frontmatter lê listas em bloco + aliases `domain`/`topic`/`title` + `tags` viram intenções de busca. Teste novo com o frontmatter real do vault. 143/143 verdes.
- Achado 4 FIXED: `result.metadata` agora é persistida em `execution_steps.output` (timings de fase do Otto e bloco agentic do loop V2 passam a ser auditáveis).
- BL-13 NÃO corrigido: exige mexer no pipeline na máquina do Otto (deploy separado, sem acesso) ou hardware. Documentado.

**Testes (eval ao vivo):** O01/O02 antes do fix de serialização: running >405s (empilhados). Após o fix: backlog drenado em ordem, um job por vez (queue-otto com concurrency 1, verificado: 0 aguardando / 1 ativo processando, fila limpa); 1 execução completou (582s na fila, era a terceira na linha); outcome mais recente do loop V2: goal_completion=true com 2 iterações e score 1.0 (self-correction funcionando em produção). Cenário trivial anterior (11/09): 13s com Ollama quente.

**Resultado:** parcialmente corrigido com o que é controlável daqui. Latência criativa profunda depende da máquina (fora do repo).

---

## JARBAS

Alterações diretas: ZERO.
Alteração indireta relevante: o loop V2 o envolvia desde 11/09 (flag global ligada); a flag agora é por agente e o exclui estruturalmente, com teste travando isso (`parseAgentLoopFlag`: "true" liga todos exceto jarbas; nomeá-lo na lista também não entra).
Regression status: **PASS (5/5 antes e depois)** — `scripts/qa/jarbas-nao-regressao.ts`.
Benchmark ao vivo (13/09): J01 completed, 27.1s, 78/100 na rubrica, dados reais Meta Ads.

---

## OBSIDIAN

- STUDIO-BRAIN: parser corrigido (BL-09) — os 154 docs com frontmatter moderno agora alimentam a busca do Otto (na máquina dele, após deploy).
- `brain/` (vault do projeto) e os 19 dossiês de cliente da raiz: **não são lidos por nenhum código** (BL-18) — não corrigido: decisão de arquitetura sobre quem indexa (pré-requisito da recuperação semântica, Onda 3).
- `Brain-Marketing/cerebro/` (~200KB de outro produto, Orvyn/Nyro): contaminação confirmada; **não movido sem autorização** (pergunta 9 da auditoria forense pendente do dono).

## CLICKUP

- Read: PASS (agência, por cliente, comentários, membros — provado desde 11/09).
- Write: PASS — create completo (priority/due_date/tags provados), update via aprovação (provado), comentário (provado), delete via aprovação (provado).
- Attachments: PASS (provado com arquivo real, confirmado via API do ClickUp).
- Briefings: motor existe (briefing-engine ligado ao contexto operacional); validação E2E depende do Bento (bloqueado).

## MEMORY

- Persistência entre conversas, isolamento cliente A/B e user A/B, supersessão com histórico: 8/8 PASS ao vivo (11/09, script apps/worker/scripts/qa-memory-test.mts).
- Escopo por usuário adicionado ao recall (11/09).
- expireStaleMemories agora agendado (1x/hora) — antes não tinha chamador.
- Kinds gravados sem consumidor (BL-20): parcial — `agent.episode` passou a ter consumidor no gatherContext do loop V2; demais kinds documentados.

## RAG

Otto: retrieval lexical corrigido no frontmatter; busca semântica (embeddings) continua não implementada (Onda 3, requer migração + decisão de modelo).

## SEARCH

Ferramenta de pesquisa web: **inexistente** (BL-02). Não implementada nesta rodada: depende de decisão do dono (provedor + orçamento — pergunta 5 da auditoria forense). Sem a ferramenta, agentes NUNCA inventam pesquisa (a borda honesta já existe).

## ROUTER

Menção explícita + rule engine funcionam; classifier Anthropic continua sem chave (decisão externa, ADR 0004). Fallback Bento documentado.

## TOOLS

Gateway + matriz de permissões: update_task adicionado com aprovação obrigatória; delete/meta_ads/instagram já existiam. Catálogo visível ao modelo: não implementado (Onda 3; os agentes remotos não aceitam tool definitions hoje).

## STREAMING

Sem token-a-token (nenhum agente emite); `message.delta` único + fases reais do agent loop na UI (V2). Streaming verdadeiro fica para a Onda 3 (stream:true no provider do Otto + SSE no bento-qa quando o SSH liberar).

## PERFORMANCE (medido, nunca estimado)

Atualização 14/09 (Otto, alvo do dia):
- Fast path completo (ack + fila + node + persistência): 18.4s → **13.7s** medido ao vivo. Breakdown real do node via `execution_steps.metadata.node.timings` (persistido desde 13/09): llm 7.0s, retrieval 7ms, classify 0ms.
- Mudanças: checkpoints/outcome/episódio do loop viraram fire-and-forget (só fases terminais aguardam); `num_predict` com teto por caminho no provider Ollama (chat 1000, JSON 1600) — repo-side, efetivo na máquina do Otto após pull+build.
- **BRAIN Nexus/Scribe/Prism adicionado ao vault** (`Brain-Marketing/brain-desigual-ia-labs.md`, o documento canônico colado pelo dono em 14/09): indexado pelo retrieval corrigido, top-1 nas queries "roteiro reels gancho CTA" e "direção de arte paleta luz lente". Efetivo na máquina do Otto após o vault ser atualizado lá.
- Teste de conformidade com o BRAIN (roteiro Reels 3Net, 14/09, ANTES do deploy do vault na máquina): sem travessão ✓, sem frasinha pronta ✓, sem jargão ✓ — mas repetiu o template de formato de volta antes de entregar (proibido pela seção 6), hook veio como descrição de imagem em vez de fala literal, CTA ausente no trecho entregue. Ou seja: o modelo dele hoje NÃO segue o BRAIN porque não o tem; a correção é o deploy do vault atualizado na máquina.
- Jarbas (regressão após as mudanças compartilhadas): 16.2s com dados reais + portão 5/5.
- Bento: VIVO desde 14/09 manhã (Ollama destravado pelo dono); eval 83/100; sonda profunda implementada (`agent-probe.ts`: chamada real ao /ask a cada 5min rebaixa 'online'→'degraded' quando o motor de texto morre) + diagnóstico honesto no sync (`agent-sync.ts`). Studio: ComfyUI voltou (14/09) mas o studio-node (worker da fila studio-jobs) está fora — job de imagem fica em 'queued'; precisa reiniciar o processo na máquina RTX.

ANTES (baseline Onda 0, 30 dias, 380 execuções reais):
- bento: total p50 10.7s / p95 44.0s
- jarbas: total p50 6.8s / p95 78.2s
- suzy: total p50 13.5s / p95 70.3s
- otto: total p50 74.1s / p95 608.0s (p95 passava do watchdog da UI)

DEPOIS (13/09, medições ao vivo):
- Jarbas: 27.1s completo com dados reais (eval J01).
- Suzy: 83-86s (eval S01/S02, completos e limpos).
- Otto: backlog de teste drenando em ordem após o fix de serialização; trivial medido em 13s (11/09, Ollama quente).
- Bento: falha honesta em ~0.3-35s (agente fora; sem falso sucesso).
- Ack do POST /chat: ~2.6-3.4s (inalterado esta rodada; UI otimista cobre).

## ARQUIVOS MODIFICADOS (13/09)

- `apps/worker/src/processors/execute-job.ts` (flag por agente, timeout Bento, metadata nos steps, comentário de personalidade)
- `apps/worker/src/processors/execute-job.test.ts` (+5 testes)
- `apps/worker/src/index.ts` (concurrency por agente, expireStaleMemories)
- `packages/tool-gateway/src/clickup-client.ts` (updateTask, createTask rico, uploadTaskAttachment, listStatusesForTask)
- `packages/tool-gateway/src/attributed-task.ts` (campos ricos)
- `packages/database/src/seed.ts` (clickup.update_task na matriz)
- `apps/api/src/clickup/routes.ts` (PATCH /tasks/:id, POST /tasks/:id/attachments, schemas)
- `apps/api/src/tool-calls/routes.ts` (executor clickup.update_task)
- `packages/otto/src/brain/retrieval.ts` + `retrieval.test.ts` (frontmatter STUDIO-BRAIN)
- `.env.example` (flag documentada)
- `docs/agent-prompts/README.md`, `docs/PROMPT-KIMI-K3-AUDITORIA-AGENTES.md` (BL-26)
- `scripts/qa/eval-agents.mts` (nova suíte de evaluation)

## TESTES EXECUTADOS

- Portão Jarbas 5/5 ANTES e DEPOIS.
- Unit: worker 32/32, otto 143/143, api e tool-gateway verdes.
- Eval ao vivo (rubrica 0-100, sinais verificáveis): Suzy 100 e 99; Jarbas 78 (benchmark); Bento 29-54 (fora do ar, falha honesta); Otto 27-37 (máquina lenta, backlog do próprio teste).
- ClickUp real: create rico / update aprovado / anexo / delete aprovado — todos confirmados via leitura direta da API do ClickUp.
- Gates: typecheck verde em todos os pacotes tocados; suíte completa e build no relatório final abaixo.

## PROBLEMAS RESTANTES (bloqueios externos)

1. **Bento fora do ar** — reiniciar Ollama no Mac Mini do Bento (100.93.182.83). Sem isso ele não responde nada. Evidência: 502 em todos os probes de 11-13/09; Ollama 11434 sem resposta.
2. **Máquina do Studio offline** (100.107.198.50 sem resposta desde 11/09) — geração de imagem indisponível.
3. **SSH ausente para as 4 máquinas** — prompts reais de Bento/Suzy/Otto e o pipeline interno deles vivem fora do repo; correções de prompt (BL-07, BL-12, stance do Otto) e streaming SSE dependem desse acesso.
4. **ANTHROPIC_API_KEY** em produção (classifier do router + caption de imagem).
5. **Decisão de web search** (provedor + orçamento) — BL-02.
6. **Autorização** para mover `Brain-Marketing/cerebro/` para fora do vault do Otto (BL-19).
