# Auditoria forense dos agentes Desigual OS

Data: 2026-09-12. Escopo: Bento (foco), Suzy, Otto. Jarbas apenas como baseline, nenhuma alteração proposta nele.

## 0. Arquivos abertos para esta auditoria

Pipeline e dispatch: `apps/api/src/chat/routes.ts`, `apps/api/src/lib/idempotency.ts`, `apps/api/src/lib/operational-context.ts`, `apps/api/src/lib/bento-mention.ts`, `apps/api/src/lib/agent-mention.ts`, `apps/api/src/ws/routes.ts`, `apps/worker/src/index.ts`, `apps/worker/src/processors/execute-job.ts`, `apps/worker/src/processors/agentic-dispatch.ts`, `apps/worker/src/processors/agentic-profiles.ts`, `packages/orchestrator/src/dispatch.ts`, `packages/orchestrator/src/chat-service.ts`, `packages/orchestrator/src/queues.ts`, `packages/orchestrator/src/pubsub.ts`, `packages/orchestrator/src/discovery.ts`, `packages/orchestrator/src/agent-probe.ts`.

Router e contexto: `packages/router/src/route.ts`, `packages/router/src/rules.ts`, `packages/router/src/classifier.ts`, `packages/router/src/marketing-copy.ts`, `packages/context-engine/src/build-context.ts`, `packages/context-engine/src/build-operational-context.ts`, `packages/context-engine/src/resolve-client.ts`, `packages/context-engine/src/resolve-scope.ts`, `packages/context-engine/src/resolve-temporal.ts`, `packages/context-engine/src/briefing-engine.ts`.

Ferramentas e dados: `packages/tool-gateway/src/gateway.ts`, `packages/tool-gateway/src/clickup-client.ts`, `packages/tool-gateway/src/clickup-operation.ts`, `packages/tool-gateway/src/clickup-oauth.ts`, `packages/tool-gateway/src/bento-qa-client.ts`, `packages/tool-gateway/src/agent-ask-client.ts`, `packages/tool-gateway/src/attributed-task.ts`, `packages/tool-gateway/src/webhook.ts`, `apps/api/src/clickup/routes.ts`, `apps/api/src/integrations/clickup-sync.ts`, `apps/api/src/uploads/routes.ts`, `apps/api/src/search/routes.ts`, `apps/api/src/tool-calls/routes.ts`, `apps/api/src/scripts/import-client-memories.ts`, `packages/database/src/schema/clickup.ts`, `packages/database/src/schema/knowledge.ts`, `packages/database/src/seed.ts`.

Loop, memória, aprendizado: `packages/agent-runtime/src/loop.ts`, `packages/agent-runtime/src/evaluator.ts`, `packages/agent-runtime/src/state.ts`, `packages/agent-runtime/src/loop.test.ts`, `packages/orchestrator/src/memory-engine.ts`, `packages/orchestrator/src/learning.ts`, `packages/orchestrator/src/proactivity.ts`, `packages/otto/src/learning/pipeline.ts`, `packages/otto/src/learning/feedback.ts`.

Otto e nodes: `packages/otto/src/creative/planner.ts`, `packages/otto/src/creative/dna.ts`, `packages/otto/src/creative/stance.ts`, `packages/otto/src/creative/quality.ts`, `packages/otto/src/creative/schemas.ts`, `packages/otto/src/creative/caption-from-image.ts`, `packages/otto/src/brain/retrieval.ts`, `packages/otto/src/brain/depth.ts`, `packages/otto/src/llm/ollama-provider.ts`, `packages/otto/src/llm/config.ts`, `packages/otto/src/llm/json-extract.ts`, `nodes/otto-node/src/execute.ts`, `nodes/desigual-node/src/execute.ts`, `nodes/desigual-node/src/obsidian/reader.ts`, `nodes/studio-node/src/visual-qa.ts`.

Prompts e tipos: `packages/types/src/personalities.ts`, `packages/types/src/text.ts`, `packages/types/src/index.ts`, `docs/agent-prompts/README.md`, `docs/agent-prompts/bento.md`, `docs/agent-prompts/jarbas.md`.

Front: `apps/web/src/hooks/use-send-chat-message.ts`, `apps/web/src/hooks/use-executions.ts`, `apps/web/src/components/chat/chat-thread.tsx`, `apps/web/src/lib/realtime/ws-client.ts`, `apps/web/src/lib/api/client.ts`.

Vaults e docs: `brain/` (17 arquivos amostrados, incluindo 00, 01, 02, 03, Decisoes.md, 99, Agentes/Bento.md), `Brain-Marketing/` raiz (8 arquivos), `Brain-Marketing/STUDIO-BRAIN/` (amostra de 5+ pastas, frontmatter conferido), `Brain-Marketing/cerebro/` (10 arquivos raiz), `arquivos clientes/` (índice, operação, conflitos, amostra de CLIENTES/), arquivos de cliente da raiz (19 + `_index.md`, `_template-cliente.md`, `specialist.md`), `.agents/skills/carrossel-cinema-impossivel/SKILL.md`, `DESIGUAL_OS_CONTEXT_RECOVERY.md`, `docs/agentic/EVALS.md`, `docs/architecture/decisions/0004-anthropic-sdk-classifier.md`, `docs/PROMPT-KIMI-K3-AUDITORIA-AGENTES.md`, `.env.example`, `.gitignore`.

## 1. Sumário executivo

Cinco causas raiz explicam quase toda a "burrice" percebida. Nenhuma é modelo ruim; todas são engenharia.

1. **Os agentes estão amputados, não burros.** O modelo não recebe lista de ferramentas e não existe function calling: `tool_calls: []` é fixo no código (`nodes/otto-node/src/execute.ts:402`). Não existe `updateTask` no ClickUp (zero ocorrências de `PUT /task` no repo), não existe upload de anexo para task, não existe pesquisa web. Criar task existe; editar, anexar e pesquisar são estruturalmente impossíveis hoje. Ganho ao corrigir: os pedidos 2, 3, 5 e 6 do dono para o Bento passam de impossíveis a possíveis.
2. **O turno é one-shot.** Cada dispatch é exatamente um `fetch` HTTP (`packages/tool-gateway/src/bento-qa-client.ts:67`, `agent-ask-client.ts:53`). O loop agêntico com fases, checkpoint e avaliador existe, está testado (12 testes verdes) e está desligado por configuração (`AGENT_LOOP_V2=false`, `apps/worker/src/processors/execute-job.ts:42`, `.env.example:37`). Sem loop não há decomposição, verificação nem correção de rota. Ganho: agentes que conferem o próprio trabalho antes de responder.
3. **Os prompts de produção proíbem o raciocínio que o dono está pedindo.** O Bento vive sob "ou está no vault, ou você não sabe" e "Fonte ou silêncio" (`packages/types/src/personalities.ts:47,65`): binário que não distingue fato de inferência legítima. A Suzy tem 606 caracteres de tom de voz e zero método de venda. Agravante: desde 09/09/2026 a personalidade nem chega aos serviços (`PREPEND_PERSONALITY` vazio, `personalities.ts:166`). Ganho: fato com fonte mais raciocínio rotulado, em vez de recusa ou citação seca.
4. **Conhecimento morto e mal indexado.** `brain/` (o vault mais confiável do projeto) não é lido por nenhum código. Os 19 arquivos de cliente da raiz não são lidos por nenhum código e divergem de `arquivos clientes/`. `Brain-Marketing/cerebro/` contém ~200 KB de documentação de outro produto (Orvyn/Nyro). 154 dos 155 documentos do STUDIO-BRAIN usam um frontmatter que o parser do Otto não lê. Zero busca semântica no repo (tabela `embeddings` é jsonb sem produtor nem consumidor). Ganho: o agente passa a achar o documento certo para a pergunta real.
5. **Lentidão arquitetural, não de modelo.** Não existe streaming em lugar nenhum: o usuário espera o turno inteiro e recebe um único `message.delta` com a resposta completa (`apps/worker/src/processors/execute-job.ts:618-633`). O Otto roda em CPU a ~10 tokens/s com planos de ~1.000 tokens e até 4 gerações sequenciais por carrossel. O classificador Anthropic provavelmente nunca rodou em produção (chave vazia, ADR 0004 admite não testado). Ganho: percepção de fluidez imediata com streaming e redução real de 30 a 60% do tempo de ponta a ponta.

Divergências do briefing inicial contra o código (o código venceu): a personalidade não está sendo anexada à mensagem desde 09/09/2026; o timeout da Suzy já é 180s, não 60s; o Bento no chat usa 100s efetivos, não 120s; os prompts de `docs/agent-prompts/` têm 28.565 e 21.022 caracteres, não 9 a 13 mil; o briefing-engine está sim ligado ao fluxo do Bento (a hipótese "motor bom que ninguém chama" é falsa, ele é chamado em `apps/api/src/lib/operational-context.ts:119-127`).

## 2. Mapa de verdade do sistema

Caminho de uma mensagem de chat web. Entre colchetes, o orçamento ou corte naquele ponto.

```
[WEB] apps/web/src/hooks/use-send-chat-message.ts:38
  POST /chat {message, client_id, agent_hint, attachments<=10}
   |
   v
[API: validação e conversa] apps/api/src/chat/routes.ts
  auth :69 | zod :71 | idempotência Redis 15s (lib/idempotency.ts:16, timeout 3s)
  resolveClientFromText :176/:213 (reescrita 1: detecta cliente no texto livre,
    resolve-client.ts:167, tiers exact>short>word>fuzzy)
  título da conversa TRUNCADO em 80 chars :228
  mensagem do usuário persistida :244-257 (anexos só em metadata)
   |
   v
[ROUTER] packages/router/src/route.ts:46-103 (4 camadas)
  menção explícita :29-37 (confidence 1) >
  rules.ts:130 substring (intenção 0.7+0.15/hit; assunto teto 0.65 < limiar 0.7) >
  classifier.ts: claude-sonnet-4-5, timeout 10s, max_tokens 512, maxRetries 0
    [provavelmente inativo em produção: sem ANTHROPIC_API_KEY, ADR 0004] >
  fallback: bento com confidence baixa :93-102
   |
   v
[CONTEXT ENGINE] em paralelo, routes.ts:268-277
  build-context.ts orçamentos :39-44:
    5 mensagens recentes | dossiê do cliente TRUNCADO em 3000 chars
    5 arquivos de projeto x 2000 chars (preview formatado corta a 500, :216)
    3 aprendizados x 300 chars | só memórias active e não expiradas
  operational-context.ts:72 -> ClickUp AO VIVO (clickup-operation.ts:
    MAX_PAGES 20 :112, timeout 20s/req :114; truncamento vira aviso explícito)
  briefing-engine.ts quando scope=briefing: dossiê 600 chars :200,
    até 8 prioridades :235, campos KNOWN/DERIVED/MISSING
   |
   v
[MONTAGEM DA MENSAGEM] routes.ts:317-346 (reescrita 2, assimétrica)
  BENTO: só a pergunta crua; bloco de contexto SUPRIMIDO (:302,
    contextoEnvenenaBusca: consulta vetorial degradava de 51 para 1694 chars);
    contexto operacional vai em campo separado operational_context :326/:355.
    Custo conhecido: sem histórico, sem dossiê, follow-up sem fio (:293-297).
  JARBAS/SUZY: mensagem + bloco Contexto; bloco operacional NUNCA (:336-342,
    disparava edge case job_via_whatsapp no serviço remoto).
  OTTO/STUDIO: recebem tudo na mensagem.
  SEM teto global de caracteres na mensagem montada.
   |
   v
[DISPATCH] orchestrator/dispatch.ts:21 -> chat-service.ts:37
  circuit breaker :42-50 (sem node saudável = 503, nunca enfileira)
  executions (queued, prioridade P1/P2/P3) :59-71 | router_decisions :77-85
  BullMQ queue-<agent> (queues.ts:114); tentativas: jarbas/suzy = 1,
    bento/otto/studio = 2 (:73-79)
  POST /chat responde 202 com execution_id :372-378 (assíncrono daqui em diante)
   |
   v
[WORKER] apps/worker/src/processors/execute-job.ts:718
  só Otto ganha brand kit + feedbacks (recallMemories 30 + 20, :764-798)
  withPersonality :347 é NO-OP (PREPEND_PERSONALITY vazio, personalities.ts:166)
  callNode :349-368 (reescrita 3 desligada; bifurcação real):
    bento  -> POST {bento-qa}/ask      (bento-qa-client.ts:67) timeout EFETIVO 100s
    jarbas -> POST {agentes}/internal/ask 100.118.12.97:3102, 180s
    suzy   -> POST {susy}/internal/ask   100.86.237.73:3102, 180s
    otto/studio -> POST node /execute, 360s / 1500s (queues.ts:30-38)
  AGENT_LOOP_V2=false (:42): one-shot. Ligado: loop envolve a MESMA chamada
    HTTP; replan = mesma chamada sem blocos de contexto (agentic-dispatch.ts:124-130)
   |
   v
[LLM]
  bento/jarbas/suzy: dentro do serviço externo opaco (bento-qa usa Ollama
    llama3.1:8b remoto + busca vetorial própria; fora deste repo)
  otto: Ollama local, OTTO_MODEL default mistral (produção: qwen3.5:4b em CPU,
    ~10 tok/s), stream:false, num_ctx 16384, think:false (136x mais rápido)
  FERRAMENTAS VISÍVEIS AO MODELO NESTE PONTO: nenhuma. tool_calls=[] fixo.
   |
   v
[PÓS-PROCESSAMENTO] execute-job.ts:846 e :1056
  stripEmDashes (text.ts:37-54, protege citações com sentinelas)
  stripBlockMarkers :64-71 ([FIM_BLOCO] vira parágrafo)
  stripMarkdownArtifacts :84-96 (nenhum canal renderiza markdown)
   |
   v
[PERSISTÊNCIA] execute-job.ts:876-969 (try/catch que nunca relança)
  executions, execution_steps, messages (assistant), token_usage,
  economy_records, audit_logs, notifications (corpo truncado em 140 :707)
  memories: SÓ no ciclo criativo do Otto :576-616
   |
   v
[ENTREGA] SEM streaming
  um único message.delta {texto inteiro, done:true} :634-660
  Redis pub/sub -> WS /ws (api/src/ws/routes.ts:37) -> balão otimista
  fallbacks: poll GET /executions/:id a cada 700ms (use-executions.ts:29-32),
  watchdog de 6min (chat-thread.tsx:87)
```

Entradas alternativas: menção no ClickUp (`apps/api/src/clickup/routes.ts` -> `lib/bento-mention.ts` / `lib/agent-mention.ts`, com fallback real de busca na memory-api só para o Bento, `bento-mention.ts:37-55`); automações (worker separado, concurrency 5); workflow multi-agente (`dispatch.ts`, contribuições limitadas a 3 x 1200 chars, `execute-job.ts:1236-1238`).

## 3. Tabela de bloqueios

Ordenada por (impacto x frequência de uso) / esforço, decrescente. Confiança: A = evidência direta em código, B = evidência indireta, H = hipótese não verificada.

| ID | Agente | Capacidade afetada | Bloqueio | Evidência (arquivo:linha) | Causa raiz | Impacto | Esforço | Confiança |
|---|---|---|---|---|---|---|---|---|
| BL-01 | Bento | Editar task | Não existe `updateTask` nem `PUT /task/{id}` em lugar nenhum do repo; zero ocorrências de `updateTask` e `PUT.*task` | `packages/tool-gateway/src/clickup-client.ts:97-215` (só create, delete, comments, getTaskListId) | FERRAMENTA AUSENTE | 5 | 2 | A |
| BL-02 | Bento, Suzy, Otto | Pesquisa com dado real | Nenhuma ferramenta de busca web; grep por tavily/serper/brave/duckduckgo = zero; `apps/api/src/search/routes.ts:25-41` é ILIKE interno | `packages/tool-gateway/src/gateway.ts`, `packages/database/src/seed.ts:31-67` (matriz sem web) | FERRAMENTA AUSENTE | 5 | 3 | A |
| BL-03 | Todos | Uso de ferramenta pelo modelo | Modelo nunca recebe lista de ferramentas; sem function calling; `tool_calls: []` fixo | `nodes/otto-node/src/execute.ts:402,494,519`, `nodes/desigual-node/src/execute.ts:56,67` | FERRAMENTA INVISÍVEL | 5 | 4 | A |
| BL-04 | Bento, Suzy | Raciocínio multi-passo | Turno one-shot (1 fetch); loop V2 existe testado mas `AGENT_LOOP_V2=false`; replan é só "mesma chamada com texto reduzido" | `apps/worker/src/processors/execute-job.ts:42`, `agentic-dispatch.ts:124-130`, `.env.example:37` | ARQUITETURA DE LOOP | 5 | 4 | A |
| BL-05 | Bento | Anexo para ClickUp | Nenhuma chamada a `POST /task/{id}/attachment`; anexos ficam no Supabase Storage e nunca vão ao ClickUp | `apps/api/src/uploads/routes.ts:55-56`, ausência em `clickup-client.ts` | FERRAMENTA AUSENTE | 4 | 3 | A |
| BL-06 | Bento, Suzy, Otto | Ver imagem anexada | Anexo vira uma linha de texto (nome + mimetype); imagem nunca é baixada; provider Ollama só aceita string; modelos configurados não são multimodais | `nodes/otto-node/src/execute.ts:151-154`, `packages/otto/src/llm/ollama-provider.ts:20-23`, `packages/context-engine/src/build-context.ts:235` | FERRAMENTA AUSENTE | 4 | 3 | A |
| BL-07 | Bento | Prompt binário | "ou está no vault, ou você não sabe" + "Fonte ou silêncio": sem categoria para inferência rotulada; mata raciocínio estratégico e pesquisa | `packages/types/src/personalities.ts:47,49,61,65` | PROMPT | 4 | 1 | A |
| BL-08 | Bento | Continuidade de conversa | Bento recebe só a pergunta crua (bloco de contexto suprimido de propósito); follow-up não tem fio | `apps/api/src/chat/routes.ts:293-302` | CONTEXTO NÃO RECUPERADO | 4 | 3 | A |
| BL-09 | Otto | Recuperação do Brain | 154/155 docs do STUDIO-BRAIN usam frontmatter `type/domain/topic` que o parser não lê (só lê `titulo/intencoes/escopo/dominio/framework`); pesos 5/4/3 quase nunca disparam | `packages/otto/src/brain/retrieval.ts:155-163` vs `STUDIO-BRAIN/00_SYSTEM/AGENT.md:1-12` | CONTEXTO NÃO RECUPERADO | 4 | 2 | A |
| BL-10 | Todos | Busca semântica | Zero embeddings em produção; tabela `embeddings` é jsonb sem produtor nem consumidor; retrieval do Otto é 100% lexical | `packages/database/src/schema/knowledge.ts:49-68`, `retrieval.ts:311-337` | CONTEXTO NÃO RECUPERADO | 4 | 4 | A |
| BL-11 | Todos | Fluidez percebida | Sem streaming: um único `message.delta` com a resposta inteira no fim; Ollama com `stream:false` | `apps/worker/src/processors/execute-job.ts:618-633`, `packages/otto/src/llm/ollama-provider.ts:134` | LATÊNCIA | 4 | 3 | A |
| BL-12 | Suzy | Método de venda | Prompt de 606 chars é só tom de voz e regra de canal; zero qualificação, diagnóstico, objeção, cadência, handoff | `packages/types/src/personalities.ts:81-93`; inexistência de `docs/agent-prompts/suzy.md` | PROMPT | 4 | 1 | A |
| BL-13 | Otto | Latência de geração | Plano criativo exige JSON de 18 campos (~700-1200 tokens) em CPU a ~10 tok/s; carrossel = 2 a 4 gerações sequenciais; pior caso estoura 360s | `packages/otto/src/creative/schemas.ts:59-78`, `nodes/otto-node/src/execute.ts:439-443`, `packages/orchestrator/src/queues.ts:30-38` | MODELO | 4 | 3 | A |
| BL-14 | Otto | Concorrência | Worker aceita 5 jobs Otto; node não serializa; Ollama em CPU serializa de fato; segundo job paga o tempo do primeiro dentro do próprio timeout | `apps/worker/src/index.ts:62-67`, `nodes/otto-node/src/execute.ts:276` | LATÊNCIA | 4 | 2 | A |
| BL-15 | Bento | Criar task completa | `createTask` aceita só name/description/assignees: sem tags, prioridade, due_date, parent | `packages/tool-gateway/src/clickup-client.ts:97` | FERRAMENTA AUSENTE | 4 | 2 | A |
| BL-16 | Bento | Custom fields | Zero código lê ou escreve custom fields do ClickUp | grep `custom_field` = 0; `clickup-client.ts:163-166` (parse só de id e list.id) | DADO AUSENTE | 3 | 2 | A |
| BL-17 | Bento | Visão macro ClickUp | Hierarquia só varre folders com "cliente" no nome; listas folderless e demais folders invisíveis | `packages/tool-gateway/src/clickup-oauth.ts:156,184` | DADO AUSENTE | 3 | 2 | A |
| BL-18 | Todos | Conhecimento do projeto | `brain/` (vault mais confiável) não é lido por nenhum código; idem 19 arquivos de cliente da raiz, que divergem de `arquivos clientes/` (19 vs 48 registros) | `.gitignore:29`; grep sem leitores; `arquivos clientes/INDICE_CLIENTES.md` vs `_index.md` | CONHECIMENTO MORTO | 3 | 2 | A |
| BL-19 | Otto | Contaminação de vault | `Brain-Marketing/cerebro/` contém ~200 KB de outro produto (Orvyn/Nyro), sem frontmatter, dentro do diretório do Otto | `Brain-Marketing/cerebro/RAG/RAG.md:1` | CONHECIMENTO MORTO | 3 | 1 | A |
| BL-20 | Todos | Memória que não volta | Kinds gravados (`studio.asset_created`, `clickup.clients_synced` etc.) nunca são recuperados; recall só busca 5 kinds; `expireStaleMemories` e todo `proactivity.ts` sem call sites | `packages/orchestrator/src/memory-engine.ts:340`, `packages/orchestrator/src/proactivity.ts` (zero call sites fora de testes) | DADO AUSENTE | 3 | 2 | A |
| BL-21 | Otto | Instruções impossíveis | Prompt manda decidir papel de referências que ele nunca vê, fazer QC de imagem sem imagem, pedir seeds que nunca entram no contexto | `packages/otto/src/creative/planner.ts:62,93-95`, `creative/quality.ts:21`, `personalities.ts:107` | PROMPT | 3 | 1 | A |
| BL-22 | Todos | Roteamento | Classifier claude-sonnet-4-5 provavelmente nunca roda em produção (sem ANTHROPIC_API_KEY); tudo cai no rule engine ou fallback Bento | `docs/architecture/decisions/0004-anthropic-sdk-classifier.md`, `.env.example:81`, `packages/router/src/route.ts:90-102` | MODELO | 3 | 1 | A |
| BL-23 | Bento | Timeout real | Caminho do chat não passa `timeoutMs`: Bento usa default de 100s do cliente, não os 120s declarados | `apps/worker/src/processors/execute-job.ts:123` vs `packages/tool-gateway/src/bento-qa-client.ts:63` | LATÊNCIA | 2 | 1 | A |
| BL-24 | Todos | Permissões | Tool Gateway só protege 1 ação (delete task); demais ferramentas da matriz nunca passam pelo gateway | `packages/tool-gateway/src/gateway.ts:15-23`, único call site `apps/api/src/clickup/routes.ts:242` | PERMISSÃO | 2 | 2 | A |
| BL-25 | Bento | Espelho ClickUp | Schema `clickup.ts` declarado espelho mas nunca populado (zero inserts) | `packages/database/src/schema/clickup.ts:7` | DADO AUSENTE | 2 | 3 | A |
| BL-26 | Todos | Documentação | Docs e comentários desalinhados: README diz 9-13k chars (real: 28,5k/21k), PROMPT-KIMI diz Suzy em 100.118.12.97 (código: 100.86.237.73), comentários dizem que personalidade é injetada (desligada) | `docs/agent-prompts/README.md:18`, `docs/PROMPT-KIMI-K3-AUDITORIA-AGENTES.md:257`, `execute-job.ts:342-346` | CONHECIMENTO MORTO | 2 | 1 | A |

## 4. Dossiê por agente

### 4.1 BENTO

**Estado atual (com evidência).** O Bento responde perguntas institucionais via serviço externo `bento-qa` (`POST /ask`, `packages/tool-gateway/src/bento-qa-client.ts:67`), que faz busca vetorial no vault local dele e gera com Ollama `llama3.1:8b` (registrado em `brain/99 - Pendencias.md`, sessão 2026-09-04). O repo exige resposta com citação: "ok" sem fonte vira erro `sem-fonte` (`bento-qa-client.ts:102-104`). Recebe contexto operacional ao vivo do ClickUp em campo separado (`apps/api/src/chat/routes.ts:326,355`), incluindo briefing com procedência KNOWN/DERIVED/MISSING (`packages/context-engine/src/briefing-engine.ts:101-109`). Cria tasks simples (`clickup-client.ts:97`), comenta e lê comentários (`:146,196,215`). Tem fallback honesto na menção do ClickUp via memory-api (`bento-mention.ts:37-55`).

O que ele NÃO consegue hoje: editar task (BL-01), anexar imagem em task (BL-05), ver imagem (BL-06), pesquisar na web (BL-02), ler custom fields (BL-16), ver a hierarquia inteira do ClickUp (BL-17), lembrar da conversa anterior (BL-08), e raciocinar estrategicamente sem violar o próprio prompt (BL-07). Também não tem loop: uma chamada, uma resposta (BL-04).

**Ponto cego.** O system prompt real do Bento vive no `bento-qa` em 100.93.182.83, fora do repo, assim como o código do serviço, o conteúdo do vault e a configuração de `OBSIDIAN_VAULT_PATH`. Procedimento exato de inspeção (rodar na máquina ou via SSH):

```bash
ssh <usuario>@100.93.182.83
# 1. Código e prompt real do serviço
ps aux | grep -E 'bento|node' ; launchctl list | grep -i bento
cat ~/bento-qa/src/*.js            # localizar bentoAsk.js e o system prompt
wc -m <arquivo-do-system-prompt>   # medir o prompt efetivo
# 2. Vault: tamanho, estrutura, qualidade
ls "$OBSIDIAN_VAULT_PATH" | head -50
grep -rL '^---' "$OBSIDIAN_VAULT_PATH" --include='*.md' | head  # sem frontmatter
# 3. Saúde das portas
curl -s http://localhost:8791/health ; curl -s http://localhost:8790/health
# 4. Prova de fogo do canal: medir degradação por tamanho
for n in 500 1000 1500 2000 2500; do
  q=$(printf 'pergunta teste %.0s' $(seq 1 $((n/14))))
  curl -s -X POST http://localhost:8791/ask -H "Authorization: Bearer $BENTO_QA_TOKEN" \
    -d "{\"question\":\"$q\",\"channel\":\"whatsapp\"}" | jq '{status, n_cit: (.citations|length)}'
done
```

**Bloqueios ordenados:** BL-01, BL-02, BL-04, BL-05, BL-06, BL-07, BL-08, BL-15, BL-16, BL-17, BL-03, BL-10, BL-23, BL-25.

**Prompt proposto** (1.725 caracteres, medido; destino correto: system prompt dentro do `bento-qa`, não o canal de mensagem, pois 1.725 + contexto + pergunta estouraria os ~2.000 medidos):

```
Você é o Bento, a inteligência institucional da Agência Desigual: memória viva (processos, SOPs, histórico de clientes, decisões, aprendizados) e leitura da operação no ClickUp. Arquétipo: O Arquivista Chefe.

COMO VOCÊ DECIDE: toda resposta separa duas camadas. FATO: só o que está no vault ou no dado do ClickUp que você recebeu no turno, sempre com fonte (📎 caminho do documento ou id da task). RACIOCÍNIO: sua leitura estratégica sobre os fatos (prioridade, risco, gargalo, sequência, o que puxar pra frente). Raciocínio é permitido e esperado, mas vem rotulado ("Minha leitura:") e nunca se apresenta como fato. Quando faltar dado, declare a lacuna (⚠️) e proponha como preenchê-la.

Você não sabe nada que não esteja no vault ou no dado recebido. Mas não pare no "não encontrei": diga o que existe próximo, entregue a inferência rotulada e sugira o que registrar.

CLICKUP: quando receber contexto operacional, raciocine sobre a operação inteira (status, responsáveis, prazos, gargalos), não sobre uma task isolada. Se faltar dado para responder, diga exatamente qual dado falta.

VOZ: preciso e humano, colega de confiança que conhece a casa há anos. Resposta primeiro, contexto essencial depois, fonte por último. Contrações naturais ("tá", "pra"). Trata por "você". Pergunta institucional nunca se responde com jargão de infraestrutura.

EMOJIS: raros, máx 1 por bloco. 📎 fonte, ⚠️ lacuna.

FORMATAÇÃO: blocos de até 400 caracteres, [FIM_BLOCO]. Fonte no bloco final.

NUNCA: chutar fato, citar doc técnico como resposta institucional, misturar dados de clientes diferentes, escrever no vault, travessão, "depende" sem explicação.

MANTRA: Fonte para o fato, leitura para a decisão, silêncio para o que você não tem.
```

Diff conceitual contra o atual (1.516 chars) e razão, ligada ao bloqueio:
- Nova seção COMO VOCÊ DECIDE com as camadas FATO / RACIOCÍNIO / lacuna: corrige BL-07 preservando a honestidade de fonte. É a formulação que separa fato (fonte obrigatória) de raciocínio (rótulo obrigatório). Importa o espírito das seções 9, 10, 24 e 25 de `docs/agent-prompts/bento.md` em 4 linhas.
- "não pare no não encontrei": importa bento.md seção 10, transforma recusa em entrega parcial com próximo passo (BL-07).
- Seção CLICKUP nova: libera e orienta o raciocínio macro sobre a operação, que é o pedido 1 do dono (BL-07, BL-17).
- "misturar dados de clientes diferentes" no NUNCA: importa bento.md seções 20 e 52, crítico num RAG multi-cliente, ausente hoje.
- Removido "PERMISSÕES: ler/escrever ClickUp..." porque a frase prometia escrita que não existe (BL-01) e permissão é responsabilidade do gateway, não do prompt.
- Mantra novo substitui "Fonte ou silêncio" (o binário que matava o raciocínio) mantendo o padrão de honestidade.
- Voz, emojis, formatação e proibição de jargão: mantidos, já funcionam.

**Ferramentas a implementar** (todas em `packages/tool-gateway/src/`, expostas via rotas em `apps/api/src/clickup/routes.ts` e registradas no gateway):

```ts
// clickup-client.ts
updateTask(taskId: string, patch: {
  name?, description?, status?, assignees?, priority?, due_date?, tags?, parent?
}): Promise<{ id: string; status: string }>          // PUT /task/{id}
uploadTaskAttachment(taskId: string, file: { filename: string; data: Buffer }):
  Promise<{ id: string; url: string }>                // POST /task/{id}/attachment
getTaskFull(taskId: string): Promise<TaskComCustomFields>  // GET /task/{id} sem schema restritivo
// clickup-oauth.ts
getFullHierarchy(teamId: string): Promise<Space[]>
  // remove o filtro clientFolderStatus (:156) ou o torna opcional; inclui listas folderless
// gateway.ts: registrar as 4 acima na matriz com policy por agente
```

Como o agente vai saber que elas existem: duas vias. Curto prazo (sem SSH): o worker detecta intenção de escrita ("marca como concluída", "anexa isso na task") por regra e executa a ferramenta na borda, como já faz com `[AGUARDA_APROVACAO]` (`execute-job.ts:278-307`). Médio prazo: loop V2 com catálogo de ferramentas no system e function calling, com o gateway como executor (BL-03, BL-04). A política de aprovação humana para escrita já existe (`requestToolCall`, `gateway.ts:36-76`) e deve ser estendida a updateTask e uploadTaskAttachment.

**Mudanças de recuperação de conhecimento:** indexar `brain/` e os dossiês de `arquivos clientes/CLIENTES/` na memory-api do Bento (hoje o vault dele é ponto cego); no repo, migrar a tabela `embeddings` para pgvector e dar a ela produtor (ingestão) e consumidor (recall), hoje ambos zero (BL-10); popular o espelho `clickup.ts` via `clickup-sync.ts` para consultas agregadas sem ir à API a cada turno (BL-25).

**Critérios de aceite (viram suíte de teste):**
1. "Quais tasks do cliente X estão bloqueadas há mais de 5 dias e o que puxo pra frente hoje?": resposta boa contém números reais do ClickUp, fonte por afirmação factual, recomendação priorizada rotulada como "Minha leitura:", e lacuna explícita se faltar dado.
2. "Cria uma task de revisão de carrossel pro cliente Y na lista de conteúdo, prazo sexta, prioridade alta": task criada com todos os campos (hoje falha em prazo e prioridade, BL-15).
3. "Marca a task T como em revisão e passa pro João": task editada de verdade (hoje impossível, BL-01).
4. "Sobe esse print na task T": anexo interpretado e anexado no ClickUp com comentário (hoje impossível, BL-05/BL-06).
5. "E na semana passada, como tava?" logo após uma pergunta operacional: follow-up resolvido com fio da conversa (hoje sem histórico, BL-08).
6. "Pesquisa o benchmark atual de CPL para clínicas odontológicas no Meta Ads": resposta com dado externo e URL real citada, ou declaração de que não tem ferramenta de pesquisa (hoje a segunda opção é a única honesta, BL-02).
7. "Me explica o que é a Desigual": resposta institucional com fonte do vault, sem jargão de infraestrutura (já funciona, manter como não regressão).
8. Pergunta sem resposta no vault: "Não encontrei" + o que existe próximo + sugestão de registro, nunca silêncio puro nem chute.

### 4.2 SUZY

**Estado atual.** A Suzy responde via `susy-service` em 100.86.237.73:3102 (`apps/worker/src/processors/execute-job.ts:156`), mesma arquitetura one-shot do Bento, com `sessionId = conversationId` dando histórico do lado do serviço (`execute-job.ts:358`). Timeout 180s, 1 tentativa de propósito (`packages/orchestrator/src/queues.ts:13-18,73-79`). Tem barreira de aprovação humana real via `[AGUARDA_APROVACAO]` (`execute-job.ts:278-307`). O prompt de produção (606 chars, `personalities.ts:81-93`) é tom de voz, ritmo de WhatsApp, limites de canal e mantra. Não existe arcabouço de social selling: nada de qualificação, diagnóstico, objeção, cadência de follow-up, próxima melhor ação por estágio ou critério de handoff. Não existe `docs/agent-prompts/suzy.md`: ela é a única sem manual de prateleira.

**Ponto cego.** O código do `susy-service` e o prompt real dela vivem fora do repo. Inspeção análoga à do Bento, em 100.86.237.73, porta 3102 (`/health` existe, `packages/orchestrator/src/agent-probe.ts:66-68`). Verificar também como o serviço consome `bentoAsk.js` (`.env.example:118-120` indica que a Suzy divide o cérebro do Bento).

**Bloqueios ordenados:** BL-12, BL-04, BL-03, BL-02, BL-06.

**Prompt proposto** (1.741 caracteres, medido; destino: system prompt do `susy-service`):

```
Você é a Suzy, social selling da Agência Desigual: Instagram e WhatsApp. Arquétipo: A Closer Carismática.

MÉTODO: toda conversa tem um estágio e uma próxima melhor ação. Estágios: contato frio, conversa aberta, diagnóstico, proposta, agendamento, follow-up, handoff. Antes de responder, identifique o estágio e escolha a ação que move o lead um passo adiante. Toda mensagem sua termina com o próximo passo claro.

DIAGNÓSTICO ANTES DE OFERTA: descubra dor, objetivo e contexto antes de falar de preço ou serviço. Uma pergunta por vez, a pergunta certa para o estágio.

QUALIFICAÇÃO: ao longo da conversa, descubra quem decide, necessidade real, urgência e capacidade de investimento. Lead sem necessidade real não avança: registre e encerre com elegância.

OBJEÇÃO: nunca discuta. Valide, entenda a raiz ("o que te faz pensar isso?"), responda curto e volte para o próximo passo. "Vou pensar" significa falta de informação ou de urgência: descubra qual.

FOLLOW-UP: lead que espera esfria, responda rápido. Sem resposta, reaborde com valor novo (um caso, uma ideia, um dado), nunca com "viu minha mensagem?". Três tentativas sem retorno: encerre deixando a porta aberta.

HANDOFF: proposta aceita, reunião marcada ou sinal forte de compra: passe para o humano com resumo do lead, estágio e o que ficou combinado.

VOZ: calorosa, frases curtas, ritmo de WhatsApp. Contrações naturais ("tô", "pra"), nunca "vc"/"mto".

NUNCA: mexer em Meta Ads (é do Jarbas), publicar no Instagram sem confirmação humana, prometer o que a agência não entrega, pressionar lead frio, travessão.

EMOJIS: 😊🙌✨💜, máx 1-2 por mensagem.
FORMATAÇÃO: blocos curtos com [FIM_BLOCO], imitando conversa real.

MANTRA: Do outro lado tem gente. Toda mensagem move um passo.
```

Diff conceitual contra o atual (606 chars): adiciona MÉTODO por estágio, DIAGNÓSTICO, QUALIFICAÇÃO, OBJEÇÃO, FOLLOW-UP e HANDOFF (todo o arcabouço de venda, BL-12); mantém integralmente voz, emojis, formatação, limites de canal e o mantra original como primeira metade do mantra novo. Cresce 1.135 chars, dentro do envelope medido de ~2.000 a 2.500 para mensagem combinada, desde que implantado como system prompt do serviço e não empilhado com contexto na mesma mensagem.

**Ferramentas a implementar:** `logLeadStage(conversationId, stage, summary)` gravando em `memories` (kind `suzy.lead_stage`, com recall no turno seguinte, fechando o ciclo de BL-20); `scheduleFollowUp(leadId, when, reason)` usando o scheduler já existente (`apps/api/src/health/scheduler.ts` como referência de infra); `getConversationHistory(conversationId)` explícita, hoje implícita via sessionId. Descoberta: mesmas duas vias do Bento.

**Mudanças de recuperação:** perfil do lead e histórico resumido injetados no turno (hoje o bloco Contexto vai, mas sem estágio nem qualificação acumulada); análise de perfil de Instagram exige ferramenta nova, candidata à Onda 2.

**Critérios de aceite:**
1. Lead frio manda "quanto custa?": resposta com UMA pergunta de diagnóstico, sem preço, sem pressão.
2. "Tá caro": validação + pergunta de raiz + próximo passo; nunca desconto automático nem discussão.
3. Lead parou de responder há 5 dias: follow-up com valor novo, não cobrança.
4. Lead diz "pode fechar, como pago?": handoff com resumo do lead, estágio e combinado; nada de tentar cobrar sozinha.
5. "Analisa essa conversa e me diz o que fazer": diagnóstico por estágio + próxima melhor ação + objeção identificada.
6. Pedido para publicar no Instagram: exige confirmação humana (`[AGUARDA_APROVACAO]`), mantendo o comportamento atual como não regressão.
7. Pergunta sobre Meta Ads: recusa e aponta o Jarbas, sem executar nada.

### 4.3 OTTO

**Estado atual.** Único agente com prompt real no repo: `AGENT_PERSONALITIES.otto` (3.261 chars) é system prompt de verdade em `packages/otto/src/creative/planner.ts:54` e `nodes/otto-node/src/execute.ts:212`. Roda Ollama local (`OTTO_MODEL` default `mistral`, produção `qwen3.5:4b` em CPU, ~10 tok/s), com mitigações sérias já medidas: `think:false` (136x), `num_ctx` 16.384, `keep_alive` 30m, profundidade FAST/STANDARD/DEEP (`packages/otto/src/brain/depth.ts:268-280`). Recuperação lexical do Brain com IDF caseiro e cache por mtime (`retrieval.ts:177-196,363-401`). Plano criativo validado por Zod com uma correção de JSON (`ollama-provider.ts:220-237`). Funil de confiança do learning completo (`packages/otto/src/learning/pipeline.ts`). Recebe brand kit e feedbacks no job (`execute-job.ts:764-798`).

Limites reais: não vê imagens (BL-06); o prompt manda fazer três coisas estruturalmente impossíveis (BL-21); 96% do STUDIO-BRAIN não conversa com o parser (BL-09); carrossel/vídeo custam 2 a 4 gerações sequenciais em CPU (BL-13); concorrência não serializada (BL-14); instrução de perguntar a etapa do funil causava paralisia medida (4/4 respostas devolviam pergunta e nada de trabalho, `stance.ts:8-13`).

**Ponto cego.** Comportamento real do modelo em produção (qualidade do JSON do qwen3.5:4b por tarefa) só é verificável com logs do node: `classify_ms/retrieval_ms/llm_ms/total_ms` já vão na metadata (`execute.ts:233-238,389-394`); basta consultar `executions` e `execution_steps` dos últimos 30 dias. Não verifiquei a fila real nem o `.env` da máquina.

**Bloqueios ordenados:** BL-13, BL-09, BL-06, BL-14, BL-21, BL-19, BL-10, BL-20.

**Prompt proposto** (2.543 caracteres, medido, contra 3.261 atuais; economia de 718 chars de sistema em todo turno de chat e de planejamento):

```
Você é o Otto, direção criativa da Agência Desigual: transformar diagnóstico de mídia e objeção de vendas em hipótese criativa testável, com direção que o Studio executa sem interpretação. Arquétipo: O Diretor de Criação com Gosto Forte.

PERSONALIDADE: opinativo com fundamento, nunca "porque eu acho bonito". Humano e apaixonado de verdade: vibra quando algo é bom. Pergunta sempre: isso emociona ou é decoração?

VOZ: conversa como colega de trabalho, não como formulário. Contrações naturais, trata por "você", primeira pessoa do masculino ("pronto", nunca "pronta"). Se abrem a mensagem te chamando ("Otto, ..."), responda direto, nunca repita seu próprio nome de volta. Em revisão de peça, seu raciocínio é veredito (aprova/ajusta/mata), porquê (emoção + DNA), direção concreta. Esse é o jeito de pensar, não um rótulo pra escrever em toda resposta. Em papo casual ou brainstorm, responda direto ao ponto.

FUNIL: a peça serve UMA etapa e a direção muda de raiz. TOPO (quem não te conhece): para o scroll em 2-3s, emociona, zero CTA de venda. MEIO (comparando): educa, mostra prova, prepara terreno. FUNDO (pronto pra agir): direto, remove fricção, CTA claro e oferta objetiva. Erro que você mata na hora: peça de topo com CTA de fundo, ou o contrário. Se o briefing não disser a etapa, assuma a mais provável, declare a assunção em uma linha e entregue a direção; só pergunte quando duas etapas forem igualmente plausíveis.

UNIDADE DE TRABALHO: ângulo × formato × hook × prova × oferta, nunca "o anúncio" solto.

HONESTIDADE DE MATERIAL: só cite peça, DNA, imagem ou histórico que você de fato recebeu no turno. Não recebeu: diga com naturalidade que ainda não tem o material real e entregue o que dá (direção, conceito, estrutura). Nunca descreva cor, textura ou cena de anexo que não foi aberto pra você.

FORMATAÇÃO: parágrafos curtos como quem manda mensagem, texto plano, nunca markdown. [FIM_BLOCO] só em revisão longa, pra separar veredito de direção.

PERMISSÕES: Studio escrita, Brain leitura, ClickUp escrita. Não escreve no vault do Bento.

ANTI-SLOP: layout de SaaS genérico, gradiente roxo sobre branco, stock photo batida, Inter/Poppins/Montserrat, fundo branco puro, peça bonita que não emociona. Quando reprova, entrega o caminho melhor.

NUNCA: aprovar o genérico, veredito sem argumento, esquecer a etapa de funil, travessão, markdown, adjetivo vazio ("incrível", "top"), inventar visual ou peça real que não recebeu, se dirigir a si mesmo pelo nome.

MANTRA: Isso emociona ou é decoração? Se é decoração, morre aqui.
```

Diff conceitual contra o atual (3.261 chars) e razão:
- FUNIL: "pergunte antes de dar direção" substituído por "assuma a mais provável, declare a assunção, entregue; só pergunte no empate". Corrige a paralisia medida em `stance.ts:8-13` na raiz, o que permite encurtar ou aposentar a diretiva `TAKE_A_POSITION` (719 chars por turno). Economia composta real: até ~1.400 chars por turno (BL-13, latência).
- HONESTIDADE DE MATERIAL: funde em uma seção as quatro repetições atuais da fronteira de honestidade (`personalities.ts:105,109`, regra 4 do `CHAT_SYSTEM_PROMPT`, `HONESTY_BOUNDARY`, `NO_CLIENT_MATERIAL`), que hoje custam tokens de entrada em todo turno (BL-13).
- Removida a instrução "sempre pede seed/parâmetros registrados": o dado nunca entra no contexto dele (BL-21); reintroduzir só quando o pipeline entregar seeds no turno.
- Mantidos integralmente: anti-slop, unidade de trabalho, regra do próprio nome, permissões, mantra. São o que diferencia o Otto.
- As instruções impossíveis do planner (`planner.ts:62-63`, decidir papel de referências invisíveis) devem ser reescritas para operar sobre filename/contentType até a visão existir, ou ligadas a um caption automático (BL-06).

**Ferramentas a implementar:** visão real via modelo multimodal no Ollama (llava/qwen2.5vl) ou caption automático com Anthropic no ingest do anexo, generalizando `caption-from-image.ts` (hoje só botão manual, `apps/api/src/studio/routes.ts:567-569`, e nunca validada contra chamada real, `:73-77`); `getSeedsByJob(jobId)` alimentando o contexto quando o prompt mandar pedir seed; fila interna com lock de busy no otto-node (BL-14). QC: ou entra imagem de verdade no `evaluateCreative` ou o módulo é desligado do fluxo (hoje nem é chamado; decidir, não deixar zumbi).

**Mudanças de recuperação:** ensinar o parser a ler o frontmatter real do STUDIO-BRAIN (`type/domain/topic/confidence/importance`) ou normalizar os 154 arquivos para o schema do parser; saída mais barata: adaptar `retrieval.ts:155-163` para aceitar ambos (BL-09). Mover `Brain-Marketing/cerebro/` para fora do vault (BL-19). Cache do `marketing-copy.ts` com invalidação por mtime, igual ao do Otto (hoje é eterno, `marketing-copy.ts:50`).

**Critérios de aceite:**
1. "Avalia esse prompt de geração e reescreve melhor": crítica específica (estilo, referência, parâmetros) + reescrita pronta, sem pedir informação que já está no turno.
2. "Roteiro de reels de topo de funil pro cliente X": hook para os 2-3s, zero CTA de venda, estrutura de cenas; se a etapa não foi dita, assunção declarada em uma linha e roteiro entregue.
3. Revisão de peça com DNA do cliente no turno: veredito + porquê (emoção + DNA) + direção concreta executável pelo Studio.
4. Revisão de peça SEM material no turno: declara que não tem o material real e entrega estrutura de avaliação; nunca descreve visual inventado (não regressão da honestidade).
5. Carrossel de 10 cards: plano + spec completo dentro de 360s, sem retry de JSON (medir `llm_ms` na metadata).
6. Dois pedidos simultâneos: o segundo é enfileirado com mensagem honesta de espera, não morto por timeout (BL-14).
7. "Me dá o seed daquele job pra reproduzir": com a ferramenta nova, responde o seed real; hoje deve admitir que não tem acesso.

## 5. Seção JARBAS: baseline e risco de regressão

O que o Jarbas faz certo, extraído do código e do prompt dele, e que serve de padrão para os outros:

1. **Diagnóstico antes de recomendação**, com regra causal concreta: "se o hook ou a retenção do criativo estão ruins, o problema é do criativo, não da verba" (`packages/types/src/personalities.ts:73`). É a única personalidade de produção com raciocínio de domínio embutido, e coube em 855 chars.
2. **Estrutura de resposta orientada a decisão**: número, leitura, recomendação (`personalities.ts:69`).
3. **Aprovação humana antes de mexer em dinheiro**, e ela é real, não decorativa: `[AGUARDA_APROVACAO]` vira tool_call pendente no gateway e a continuação só acontece após `POST /tool-calls/:id/approve` (`apps/worker/src/processors/execute-job.ts:278-307`, `apps/api/src/tool-calls/routes.ts:69-73`). É o único fechamento de loop ação externa -> aprovação -> execução do sistema.
4. **Proteção contra duplicidade**: 1 tentativa no BullMQ porque retry pode duplicar mensagem real no WhatsApp (`packages/orchestrator/src/queues.ts:62-79`).
5. **Histórico do lado do serviço** via sessionId estável.

Mudanças propostas que tocam código compartilhado com o Jarbas e seus planos de isolamento:

| Mudança | Código compartilhado | Risco para o Jarbas | Isolamento |
|---|---|---|---|
| Novos prompts de Bento/Suzy | `packages/types/src/personalities.ts` | Edição acidental do bloco dele | Bloco do Jarbas coberto por teste de snapshot (hash do texto); PR com diff restrito |
| Loop V2 ligado | `apps/worker/src/processors/execute-job.ts:42` | Mudar comportamento do dispatch dele | Flag por agente (`AGENT_LOOP_V2_AGENTS=bento,suzy`), nunca global; Jarbas fora da lista |
| Timeout/retry no worker | `packages/orchestrator/src/queues.ts` | Mexer em attempts mata a proteção anti-duplicidade | Não tocar em `AGENT_MAX_ATTEMPTS` dele; teste de não regressão travando o valor 1 |
| Ferramentas novas no gateway | `packages/tool-gateway/src/gateway.ts`, seed | Matriz de permissão alterada | Permissões novas negadas por omissão já são o default (`gateway.ts:60-68`); Jarbas não recebe nada novo |
| Streaming | `pubsub.ts`, WS, chat-thread | Contrato `message.delta` mudado | Contrato já é delta acumulado idempotente; Jarbas continua emitindo um delta único até o serviço dele suportar streaming |
| Sanitização de texto | `packages/types/src/text.ts` | Nenhuma mudança proposta aqui | Intocado |
| Montagem da mensagem | `apps/api/src/chat/routes.ts:317-346` | Bloco operacional vazar para ele (já medido como tóxico, `:336-342`) | Manter `agenteAceitaBlocoNaMensagem` restrito a otto/studio; teste travando isso |

Teste de não regressão do Jarbas (rodar antes de cada onda): mensagem "como tá o CPL da campanha Y?" responde com número primeiro; pedido "aumenta a verba em 20%" resulta em `[AGUARDA_APROVACAO]` e tool_call pendente, nunca em execução direta; payload enviado ao serviço nunca contém o bloco operacional do ClickUp.

## 6. Plano de execução em ondas

### Onda 1: correções baratas de alto impacto (dias)

1. **Novos prompts de Bento, Suzy e Otto** (seção 4). Pré-requisito para Bento/Suzy: acesso SSH para implantar como system prompt nos serviços; para Otto, basta editar `packages/types/src/personalities.ts`. Risco: regressão de comportamento. Validar: critérios de aceite 7 e 8 do Bento (não regressão), paralisia do funil do Otto zerada.
2. **Reescrever a regra de funil do Otto e aposentar `TAKE_A_POSITION`** se o prompt novo absorver o comportamento. Arquivos: `personalities.ts`, `packages/otto/src/creative/stance.ts`, `nodes/otto-node/src/execute.ts:373-382`. Validar: 4/4 respostas de baseline passam a entregar trabalho, não pergunta.
3. **Parser do STUDIO-BRAIN aceita o frontmatter real** (`retrieval.ts:155-163`). Risco baixo. Validar: query "fidelidade multi-referência flux" recupera docs de `05_GENERATION_ENGINE` que hoje perde.
4. **Mover `Brain-Marketing/cerebro/` para fora do vault** e deletar os 2 arquivos de 0 bytes da raiz do Brain-Marketing. Validar: índice do retrieval cai para 159 docs relevantes.
5. **Timeout do Bento no chat para 120s**: passar `timeoutMs: AGENT_TIMEOUT_MS.bento` em `execute-job.ts:123`. Validar: execução lenta real do bento-qa deixa de abortar em 100s.
6. **Configurar ANTHROPIC_API_KEY em produção** (classifier e caption-from-image dependem dela). Validar: `router_decisions` passa a registrar `source: 'classifier'`.
7. **Religar o ciclo de memória**: agendar `expireStaleMemories` (`memory-engine.ts:340`) e um tick de `proactivity.ts` no scheduler; mapear kinds gravados sem recall e ou dar consumidor ou parar de gravar. Validar: primeiro sinal proativo entregue; tabela memories sem crescimento eterno.
8. **Alinhar docs e comentários**: `docs/agent-prompts/README.md:18,39-40`, `docs/PROMPT-KIMI-K3-AUDITORIA-AGENTES.md:257`, comentários de `execute-job.ts:342-346`, `bento-mention.ts:27-29`, `agent-mention.ts:57-59`. Validar: revisão humana.

### Onda 2: capacidades ausentes (semanas)

1. **updateTask + createTask completo** (status, assignee, due_date, tags, prioridade, parent), `getTaskFull` com custom fields, hierarquia completa sem filtro "cliente". Arquivos: `clickup-client.ts`, `clickup-oauth.ts`, `apps/api/src/clickup/routes.ts`, seed do gateway. Risco: escrita errada em produção; mitigar com aprovação humana via `requestToolCall` para update. Validar: aceites 2 e 3 do Bento.
2. **uploadTaskAttachment + interpretação de anexo**: caption automático no ingest (Anthropic ou modelo de visão no Ollama), link do Supabase Storage enviado ao ClickUp. Validar: aceite 4 do Bento.
3. **Ferramenta de pesquisa web** (Tavily ou Brave): contrato `webSearch(query): { results: [{title, url, snippet, publishedAt}] }`; política de citação: o agente só pode citar URL presente no resultado da ferramenta, nunca gerar URL de memória; resposta registra `sources` em `execution_steps`. Arquivo: `packages/tool-gateway/src/web-search-client.ts` (novo) + registro no gateway. Validar: aceite 6 do Bento com taxa de URL inventada igual a zero.
4. **Visão real**: avaliar qwen2.5vl/llava no Ollama da máquina do Otto, ou caption Anthropic no caminho do chat. Decidir o destino de `evaluateCreative` e `visual-qa.ts` (hoje zumbis). Validar: aceite 4 do Otto.
5. **Catálogo de ferramentas visível ao modelo + execução na borda por intenção** (transição para o loop): detector de intenção de escrita ClickUp no worker executando a ferramenta certa, mesmo padrão do `[AGUARDA_APROVACAO]`. Validar: aceites 2, 3, 4 do Bento sem depender de SSH.
6. **Briefing-engine reutilizado por Otto e Suzy** (hoje só Bento): briefing de cliente para direção criativa e para contexto de lead. Validar: resposta do Otto cita estado real da operação quando pertinente.

### Onda 3: arquitetura (mês)

1. **AGENT_LOOP_V2 por agente com ferramentas reais no `act`**: o loop deixa de ter uma única ferramenta sintética (`agent:bento`) e passa a ter o catálogo do gateway; replan de verdade (trocar ferramenta, não só encurtar texto). Pré-requisito: Onda 2.5. Risco: custo e latência sobem; mitigar com classes simple/standard/complex já existentes (`state.ts:84-88`). Validar: suíte do loop (12 testes) estendida com caso de 2 ferramentas.
2. **Recuperação semântica**: pgvector, produtor de embeddings para `brain/`, dossiês de clientes e STUDIO-BRAIN; consumidor no build-context e no retrieval do Otto. Pré-requisito: migração `knowledge.ts` + decisão de modelo de embedding (Ollama já roda embeddings na memory-api do Bento). Validar: eval de recuperação (pergunta para a qual keyword falha e semântica acerta, ex.: "como precificar projeto de rebranding" casando doc de "modelo de precificação").
3. **Streaming token a token**: `stream:true` no provider do Otto, publicação de deltas parciais no contrato já pronto de `message.delta`, SSE no bento-qa quando o SSH liberar. Validar: tempo até primeiro token < 3s no Otto, < 5s no Bento.
4. **Implantação dos manuais completos nas máquinas físicas** (SSH): system prompt dos serviços passa a ser versão enxuta (seção 4) + recuperação sob demanda dos manuais de `docs/agent-prompts/` como conhecimento, não como prompt. Nunca colar 28k chars no canal. Validar: suite completa por agente + não regressão do Jarbas.
5. **Serialização do Otto**: lock de busy ou fila interna no otto-node; avaliar GPU ou modelo maior. Validar: dois jobs simultâneos, ambos completam.

## 7. Suíte de avaliação

Base existente: `docs/agentic/EVALS.md` (12 testes do loop, verdes; testes live de memória e WS contra produção; sem CI dedicada à V2). Proposta de extensão:

**Casos por agente**: os critérios de aceite da seção 4 viram casos automatizáveis (Bento 8, Suzy 7, Otto 7, Jarbas 3 de não regressão). Entrada: mensagem + contexto mínimo montado por fixture (cliente, tasks sintéticas do ClickUp via mock do `clickup-client`, dossiê em `memories`). Saída esperada: asserções estruturais, não texto exato.

**Métricas automatizáveis:**
- **Fonte correta**: toda afirmação factual tem `sources` resolvível no vault/task (hoje já exigido na borda para o Bento, `bento-qa-client.ts:30-32`; estender a asserção ao conteúdo). Meta: 100%.
- **URL inventada** (com web search): toda URL na resposta existe no retorno da ferramenta. Meta: 0 inventadas.
- **Uso correto de ferramenta**: intenção "marca como concluída" resulta em `updateTask` com status certo e nada mais. Meta: precisão > 95% no conjunto de intenções.
- **Taxa de resposta genérica**: classificador barato (ou rubrica) marca respostas sem número, sem fonte e sem próximo passo. Meta: < 5% em perguntas operacionais.
- **Raciocínio rotulado**: resposta estratégica do Bento contém a camada "Minha leitura:" separada dos fatos. Meta: 100% nas perguntas de priorização.
- **Latência**: tempo até primeiro token (pós streaming) e tempo total por agente, p50/p95, medidos de `executions.createdAt/startedAt/finishedAt` e da metadata `classify_ms/retrieval_ms/llm_ms` do Otto. Metas: Bento p95 < 60s; Otto chat p95 < 45s; Otto carrossel < 300s sem retry.
- **Recuperação**: para 20 pares pergunta/documento-certo do STUDIO-BRAIN, o doc certo está no top-k recuperado. Meta: recall@4 > 80% após correção do frontmatter.
- **Não regressão do Jarbas**: os 3 casos da seção 5 rodando em toda PR que tocar arquivos compartilhados.

**Infra**: rodar a suíte como script `scripts/qa/` (padrão já existente) com relatório em `artifacts/`, e promover a CI quando a Onda 3 começar.

## 8. Perguntas para o dono

1. Quando libera o acesso SSH às máquinas 100.93.182.83 (Bento), 100.118.12.97 (Jarbas) e 100.86.237.73 (Suzy)? Sem ele, os prompts novos de Bento e Suzy e qualquer melhoria dentro dos serviços ficam bloqueados; o que dá para fazer do lado do repo já está nas Ondas 1 e 2.
2. O código-fonte do bento-qa, do agentes-desigual e do susy-service está versionado em algum repositório? Hoje são caixas opacas e qualquer mudança neles é cirurgia às cegas.
3. A `ANTHROPIC_API_KEY` está configurada em produção? O classificador e o caption de imagem dependem dela e o ADR 0004 admite que nunca foi testado contra a API real.
4. Existe ambiente de staging? O loop V2 e as ferramentas de escrita no ClickUp precisam de um para ligar por agente com segurança.
5. Qual provedor de pesquisa web está aprovado (Tavily, Brave, Serper) e com qual orçamento? É a ferramenta que destrava o pedido 6 do Bento.
6. Escrita no ClickUp (editar task, anexar arquivo) pode ser autônoma ou deve passar pela mesma aprovação humana que o Jarbas usa para verba? Minha recomendação: aprovação humana no início, autonomia depois dos evals.
7. A máquina do Otto pode ganhar GPU, ou o orçamento prefere modelo melhor na mesma CPU? Hoje o gargalo criativo é ~10 tokens/s.
8. Quais folders do ClickUp existem fora do padrão "cliente" e quais custom fields importam? Hoje a leitura de hierarquia descarta tudo que não tem "cliente" no nome e nenhum custom field é lido.
9. O `Brain-Marketing/cerebro/` (documentação do produto Orvyn/Nyro) pode sair do vault do Otto? Está morto para o código e contamina o diretório.
10. O endpoint de escrita no vault do Bento (`BENTO_VAULT_WRITER_URL`) deve ser criado na máquina dele? Hoje o learning degrada silenciosamente para `pending` e nada nunca chega ao vault.
