# Backlog Priorizado de Automação — Auditoria 15/10/2026

- **Data:** 15/10/2026 · **HEAD auditado:** `419dd4d` (branch `feat/otto-motion-engine`) · **Deploy:** API `419dd4d` na VPS (CONFIRMED_IN_DEPLOY via `/health`, artifacts/auditoria-2026-10-15/agentes.md §2), web na Vercel.
- **Fontes:** os 11 relatórios brutos de `artifacts/auditoria-2026-10-15/` (agentes, arquitetura, automacoes, clickup-gateway, clickup-sync, contexto-inteligencia, jornadas-api, jornadas-web, performance-fase13, permissoes-seguranca, testes-fase-11). Este documento consolida e prioriza; a evidência completa de cada achado está no relatório de origem, referenciado por seção.
- **Verificação pontual deste documento** (feita antes da publicação, além dos relatórios): `apps/api/src/clickup/routes.ts:606` (externalId do dedup) — CONFIRMED_BY_CODE; `bento-action-guard.ts:1074-1077` × `environment.ts:75-84` (divergência de parsing QA) — CONFIRMED_BY_CODE; `organization-connectors.ts:34` (credentials jsonb sem cifragem) — CONFIRMED_BY_CODE; `approvals/service.ts:96-124` (resolução sem efeito no recurso) — CONFIRMED_BY_CODE; worker pid 69910 ativo no launchd — CONFIRMED_IN_RUNTIME (16/10, `launchctl list`).
- **Etiquetas:** CONFIRMED_BY_CODE / CONFIRMED_BY_TEST / CONFIRMED_IN_RUNTIME / CONFIRMED_IN_DEPLOY / INFERRED / NOT_VERIFIED. Onde o estado de produção depende de env/banco/VPS não lidos, o item diz explicitamente o que falta verificar.

---

## 1. Metodologia de pontuação

Cada item recebe nota 0–5 em sete critérios. A pontuação final é:

```
Score = 3·F + 3·T + 2·E + 2·U + 2·R − 2·Ri − 2·Es
```

| Critério | Peso | Justificativa do peso |
|---|---|---|
| **F — Frequência** | ×3 | O Desigual OS é operação diária; um defeito que morde todo dia (tela Hoje, webhook, drag de cartão) domina qualquer ganho esporádico. Empata com T no topo porque frequência sem tempo economizado (e vice-versa) não sustenta prioridade sozinha. |
| **T — Tempo manual eliminado** | ×3 | O objeto deste backlog é automação: o critério central é quanto trabalho humano (digitação, clique de sync, reconciliação, espera de tela) deixa de existir. Espera de tela conta como tempo manual. |
| **E — Redução de erros** | ×2 | Perda silenciosa de dado (mensagem de cliente, evento de webhook, credencial exposta) é mais grave que lentidão, mas é menos frequente que o par F/T — daí metade do peso. |
| **U — UX** | ×2 | Fricção visível (estado velho no quadro, botão morto) corrói confiança na ferramenta; pesa metade porque não destrói dado. |
| **R — Reuso de arquitetura** | ×2 | Premia correções que reutilizam mecanismo já existente e testado (cofre AES-GCM, `consultarComCache`, `ehTarefaDeTeste`, padrão de batch do quadro geral). Reuso alto = diferença pequena, regressão improvável, código morto reduzido. |
| **Ri — Risco técnico** | ×−2 | Penaliza o que toca autorização, migração de dados ou contrato externo. Um P0 de segurança pode ter score baixo exatamente porque o risco é alto — ver regra das âncoras abaixo. |
| **Es — Esforço** | ×−2 | Esforço declarado em P/M/G convertido: **P=1, M=3, G=5**. |

Faixa teórica: −20 a 60.

### 1.1 Classificação P0–P3 e a regra das âncoras

- **P0** — os sete itens decididos como âncoras pela coordenação da auditoria. **A âncora prevalece sobre o score.** A matriz mede custo-benefício de automação; ela sub-pesa severidade de segurança e perda permanente de dado (são eventos raros — F baixa — com consequência desproporcional). Cada P0 abaixo carrega a justificativa da âncora ao lado do score.
- **P1** — score ≥ 30.
- **P2** — score 20–29.
- **P3** — score < 20.

"Quick win" neste documento descreve **esforço P com score positivo alto**, não classe de prioridade; há quick wins em P1 e em P2.

### 1.2 Estimativas de economia

Nenhuma fonte trouxe telemetria de uso (cliques, visitas por tela, contagem de eventos em produção) — **dados insuficientes** para economia medida. Todas as estimativas abaixo são **HIPÓTESE** derivada de latências medidas em baselines/comentários de código (7,71s mediana de `/clickup/tasks/agency` sem cache — `apps/api/src/clickup/routes.ts:388-391`; RTT Supabase ~130ms — `packages/database/src/client.ts:24`; 1.239 tarefas abertas — `apps/api/src/pipeline/routes.ts:320`) e de frequência estrutural (ex.: "toda visita ao /today", "todo webhook de tarefa"). O que falta para converter em número: contagem real de eventos/dia no event store, analytics de telas e logs da VPS.

---

## 2. Matriz de pontuação consolidada

Esforço: P=1, M=3, G=5 na coluna Es.

| ID | Item | F | T | E | U | R | Ri | Es | Score | Classe |
|---|---|---|---|---|---|---|---|---|---|---|
| AUD-01 | Dedup do webhook apaga `taskUpdated` | 5 | 3 | 5 | 3 | 4 | 2 | 1 (P) | **42** | **P0 (âncora)** |
| AUD-08 | Rota vínculo contato→cliente | 5 | 4 | 4 | 5 | 4 | 2 | 2 (M) | **45** | P1 |
| AUD-09 | Invalidar `['pipelines']` no evento WS | 5 | 3 | 3 | 4 | 5 | 1 | 1 (P) | **44** | P1 |
| AUD-10 | Cachear `/clickup/tasks/me` | 5 | 3 | 1 | 5 | 5 | 2 | 1 (P) | **40** | P1 |
| AUD-11 | Toast no thread-chat + botão Nova conversa | 4 | 2 | 5 | 4 | 4 | 1 | 1 (P) | **40** | P1 |
| AUD-12 | Select de responsável na edição do cartão | 4 | 2 | 4 | 3 | 5 | 1 | 1 (P) | **38** | P1 |
| AUD-02 | Verificar inscrição do webhook em produção | 4 | 3 | 4 | 3 | 3 | 1 | 1 (P) | **37** | **P0 (âncora)** |
| AUD-13 | dueDate ponta a ponta (demanda→ClickUp) | 4 | 3 | 3 | 3 | 4 | 1 | 1 (P) | **37** | P1 |
| AUD-14 | Batch dos updates N+1 do sync de pipeline | 4 | 3 | 2 | 4 | 5 | 2 | 2 (M) | **35** | P1 |
| AUD-05 | Worker de produção com código de 13/10 | 3 | 2 | 4 | 3 | 5 | 2 | 1 (P) | **33** | **P0 (âncora)** |
| AUD-06 | Demandas nunca chegam a done + aprovação decorativa | 5 | 4 | 4 | 4 | 3 | 3 | 5 (G) | **33** | **P0 (âncora)** |
| AUD-15 | resolveApproval com efeito no brief | 4 | 3 | 5 | 3 | 3 | 3 | 2 (M) | **33** | P1 |
| AUD-16 | Filtro server-side por cliente (threads/aprovações) | 4 | 3 | 3 | 3 | 4 | 2 | 2 (M) | **33** | P1 |
| AUD-17 | client_id no modal de evento | 3 | 2 | 3 | 3 | 4 | 1 | 1 (P) | **31** | P1 |
| AUD-18 | Cache curto de `getTeamMembers` | 5 | 2 | 2 | 3 | 4 | 2 | 2 (M) | **31** | P1 |
| AUD-03 | Topologia da env `CLICKUP_WRITE_SCOPE_LIST_ID` | 4 | 2 | 5 | 4 | 4 | 4 | 3 (M) | **30** | **P0 (âncora)** |
| AUD-19 | GrantAccessForm: select de membros | 2 | 2 | 3 | 3 | 5 | 1 | 1 (P) | **30** | P1 |
| AUD-20 | Retry 429 compartilhado no fetchClickUp | 3 | 2 | 4 | 2 | 5 | 2 | 2 (M) | 29 | P2 |
| AUD-21 | Split do gate de `/approvals` | 3 | 2 | 2 | 4 | 4 | 2 | 1 (P) | 29 | P2 |
| AUD-22 | Filtro de QA no caminho do webhook | 3 | 2 | 3 | 3 | 4 | 2 | 1 (P) | 29 | P2 |
| AUD-23 | `GET /clickup/tasks/:id` | 3 | 2 | 1 | 3 | 5 | 1 | 1 (P) | 29 | P2 |
| AUD-24 | Fechar oferta "dia útil seguinte" do Bento | 2 | 3 | 3 | 4 | 4 | 2 | 2 (M) | 29 | P2 |
| AUD-25 | Studio com cliente pré-selecionado | 3 | 2 | 1 | 3 | 4 | 1 | 1 (P) | 27 | P2 |
| AUD-26 | auditarAcao no PATCH de cartão do pipeline | 5 | 0 | 4 | 0 | 4 | 1 | 1 (P) | 27 | P2 |
| AUD-27 | Logar a causa do inference-warmth | 4 | 1 | 2 | 1 | 5 | 1 | 1 (P) | 27 | P2 |
| AUD-28 | Reconciliação agendada de pipeline | 2 | 3 | 4 | 2 | 4 | 2 | 3 (M) | 25 | P2 |
| AUD-29 | Instalar plist de fichas do Bento | 1 | 3 | 2 | 1 | 5 | 1 | 1 (P) | 24 | P2 |
| AUD-30 | Teto de retenção na fila `automations` | 2 | 1 | 3 | 1 | 5 | 1 | 1 (P) | 23 | P2 |
| AUD-31 | Testes de rota do pipeline + banco descartável | 3 | 2 | 4 | 0 | 4 | 1 | 3 (M) | 23 | P2 |
| AUD-32 | textoExternoSeguro no worker e na menção | 4 | 0 | 5 | 0 | 4 | 2 | 2 (M) | 22 | P2 |
| AUD-33 | Cache de `listStatusDetailsForList` | 4 | 0 | 2 | 3 | 4 | 2 | 2 (M) | 22 | P2 |
| AUD-04 | Conta qa-motion com authorizedForProduction | 3 | 1 | 5 | 1 | 3 | 3 | 1 (P) | 22 | **P0 (âncora)** |
| AUD-34 | Caminho de criação do quadro geral na UI | 1 | 2 | 2 | 2 | 4 | 1 | 1 (P) | 21 | P2 |
| AUD-35 | Boot log de alertas (ALERT_SLACK_WEBHOOK_URL) | 2 | 1 | 3 | 0 | 4 | 1 | 1 (P) | 19 | P3 |
| AUD-36 | Uma task só por demanda no ClickUp | 3 | 2 | 3 | 2 | 3 | 3 | 3 (M) | 19 | P3 |
| AUD-37 | Root-cause do reconciliador de automações | 3 | 1 | 3 | 1 | 3 | 1 | 3 (M) | 18 | P3 |
| AUD-39 | Topologia GPU gateway / Redis↔studio-node | 2 | 3 | 3 | 2 | 2 | 3 | 3 (M) | 17 | P3 |
| AUD-07 | Credenciais de clientes em claro | 2 | 2 | 5 | 0 | 5 | 4 | 4 (G) | 16 | **P0 (âncora)** |
| AUD-38 | Outcome real em `automation_runs` | 3 | 1 | 3 | 1 | 3 | 3 | 3 (M) | 14 | P3 |
| AUD-40 | Autorizar autor de menção a agente | 2 | 0 | 4 | 0 | 4 | 2 | 2 (M) | 14 | P3 |
| AUD-41 | Paginar/recortar GET /pipelines | 3 | 0 | 1 | 3 | 3 | 3 | 3 (M) | 11 | P3 |
| AUD-42 | Verificação forte do webhook WhatsApp | 1 | 0 | 4 | 0 | 2 | 3 | 3 (M) | 3 | P3 |

---

## 3. Backlog P0 — âncoras da coordenação

Os sete itens abaixo foram fixados como P0 pela coordenação da auditoria. Em todos, a severidade (perda permanente de dado, fronteira de segurança, funcionalidade deployada mas morta) excede o que o score captura; onde o score é baixo (AUD-04, AUD-07), a justificativa está explícita.

### AUD-01 — Dedup do event store apaga todo `taskUpdated` depois do primeiro por task
- **Módulo:** clickup-sync (webhook receiver → event store)
- **Problema:** `externalId = ${event}:${taskId}:${webhook_id}` (`apps/api/src/clickup/routes.ts:606`); `webhook_id` é o id da inscrição, constante. O índice único `(source, external_id)` (`packages/orchestrator/src/event-store.ts:117-137`) grava só o primeiro `taskUpdated` de cada task; os demais voltam `duplicate` (routes.ts:634-636). CONFIRMED_BY_CODE (reverificado neste documento). Consequência permanente: linha do tempo, proatividade (`task.updated` é KNOWN_TYPE, `operational-events.ts:46`) e o sinal de vida do integration-health (`integration-health.ts:121-132`) perdem todos os updates após o primeiro.
- **Evidência:** routes.ts:606; event-store.ts:120; teste que cristaliza o defeito em `routes.test.ts:396-397`. Fonte: clickup-sync.md §2-P1.
- **Fluxo atual:** webhook recebe → handler processa pipeline/WS/campanhas normalmente → event store descarta silenciosamente a partir do segundo update.
- **Automação proposta:** externalId passa a ser `history_items[0].id` (único por mudança, já parseado em `webhook-actor.ts:30` e `webhook-mudancas.ts:102`), com fallback `event:taskId:history_date`. A disponibilidade de `history_items[].id` em payload real é INFERRED da doc oficial — capturar um payload real antes ou logar o fallback na primeira semana.
- **Fluxo futuro:** cada mudança grava um evento; reentrega do mesmo `history_item` continua deduplicada pelo índice único.
- **Benefício:** restaura linha do tempo, proatividade e health-signal; desbloqueia qualquer análise de "o que mudou hoje".
- **Impacto:** alto (integridade de dados histórica); sem efeito colateral em pipeline/WS, que não dependem do event store.
- **Esforço:** P (uma linha + ajuste de teste). **Risco:** baixo-médio — muda a semântica de dedup; eventos antigos não são recuperáveis retroativamente (perda já consolidada é irreversível — dado nunca gravado).
- **Dependências:** nenhuma de código; decisão sobre backfill (impossível para o passado).
- **Permissões envolvidas:** nenhuma (caminho interno do webhook, já autenticado por HMAC).
- **Testes necessários:** inverter `routes.test.ts:385-397` — duas mudanças na mesma task DEVEM ter externalIds diferentes; teste de fallback sem `history_items`.
- **Economia estimada:** HIPÓTESE — elimina a reconciliação manual de "o que mudou" (hoje irrespondível) e corrige métricas que subestimam updates; minutos por dia por pessoa operando, não mensurável sem analytics.

### AUD-02 — Verificar a inscrição do webhook do ClickUp em produção
- **Módulo:** clickup-sync / infra
- **Problema:** só existe script de DEV (`scripts/clickup-webhook-setup.sh:104`, registra apenas `taskCommentPosted` via cloudflared). Nada no repo registra `taskCreated/taskUpdated/taskDeleted` em produção. A afirmação "webhook ativo, 8 tipos de evento" (`docs/audits/DESIGUAL_OS_RELEASE_READINESS_AUDIT.md:56`) não tem data. **NOT_VERIFIED** se a inscrição na VPS cobre eventos de task — se não cobrir, todo o `handleTaskChanged` está morto em produção e o quadro só anda pelo botão Sincronizar. Fonte: clickup-sync.md §1.
- **Fluxo atual:** ninguém sabe, pelo repo, quais eventos a inscrição de produção cobre; `integration-health` (`integration-health.ts:41-57`) lê saúde mas só `webhooks[0]` (:49).
- **Automação proposta:** (a) verificação pontual via API do ClickUp (`GET /team/{id}/webhook`) listando eventos e endpoint; (b) estender `integration-health` para comparar os eventos inscritos com a lista exigida e alertar quando faltar tipo — o job já roda a cada 15 min e já religa webhook suspenso (:82-116).
- **Fluxo futuro:** drift de inscrição vira alerta operacional em ≤15 min, não descoberta por acaso.
- **Benefício:** fecha a maior incógnita de produção desta auditoria; barato.
- **Impacto:** alto se a inscrição estiver incompleta; neutro se estiver correta (vira confirmação + guarda permanente).
- **Esforço:** P. **Risco:** baixo (leitura + alerta; o religar automático já existe).
- **Dependências:** acesso de leitura ao ClickUp da VPS (credencial já usada pelo integration-health).
- **Permissões envolvidas:** nenhuma nova (job do worker com credencial da casa).
- **Testes necessários:** unitário do comparador de eventos (lista esperada × inscrita); o alerta usa `sendOpsAlert` — ver AUD-35 para o caso da env vazia.
- **Economia estimada:** HIPÓTESE — se a inscrição estiver quebrada, elimina syncs manuais diários; se estiver sã, elimina a verificação manual recorrente (~minutos por incidente evitado).

### AUD-03 — Topologia da env `CLICKUP_WRITE_SCOPE_LIST_ID` e válvula nas rotas humanas
- **Módulo:** permissoes-seguranca / tool-gateway (write-scope)
- **Problema:** a cerca está ATIVA na VPS (contexto fornecido), mas **em qual processo** (API, worker ou ambos) é NOT_VERIFIED — nenhum auditor leu a env. As rotas humanas `/clickup/*` montam config cru sem `writeScope` (`clickup/routes.ts:675,756,820,898,1135,1191`) e as respostas de menção idem (:1330-1335). Se a env está na API: toda escrita humana por essas rotas falha fail-closed e o Bento cala nas menções (erro engolido em routes.ts:1346). Se está só no worker: as rotas HTTP escrevem em produção SEM cerca — contradiz o cabeçalho de `write-scope.ts:11-14`. CONFIRMED_BY_CODE o comportamento em cada combinação; NOT_VERIFIED qual combinação está ativa. Fonte: permissoes-seguranca.md §2-P1.
- **Fluxo atual:** duas possibilidades mutuamente exclusivas, ambas defeituosas, decididas por uma env invisível ao repo.
- **Automação proposta:** (a) confirmar em quais processos a variável está setada (leitura pontual na VPS); (b) decidir o estado final e implementar `clickUpConfigParaHumanoAutenticado(request)` — válvula `authorizedForProduction: true` montada só após `requireAuth` + `requirePermission('clickup','write')` + tenant resolvido — trocando os 7 call sites + reply de menção; (c) documentar `CLICKUP_WRITE_SCOPE_LIST_ID`, `BENTO_WRITE_ENABLED`, `BENTO_QA_BOT_EMAIL`, `BENTO_WRITE_ALLOWLIST` no `.env.example` (nenhuma existe lá hoje — grep confirmado, permissoes-seguranca.md §2-P9).
- **Fluxo futuro:** a cerca vale em todo processo que escreve; humano autenticado escreve pela válvula com o mesmo gate do pipeline; o estado resolvido aparece no boot log (padrão de `apps/worker/src/index.ts:222-225`).
- **Benefício:** uma regra de escrita só, observável, em vez de duas configurações divergentes por processo.
- **Impacto:** alto — é a fronteira de escrita no ClickUp de produção.
- **Esforço:** M. **Risco:** alto (toca autorização de escrita); mitigado por `write-scope.test.ts` (29 testes, CONFIRMED_BY_TEST) + teste novo do helper.
- **Dependências:** decisão de produto (manter cerca + válvula vs. desligar — recomendação antiga em `docs/audits/bento-controle-da-operacao.md` §3.1 nunca executada); AUD-04 (quem é QA) deve ser resolvido junto.
- **Permissões envolvidas:** `clickup:write` (RBAC), `requireTenant`, válvula `authorizedForProduction`.
- **Testes necessários:** teste de rota montando o app Fastify para os 7 call sites (hoje só a borda do gateway é testada — testes-fase-11.md §3); regressão write-scope com a válvula do helper.
- **Economia estimada:** HIPÓTESE — elimina depuração recorrente de "por que essa escrita falhou/passou"; o custo real hoje é incidente de escrita indevida ou operação bloqueada, não tempo de rotina.

### AUD-04 — Conta qa-motion recebe `authorizedForProduction` (divergência ehQaBot × ehContaDeQa)
- **Módulo:** permissoes-seguranca / worker (guard de escrita)
- **Problema:** `ehQaBot` (`bento-action-guard.ts:1074-1077`) compara o e-mail com a string inteira de `BENTO_QA_BOT_EMAIL` (default `qa-bot@institutoalmada.org`). `ehContaDeQa` (`environment.ts:75-84`) faz split por vírgula com DOIS defaults, incluindo `qa-motion@agenciadesigual.com.br` (conta master real de e2e). CONFIRMED_BY_CODE (reverificado neste documento). Sem env configurada: qa-motion é QA para a cognição mas NÃO para o guard → recebe a válvula (`bento-openai-core.ts:486`, `bento-action-guard.ts:1826`) e `podeEscreverEmProducao` retorna true para qualquer cliente (:1109-1110). Com env em formato lista: `ehQaBot` nunca casa e NENHUMA conta de QA é reconhecida. O comentário de environment.ts:61-64 ("o VALOR vem da mesma variável... impede de divergirem") é falso na prática: o parsing diverge.
- **Fluxo atual:** a segunda conta de QA pode escrever na carteira real como "humano autorizado", com a cerca ligada ou não.
- **Automação proposta:** extrair função única de parsing (lista de e-mails) para módulo neutro (packages/auth ou módulo do worker sem dependência circular) e fazer `ehQaBot` consumi-la; teste de regressão com lista separada por vírgula.
- **Fluxo futuro:** uma fonte só de "quem é conta de QA"; qa-motion restrita ao cliente de QA.
- **Benefício:** fecha um buraco de identidade na fronteira de escrita.
- **Impacto:** alto (segurança); score 22 porque a frequência de uso da conta é baixa — **a âncora P0 prevalece sobre o score**, pois a consequência é escrita indevida em dados de clientes reais.
- **Esforço:** P. **Risco:** médio (muda quem é reconhecido como QA; testes de guard existentes — 166 testes em `bento-guard-matrix`, CONFIRMED_BY_TEST — precisam cobrir a conta nova).
- **Dependências:** nenhuma de código; coordenar com AUD-03.
- **Permissões envolvidas:** válvula `authorizedForProduction`, `podeEscreverEmProducao`, `BENTO_QA_BOT_EMAIL`, `BENTO_QA_CLIENT_NAME`.
- **Testes necessários:** `ehQaBot('qa-motion@...') === true` com default; caso de env-lista; matriz de escrita do guard para a conta.
- **Economia estimada:** não se aplica em tempo — é remoção de risco. Dados insuficientes sobre o uso real da conta qa-motion em produção (banco não consultado).

### AUD-05 — Worker de produção roda código de 13/10 (Bento 3.1 não está no ar)
- **Módulo:** automacoes / worker / infra
- **Problema:** processo worker pid 69910 de pé desde 13/10 16:48 — CONFIRMED_IN_RUNTIME na máquina local (launchd, reverificado 16/10: pid segue 69910). O log de boot lista 13 jobs repetíveis; o código atual arma 14 (`scheduler/index.ts:30-45` — `bento-varredura` adicionado em 14/10, commit `cea59e0e`). Consequência: `bento-varredura`, `briefingOperacional` (8h) e o tuning `BENTO_QUEUE_CONCURRENCY` existem só no fonte. Fonte: automacoes.md §3.4. **Ressalva de escopo:** a evidência é do worker local deste Mac; onde roda o worker de produção da VPS é NOT_VERIFIED (arquitetura.md §1.1 declara worker no docker-compose de prod, mas automacoes.md §1.6 registra que o worker local processa dados operacionais reais hoje — os dois podem coexistir; dados insuficientes para dizer qual processa o quê).
- **Fluxo atual:** código entregue em 14/10 não executa até reiniciar o processo; não há rotina de restart nem verificação pós-boot de "jobs armados == jobs esperados".
- **Automação proposta:** (a) restart imediato (launchd kickstart no Mac e/ou recreate do container na VPS, conforme a topologia real — pendente de AUD sobre onde o worker de produção roda, automacoes.md §4.8); (b) no boot, logar a lista de jobs armados e comparar com o esperado (o worker já loga estado resolvido do Agentic V2 no boot, `index.ts:222-225`); (c) decidir as flags `BENTO_PROACTIVE_*` em shadow mode — o código suporta (`bento-varredura.ts:20-28`).
- **Fluxo futuro:** deploy de scheduler novo entra no ar no mesmo dia; drift de jobs vira linha de boot, não surpresa.
- **Benefício:** coloca no ar o que já foi pago em código; proatividade do Bento passa a existir de fato.
- **Impacto:** alto (funcionalidade inteira parada); esforço trivial.
- **Esforço:** P (restart) + P (log de boot). **Risco:** baixo — restart de worker BullMQ com filas persistentes; jobs repetíveis são rearmados no boot.
- **Dependências:** decisão sobre flags `BENTO_PROACTIVE_*`; esclarecer a topologia worker local × VPS.
- **Permissões envolvidas:** nenhuma.
- **Testes necessários:** verificação pós-boot (14 jobs no log, primeiro disparo do `bento-varredura`); `bento-varredura.test.ts` já existe e passa (automacoes.md §5, 25/25).
- **Economia estimada:** HIPÓTESE — a 1ª varredura real gerou 188 sinais sobre 1.255 tasks (bento-3.1-progress.md:303-308, citado em agentes.md §1.2); o valor é a proatividade entregue, não tempo de rotina.

### AUD-06 — Demandas nunca chegam a done e aprovação é decorativa
- **Módulo:** jornadas-api (demands/briefs/approvals)
- **Problema (duas faces da mesma cadeia quebrada):**
  1. **Sem volta ClickUp→demanda e sem status na UI:** o webhook só move cartões de pipeline; `demands.status` nunca é tocado por evento, e `PATCH /demands/:id/status` **não tem chamador na UI** (grep em apps/web — CONFIRMED_BY_CODE por ausência). Uma quinzena sai de `new→briefing→in_production` e nunca chega a `done|cancelled` pela interface; o KPI "Quinzenas abertas" (`agency-control-center/routes.ts:117`) cresce para sempre. (G3)
  2. **Aprovação decorativa:** resolver um `approval_requests` como `approved` não marca versão do brief nem destrava nada — reverificado: `approvals/service.ts:96-124` só atualiza a linha e grava evento; `sendBriefToProduction` só checa `approvedVersionId` (`briefs/service.ts:209`). Zero consumers de `approval.resolved` fora o event store (CONFIRMED_BY_CODE). O funil do control-center depende desses pedidos (routes.ts:128-140), então sub-reporta por design. (G1, G8)
- **Fluxo atual:** acompanhamento da quinzena é manual e fora do sistema; "Pedir aprovação" é teatro — a decisão real acontece por fora.
- **Automação proposta:** (a) em `handleTaskChanged`, quando `changed.taskId` bate com `demands.clickup_task_id` ou `briefs.external_task_id`, mapear status ClickUp fechado → `demands.status='done'` (o mapa de status já existe: `quadro-geral.ts:categoriaDoStatus`); (b) botão/hook de status em `/demands/[id]` (o PATCH existe e é testado); (c) efeito real da aprovação — ver AUD-15, que é o recorte mínimo desta face.
- **Fluxo futuro:** concluir a task no ClickUp conclui a quinzena; o KPI reflete a realidade; a aprovação tem consequência.
- **Benefício:** fecha a cadeia SOLICITAÇÃO→…→ACOMPANHAMENTO nos dois elos quebrados restantes (jornadas-api.md §2).
- **Impacto:** alto (jornada central do produto); score 33 com esforço G — **âncora P0** porque é o ciclo de vida do objeto de negócio principal.
- **Esforço:** G (três frentes: webhook, UI, service de aprovação). **Risco:** médio-alto — mapear status fechado errado conclui quinzenas indevidamente; mitigar com dry-run logando o que seria marcado antes de ligar a escrita.
- **Dependências:** AUD-01 (o webhook precisa entregar todos os updates — hoje o event store os perde; o caminho de pipeline não depende do event store, mas a confiabilidade do gatilho sim); AUD-15 para a face de aprovação.
- **Permissões envolvidas:** `demands:write` (já existente nas rotas), tenant resolvido.
- **Testes necessários:** teste de webhook → demanda com status fechado/aberto; teste de rota do PATCH de status via UI hook; dry-run com log.
- **Economia estimada:** HIPÓTESE — elimina a reconciliação manual quinzena×ClickUp (hoje inexistente: quem quiser saber abre os dois sistemas) e corrige o KPI; sem dados de quantas quinzenas/dia, não quantificável.

### AUD-07 — Credenciais de clientes em claro no banco
- **Módulo:** permissoes-seguranca / database (organization_connectors)
- **Problema:** `organization_connectors.credentials` é jsonb sem cifragem (reverificado: `organization-connectors.ts:34`), gravado direto (`connectors/routes.ts:337-343, 239-240`). Inclui `apiKey` do ClickUp DE CADA EMPRESA CLIENTE e tokens de WhatsApp. O cofre AES-256-GCM existe a um arquivo de distância (`token-crypto.ts:51-67`) e cobre só tokens por usuário. Um dump/backup/read-replica expõe as chaves de produção de todos os clientes; o mascaramento no GET (`connectors/routes.ts:42-54`) protege a API, não o armazenamento. CONFIRMED_BY_CODE.
- **Fluxo atual:** segredos de clientes repousam em claro no Postgres gerenciado.
- **Automação proposta:** cifrar os campos que casam com `CAMPO_SECRETO` com o `encryptToken` existente na escrita; decifrar só no `resolveTaskProvider`/resolver de comunicação; migração de dados re-envelopando o que já está gravado (script one-shot com verificação de contagem antes/depois).
- **Fluxo futuro:** credencial em repouso cifrada; leitura transparente pelos resolvers; GET continua mascarado.
- **Benefício:** fecha a exposição mais larga de segredos do sistema (todas as empresas clientes de uma vez).
- **Impacto:** alto (segurança/compliance); score 16 — o mais baixo dos P0 — porque frequência de exploração é latente e o esforço inclui migração. **A âncora prevalece:** perda de confidencialidade de credenciais de clientes é o tipo de evento que a matriz não precifica.
- **Esforço:** G (migração de dados + dois resolvers). **Risco:** alto — decifragem errada quebra todas as integrações; exigir feature flag de leitura dual (claro→cifrado) e rollback por re-deploy.
- **Dependências:** `INTEGRATION_ENCRYPTION_KEY` definida e igual em API e worker (NOT_VERIFIED — estado da env não lido); janela para a migração.
- **Permissões envolvidas:** nenhuma nova; caminho interno dos resolvers.
- **Testes necessários:** round-trip de cifragem por provider; teste do resolver lendo formato novo e legado; verificação da migração em staging com dump descartável.
- **Economia estimada:** não se aplica em tempo — remoção de risco de vazamento em massa.

---

## 4. Backlog P1 (score ≥ 30)

### AUD-08 — Rota de vínculo contato→cliente (45)
- **Módulo:** jornadas-api (inbox/communications)
- **Problema:** webhook do WhatsApp cria contato com `clientId: null` (`communications/routes.ts:220`) e **nenhuma rota escreve** `contacts.clientId`/`conversationThreads.clientId` (grep: só leituras). Consequência: a aba Quinzenas do inbox renderiza `<SemCliente />` (`thread-context-panel.tsx:116`) e mensagem de contato novo — o caso comum — **não pode virar demanda**. CONFIRMED_BY_CODE. (G2)
- **Fluxo atual:** atendimento recebe mensagem → quer abrir quinzena → parede: sem vínculo, sem demanda.
- **Automação proposta:** `PATCH /inbox/threads/:id/client` (ou no contato) escrevendo o vínculo; o `ClientDemandsPanel` já está pronto esperando clientId.
- **Fluxo futuro:** vincular uma vez → thread ganha aba Quinzenas funcional → demanda nasce do inbox.
- **Benefício:** desbloqueia o elo INBOX→DEMANDA inteiro; é o maior desbloqueio de jornada por linha de código desta auditoria.
- **Impacto:** alto. **Esforço:** M (rota + validação de tenant + UI mínima de seleção). **Risco:** baixo-médio (escrita nova em tabela de inbox; validar cliente do tenant).
- **Dependências:** nenhuma. Combina com o quick win seguinte (pré-preencher título da demanda pela 1ª mensagem, jornadas-api.md §4.3 — pode entrar no mesmo PR ou depois).
- **Permissões envolvidas:** `communications:write`/`clients:write`, `requireTenant`, `clientBelongsToTenant`.
- **Testes necessários:** teste de rota (padrão `demands/routes.test.ts`): vínculo, cross-tenant 404, revínculo.
- **Economia estimada:** HIPÓTESE — hoje o caminho é impossível (não é lento, é inexistente); cada contato novo exigiria workaround manual no banco.

### AUD-09 — Invalidar `['pipelines']` no evento WS `clickup.task_changed` (44)
- **Módulo:** clickup-sync / web (realtime)
- **Problema:** o evento invalida só `['clients', clientId, 'clickup-tasks']` (`use-realtime-events.ts:68-73`); `['pipelines']` nunca é invalidada por evento e `usePipelines` não tem refetchInterval (`use-pipelines.ts:19-24`). Cartão criado/movido pelo webhook só aparece após navegação — divergência garantida entre ficha do cliente (atualiza na hora) e quadro ao lado (coluna velha). CONFIRMED_BY_CODE. (P3 de clickup-sync)
- **Fluxo atual:** quadro aberto mostra estado velho até o usuário navegar ou sincronizar.
- **Automação proposta:** `queryClient.invalidateQueries({ queryKey: ['pipelines'] })` no caso `clickup.task_changed`; alternativa mais fina: evento dedicado `pipeline.card_changed` publicado em `sincronizar-webhook.ts`.
- **Fluxo futuro:** quadro reflete o webhook em tempo real como as demais telas.
- **Benefício:** elimina a classe inteira "quadro mentindo"; reduz a justificativa do sync-on-open caro (ver AUD-14/AUD-28).
- **Impacto:** alto. **Esforço:** P (uma linha; a versão com evento dedicado é M). **Risco:** baixo — refetch a mais por evento; volume já absorvido pelas outras invalidações.
- **Dependências:** nenhuma.
- **Permissões envolvidas:** nenhuma.
- **Testes necessários:** teste do hook (padrão existente em apps/web) ou e2e Playwright do quadro recebendo evento.
- **Economia estimada:** HIPÓTESE — alguns cliques de sync manual por dia por usuário de pipeline + erros de decisão sobre estado velho evitados.

### AUD-10 — Cachear `/clickup/tasks/me` (40)
- **Módulo:** performance (clickup rotas / today)
- **Problema:** `/clickup/tasks/me` chama `queryOperationTasks` direto, sem `consultarComCache` (`clickup/routes.ts:1103-1110`) — assimetria evidente com `/agency` (:1020) no mesmo arquivo. Como as duas são seções do `/today/summary` (`today/routes.ts:70-71`), **toda visita à tela Hoje paga uma varredura ao vivo do ClickUp por usuário**. CONFIRMED_BY_CODE. Vizinho medido: 7,71s de mediana para a consulta de agência sem cache (`routes.ts:388-391`). (P1 de performance)
- **Fluxo atual:** tela Hoje assenta limitada pela seção mais lenta, a cada navegação.
- **Automação proposta:** passar `/tasks/me` pelo `consultarComCache` incluindo `assigneeIds` na chave (:418-422). O webhook já invalida o cache inteiro.
- **Fluxo futuro:** visita subsequente em 60s vem de cache; frescura garantida pelo webhook.
- **Benefício:** remove segundos da tela mais frequente do dia.
- **Impacto:** alto (F=5). **Esforço:** P. **Risco:** baixo-médio — chave de cache errada vaza tarefa entre usuários; a chave já inclui hash de credencial, e o teste deve cobrir dois usuários.
- **Dependências:** nenhuma.
- **Permissões envolvidas:** nenhuma nova (rota já autenticada).
- **Testes necessários:** teste de chave (assignee diferente → cache diferente); invalidação pelo webhook.
- **Economia estimada:** HIPÓTESE — ~2-7s por visita ao /today × visitas/dia × usuários; sem analytics, a casa é "segundos por visita".

### AUD-11 — Catch com toast no thread-chat + botão "Nova conversa" (40)
- **Módulo:** jornadas-web (inbox)
- **Problema (dois defeitos na tela de atendimento):** `thread-chat.tsx:63-64` apaga o rascunho ANTES do envio e engole a falha (`.catch(() => undefined)`) — mensagem a cliente perdida em silêncio, o pior defeito possível numa tela de atendimento. E `inbox/page.tsx:89-91` tem `<button>` "Nova conversa" sem `onClick` — ação principal mentirosa. CONFIRMED_BY_CODE. (P2/P3 de jornadas-web)
- **Fluxo atual:** falha de rede = mensagem some sem aviso; "Nova conversa" não faz nada.
- **Automação proposta:** limpar rascunho só após sucesso + toast no catch (padrão já usado em `approvals/page.tsx:56-60`); implementar ou remover o botão.
- **Fluxo futuro:** falha preserva o texto e avisa; toda ação visível funciona.
- **Benefício:** elimina perda silenciosa de dado em atendimento a cliente.
- **Impacto:** alto (E=5). **Esforço:** P. **Risco:** baixo.
- **Dependências:** nenhuma. Relaciona-se com AUD-08 (nova conversa útil depende de vínculo).
- **Permissões envolvidas:** nenhuma.
- **Testes necessários:** teste de componente com mutation rejeitada (rascunho preservado + toast); vitest de apps/web roda 464 testes hoje (testes-fase-11.md §2).
- **Economia estimada:** HIPÓTESE — cada mensagem perdida é retrabalho + risco com cliente; não quantificável sem dados de falha.

### AUD-12 — Select de responsável na edição do cartão (38)
- **Módulo:** jornadas-web (pipeline)
- **Problema:** edição de cartão pede responsável em texto livre (`pipeline/page.tsx:749`) enquanto a criação usa `<select>` de colaboradores (`:621-624`). Nomes divergentes ("Matheus" × "Matheus Rial") quebram agrupamentos por responsável. CONFIRMED_BY_CODE. (P6 de jornadas-web)
- **Fluxo atual:** dado digitado que o sistema já tem → agrupamento inconsistente.
- **Automação proposta:** trocar pelo mesmo `<select>` da criação — `useCollaborators` já está importado na página. Bônus no mesmo componente: pré-selecionar pelo `account` do cliente (`GET /clients/:id/assignments`, contexto-inteligencia.md §3-O2).
- **Fluxo futuro:** responsável sempre é uma pessoa real do sistema.
- **Benefício:** integridade de agrupamento + menos digitação.
- **Impacto:** médio-alto. **Esforço:** P. **Risco:** baixo.
- **Dependências:** nenhuma.
- **Permissões envolvidas:** nenhuma (leitura de colaboradores já autorizada na página).
- **Testes necessários:** teste de componente do modal de edição.
- **Economia estimada:** HIPÓTESE — segundos por edição + correções de agrupamento evitadas.

### AUD-13 — dueDate ponta a ponta (demanda→ClickUp) (37)
- **Módulo:** jornadas-api (demands/briefs espelho ClickUp)
- **Problema:** `espelharNoClickUp` envia só título/descrição (`demands/service.ts:105-108`) — `dueDate` da demanda não vai; `sendBriefToProduction` aceita dueDate no body mas a UI chama com `{}` (`use-briefs.ts:65`) e o campo `deadline` do BriefContent nem entra na descrição (`briefs/service.ts:216-227`). CONFIRMED_BY_CODE. (G4)
- **Fluxo atual:** prazo definido no Desigual morre antes do ClickUp; quem opera no ClickUp não vê prazo.
- **Automação proposta:** passar `dueDate` no espelho da criação; no send-to-production, defaultar para `demand.dueDate` quando o body vier vazio.
- **Fluxo futuro:** prazo nasce uma vez e chega às duas pontas; o meeting-brief e o "previstas para hoje" passam a concordar com o ClickUp (jornadas-api.md §4.8).
- **Benefício:** elimina redigitação de prazo e divergência de agenda.
- **Impacto:** médio-alto. **Esforço:** P. **Risco:** baixo (campo a mais na escrita já autorizada).
- **Dependências:** nenhuma.
- **Permissões envolvidas:** escrita via `authorizedForProduction` já existente nos services.
- **Testes necessários:** teste de service do espelho com dueDate; caso de body vazio no send-to-production.
- **Economia estimada:** HIPÓTESE — ~1 min por demanda com prazo + erro de prazo esquecido evitado.

### AUD-14 — Batch dos updates N+1 do sync de pipeline (35)
- **Módulo:** performance (pipeline sync)
- **Problema:** um `await db.update(...)` por tarefa, serial, no sync (`pipeline/routes.ts:1111-1128`); idem quadro geral no caso "mudou campo sem mudar coluna" (:1016-1019) e `sincronizar-clientes` (:918-927). Com RTT ~130ms (CONFIRMED_BY_CODE, `client.ts:24`): 50 tarefas mudadas ≈ 6,5s, 200 ≈ 26s dentro de uma requisição HTTP disparada ao abrir a tela. O caminho do quadro geral já prova o padrão certo 30 linhas abaixo (moves com `inArray` :1032-1034, inserts em chunks :1036-1038). CONFIRMED_BY_CODE. (P3 de performance)
- **Fluxo atual:** sync-on-open = espera do ClickUp + N round-trips seriais de banco.
- **Automação proposta:** agrupar updates por novo stageId + `inArray`; campos de espelho via `UPDATE ... FROM (VALUES ...)` ou update por coluna.
- **Fluxo futuro:** sync com custo de banco quase constante; a espera restante é a do ClickUp (atacada por AUD-28).
- **Benefício:** sync deixa de escalar linear com tarefas mudadas.
- **Impacto:** alto em quadros grandes. **Esforço:** M. **Risco:** médio (reescrita de update em massa; cobrir com teste de service).
- **Dependências:** nenhuma.
- **Permissões envolvidas:** nenhuma.
- **Testes necessários:** teste de integração do sync com banco descartável (dependeria do `TENANT_TEST_DATABASE_URL` — ver AUD-31); no mínimo teste unitário do agrupamento.
- **Economia estimada:** HIPÓTESE — 130ms × (tarefas mudadas − grupos) por sync; com 200 mudadas, ~25s → ~1s.

### AUD-15 — resolveApproval aprova a versão do brief (33)
- **Módulo:** jornadas-api (approvals × briefs)
- **Problema:** recorte mínimo da face "aprovação decorativa" de AUD-06: `resolveApproval` (`approvals/service.ts:113-124`) não toca o recurso. Resolver `approved` não marca `brief.approvedVersionId`; `rejected` não bloqueia `sendBriefToProduction` (que só checa `approvedVersionId`, `briefs/service.ts:209`). CONFIRMED_BY_CODE (reverificado). (G1)
- **Fluxo atual:** dois sistemas paralelos — "Aprovar esta versão" (direto, com efeito) e "Pedir aprovação" (fila, sem efeito).
- **Automação proposta:** em `resolveApproval`, quando `resourceType='brief'` e `status='approved'`, marcar a versão mais recente do brief como aprovada; quando `rejected`, registrar bloqueio consultado por `sendBriefToProduction`. Resolve G1 e G8 (funil do control-center) ao mesmo tempo.
- **Fluxo futuro:** a fila de aprovação governa de fato a ida para produção.
- **Benefício:** aprovação deixa de ser teatro; KPI do funil passa a medir o real.
- **Impacto:** alto. **Esforço:** M (uma query a mais no service + regra de bloqueio). **Risco:** médio — muda o gate de produção; briefs já aprovados por fora precisam de caminho de compatibilidade.
- **Dependências:** decisão sobre o que fazer com pedidos antigos; AUD-06 cobre a cadeia completa.
- **Permissões envolvidas:** `approvals:write`, `briefs:write` (já existentes).
- **Testes necessários:** approve → approvedVersionId setado; rejected → send-to-production recusa; `approvals/routes.test.ts` já cobre resolução atômica (testes-fase-11.md §4).
- **Economia estimada:** HIPÓTESE — elimina a dupla verificação manual "aprovei aqui, mas e ali?"; não quantificável sem dados de uso da fila.

### AUD-16 — Filtro server-side por cliente em threads e aprovações (33)
- **Módulo:** contexto-inteligencia (ficha do cliente)
- **Problema:** a ficha busca `useInboxThreads({})` e `useApprovals({})` sem filtro (pagina 30 por padrão, `communications/routes.ts:26`) e filtra por clientId no navegador (`clients/[id]/page.tsx:96-101`). StatCard "Conversas" e abas Conversas/Aprovações **subcontam** qualquer cliente fora das 30 mais recentes. CONFIRMED_BY_CODE. (P1 de contexto-inteligencia)
- **Fluxo atual:** números da ficha mentem para baixo conforme a carteira cresce.
- **Automação proposta:** `client_id` no schema de `GET /inbox/threads` (o campo já está no payload, :35/:50) e de `GET /approvals`; ficha passa a filtrar na rota.
- **Fluxo futuro:** contagens corretas por construção, sem `limit=100` de remendo.
- **Benefício:** dados da ficha confiáveis; corrige na raiz.
- **Impacto:** médio-alto. **Esforço:** M. **Risco:** baixo-médio (filtro novo em rotas com paginação; cobrir cross-tenant).
- **Dependências:** nenhuma; potencializa AUD-08.
- **Permissões envolvidas:** escopo de tenant nas duas rotas (já existente), `clientBelongsToTenant`.
- **Testes necessários:** teste de rota com filtro + paginação + tenant errado.
- **Economia estimada:** HIPÓTESE — decisões sobre cliente com número errado; não quantificável.

### AUD-17 — client_id no modal de evento (31)
- **Módulo:** contexto-inteligencia (calendar × ficha)
- **Problema:** `POST /calendar/events` aceita `client_id` (validado contra o tenant, `calendar/routes.ts:154-158`), mas `CreateEventModal` monta o payload sem client_id e sem campo de cliente (`create-event-modal.tsx:53-63`). A aba Calendário da ficha filtra por clientId — reunião marcada pela tela nunca aparece lá. CONFIRMED_BY_CODE. (P2 de contexto-inteligencia)
- **Fluxo atual:** evento criado pela UI é invisível na ficha do cliente.
- **Automação proposta:** campo de cliente no modal; CTA "Marcar reunião" na ficha abrindo o modal com `client_id` fixo e participantes sugeridos = assignments do cliente (O4).
- **Fluxo futuro:** evento nasce vinculado; aba Calendário da ficha funciona.
- **Benefício:** fecha o elo evento↔cliente sem dado novo.
- **Impacto:** médio. **Esforço:** P. **Risco:** baixo.
- **Dependências:** nenhuma.
- **Permissões envolvidas:** `calendar:write` (existente), validação de tenant já na rota.
- **Testes necessários:** teste de rota com client_id de outro tenant (já validado em :154-158 — rotas de calendar estão entre os 51 skips por falta de banco; ver AUD-31); teste de componente do modal.
- **Economia estimada:** HIPÓTESE — segundos por evento + reuniões "perdidas" evitadas.

### AUD-18 — Cache curto de `getTeamMembers` (31)
- **Módulo:** clickup-gateway / performance
- **Problema:** cada resolução de pessoa (`resolveMemberByName`/`findMemberByName`/`findMemberByEmail`) faz 1 GET /team inteiro (`clickup-client.ts:130,183,238`) sem cache — a chamada mais repetida do sistema (todo vínculo, todo GET /collaborators, todo comando do Bento com nome). Sob rate limit, rajada falha sem segunda chance (ver AUD-20). CONFIRMED_BY_CODE. (§3.1 de clickup-gateway)
- **Fluxo atual:** N nomes = N GETs idênticos por comando.
- **Automação proposta:** cache de 30-60s por teamId+credencial; invalidação por tempo basta (membros mudam raramente).
- **Fluxo futuro:** resolução de pessoa custa rede uma vez por minuto, não por nome.
- **Benefício:** menos latência de agente e menos exposição a 429.
- **Impacto:** médio-alto (F=5). **Esforço:** M (cache compartilhado entre API e worker ou por processo). **Risco:** médio — membro novo demora até 60s para resolver; aceitável, documentar.
- **Dependências:** nenhuma.
- **Permissões envolvidas:** nenhuma.
- **Testes necessários:** teste de TTL e de chave por credencial.
- **Economia estimada:** HIPÓTESE — N−1 GETs por comando com N nomes; sem contagem de comandos/dia, não quantificável.

### AUD-19 — GrantAccessForm: select de membros em vez de e-mail digitado (30)
- **Módulo:** contexto-inteligencia (clients/access)
- **Problema:** `grant-access-form.tsx:24-31` pede e-mail digitado para a MESMA população que o `ClientTeamPanel` ao lado já lista via `useCollaborators` (:33, :65-76); o backend valida membership. Typo = 404. CONFIRMED_BY_CODE. (O1)
- **Automação proposta:** select de membros da org. **Esforço:** P. **Risco:** baixo.
- **Permissões envolvidas:** `clients:write` na rota /access (existente).
- **Testes necessários:** teste de componente.
- **Economia estimada:** HIPÓTESE — elimina 404 por typo; baixa frequência.

---

## 5. Backlog P2 (score 20–29)

Tabela compacta; detalhes completos nas fontes referenciadas. Todos os scores na matriz da seção 2.

| ID | Item / Módulo | Problema (evidência) | Automação proposta → fluxo futuro | Esf./Risco | Dependências / Permissões | Testes | Economia (HIPÓTESE) |
|---|---|---|---|---|---|---|---|
| AUD-20 | Retry 429 compartilhado — tool-gateway | Só `queryOperationTasks` tem retry 429 (`clickup-operation.ts:232-248`); `clickup-client.ts` e `clickup-oauth.ts` estouram 429 cru (grep: zero ocorrências). CONFIRMED_BY_CODE | Extrair o retry com Retry-After (já testado) para o `fetchClickUp` (`clickup-client.ts:54`) → as 25 operações ganham resiliência com uma mudança | M / médio | Nenhuma / nenhuma | Teste de retry no fetchClickUp com fetch mockado | Rajadas de escrita do executor deixam de falhar sem segunda chance |
| AUD-21 | Split do gate de `/approvals` — jornadas-web | `approvals/page.tsx:198-205` devolve "Acesso restrito" a não-master ANTES de `BusinessApprovalsSection` (:216), contradizendo a decisão registrada em `nav-items.ts:217-223`. CONFIRMED_BY_CODE | Early return só na seção de tool-calls (o hook `useToolCalls(isMaster)` já recebe o flag) → colaborador usa a fila de negócio que a API já permite | P / médio (gate de acesso) | Confirmar que a API permite colaborador em `approvals/*` (NOT_VERIFIED — jornadas-web.md §5) / `approvals:read`/`write` | Teste de página por papel; e2e | Fila de aprovação usável por quem opera; hoje o item de menu é uma parede |
| AUD-22 | Filtro de QA no caminho do webhook — clickup-sync | `ehTarefaDeTeste` (`quadro-geral.ts:137-143`) não é aplicado em `sincronizar-webhook.ts` (grep vazio); task "QA Gate..." vira cartão no quadro geral e cartões de QA acumulam em "Concluído" no sync (`pipeline/routes.ts:1027-1031`). CONFIRMED_BY_CODE | Aplicar `ehTarefaDeTeste(params.taskName)` em `sincronizarNoQuadroGeral` (:113) + soft-delete em vez de "Concluído" no sync → quadro sem cartões-fantasma. Médio prazo: migrar para tag `qa-artifact` ou lista de QA (clickup-sync.md §3) | P / médio (falsos positivos por nome) | Nenhuma / nenhuma | Estender `quadro-geral.test.ts` e `sincronizar-webhook.test.ts` | Higiene contínua do quadro sem intervenção manual |
| AUD-23 | `GET /clickup/tasks/:id` — clickup-gateway | Não existe endpoint de detalhe de task (únicos GETs: members :949, agency :993, me :1053, comments :1132) apesar de `getTask` (`clickup-client.ts:653`) devolver tudo. CONFIRMED_BY_CODE | Rota fina delegando a `getTask` com checagem de dono da lista → desbloqueia tela de detalhe (hooks e row já existem, `clickup-task-row.tsx`) | P / baixo | Nenhuma / `clickup:write` ou read equivalente, dono da lista | Teste de rota com getTask mockado | Habilita feature; sem economia direta |
| AUD-24 | Fechar a oferta "dia útil seguinte" do Bento — agentes | O Bento oferece "jogar pro dia útil seguinte?" (`bento-proatividade.ts:84`) mas `proximoDiaUtil` (:131) não tem chamador fora do teste; um "sim" cai no classificador genérico. CONFIRMED_BY_CODE | Detectar a afirmativa após a oferta e executar `update_task` com `proximoDiaUtil` (executor com read-back já existe) → promessa cumprida | M / médio (escrita por conversa) | Fluxo de seleção de conversa para carregar o alvo / cadeia de escrita do Bento (guard + cerca) | Teste do fechamento de circuito + matriz do guard | Atalho proativo real; hoje é promessa vazia |
| AUD-25 | Studio com cliente pré-selecionado — contexto-inteligencia | Form do Studio exige escolher cliente do zero (`job-form.tsx:382-393`); deep link só entende `?asset=` (`studio-content.tsx:125`). CONFIRMED_BY_CODE | CTA "Gerar peça" na ficha → `/studio?client=<id>` lido pelo job-form (BrandKitSummary já reage ao clientId, :112-122) | P / baixo | Nenhuma / `studio:write` | Teste de componente do form com param | Segundos por peça gerada a partir da ficha |
| AUD-26 | auditarAcao no PATCH de cartão — permissoes-seguranca | O drag escreve no ClickUp real com válvula (`pipeline/routes.ts:1227,1275`) e NÃO chama `auditarAcao`; idem POST/DELETE de cartão. A única escrita humana direta no ClickUp de produção não deixa rastro — justo "quem moveu essa tarefa?". CONFIRMED_BY_CODE | `auditarAcao` com `resourceType:'pipeline_card'`, old/new stage e `clickupStatus` (colunas old/new já existem, `auditoria.ts:43-46`) → rastro completo do drag | P / baixo | Nenhuma / nenhuma (registro interno) | Teste de rota do PATCH (ver AUD-31) | Auditoria responde sem forense manual |
| AUD-27 | Logar a causa do inference-warmth — automacoes | 276 falhas idênticas (`[inferencia] aquecimento falhou`, ttftMs ≈10s) e o `.catch(() => null)` (`inference-warmth.ts:140`) engole o motivo. CONFIRMED_BY_CODE o sintoma; causa não determinada | Capturar e logar a mensagem de erro (:140-145) → próxima falha diz por quê | P / baixo | Nenhuma / nenhuma | Teste do keeper com fetch rejeitado | Diagnóstico de minutos em vez de hipótese |
| AUD-28 | Reconciliação agendada de pipeline — clickup-sync | O religar de webhook cobre suspensão, mas eventos perdidos na janela não voltam (`integration-health.ts:82-116`); o quadro depende de alguém abrir a tela e sincronizar. CONFIRMED_BY_CODE | Job do worker rodando a lógica de `sincronizar-tarefas` do quadro geral (`pipeline/routes.ts:974-1048`, idempotente) a cada N minutos → janela de perda fechada sem clique | M / médio (custo de ClickUp por ciclo) | Respeitar rate limit; combina com AUD-14 / nenhuma | Teste do job com sync mockado | Elimina o sync manual como rede de segurança |
| AUD-29 | Instalar plist de fichas do Bento — automacoes | Agendamento de 06:30 existe só no papel: plist não instalado, placeholder `/CAMINHO/DO/brain-desigual` no repo (`infra/launchd/com.desigualos.fichas.plist`); hoje depende de rodar `sincronizar-fichas.sh` na mão. CONFIRMED_IN_RUNTIME (ausência) | Instalar o plist com caminho real (ou apagar do repo e de CLAUDE.md) → fichas diárias sem ação humana | P / baixo | Máquina do vault / nenhuma | Verificação de log `/tmp/desigualos-fichas.log` após 1 dia | ~1 execução manual/dia eliminada |
| AUD-30 | Teto de retenção na fila `automations` — automacoes | `getAutomationsQueue` (`automation-queue.ts:14-17`) sem `removeOnComplete/removeOnFail`; o teto de `queues.ts` foi aplicado à `daily-digest` (`scheduler/index.ts:70-73`) mas não aqui. Com automação horária, Redis acumula sem fim. CONFIRMED_BY_CODE | Copiar `removeOnComplete: 100, removeOnFail: 500` → retenção finita | P / baixo | Nenhuma / nenhuma | Teste de configuração da fila | Previne degradação de Redis medida em 18/09 na outra fila |
| AUD-31 | Testes de rota do pipeline + banco descartável — testes-fase-11 | `pipeline/routes.ts` (1.330+ linhas, 11 endpoints, incl. o drag que escreve no ClickUp) tem ZERO teste de rota; 51 testes de tenant dormem por falta de `TENANT_TEST_DATABASE_URL` (`testes-fase-11.md` §3-4). CONFIRMED_BY_TEST (ausência) | Montar app Fastify injetando PATCH de cartão com ClickUp mockado, assertando a válvula; exportar banco efêmero para os 51 skips → jornadas Calendar/relatórios/cross-tenant saem de NOT_TESTED | M / baixo | Postgres local efêmero em CI / nenhuma | Os próprios testes são o entregável | Regressões do caminho mais perigoso (escrita humana no ClickUp) pegas em CI |
| AUD-32 | textoExternoSeguro no worker e na menção — permissoes-seguranca | A defesa estrutural contra prompt injection (`texto-externo.ts:63-69`) tem ZERO uso fora do context-engine; nomes de task vão crus ao prompt (`campaign-context.ts:213-216`) e o comentário de menção vai cru ao LLM (`bento-mention.ts:80-82`). CONFIRMED_BY_CODE | Aplicar o helper em `formatCampaignBlock` e na pergunta da menção → classe de ataque documentada em 18/09 fechada também no worker | M / médio (pode truncar conteúdo legítimo) | Exportar helper para pacote importável pelo worker / nenhuma | Testes de sanitização (8 já existem no context-engine) + regressão de prompt | Remoção de risco, não tempo |
| AUD-33 | Cache de `listStatusDetailsForList` — performance | Cada drag no quadro geral (:1264) e cada uma das 15 listas de `estagiosDasMinhasTarefas` (:282) vai ao ClickUp; o fluxo de status de lista quase nunca muda. CONFIRMED_BY_CODE | Cache TTL 5min invalidado por webhook + fallback de `estagiosDaLista` (:212-213) com `includeClosed:false, subtasks:false` → drag sem chamada extra | M / médio | AUD-09 reduz invalidações cegas / nenhuma | Teste de TTL e fallback | ~2-3 chamadas ClickUp a menos por drag no quadro geral |
| AUD-34 | Caminho de criação do quadro geral na UI — jornadas-web | Não há opção na UI nem no POST para criar quadro geral (API rejeita quadro de tarefas da agência sem cliente, `pipeline/routes.ts:506-514`; o geral é tratado em :296-297,969-992). Se o quadro de produção for apagado, ninguém o recria pela interface. INFERRED (pode existir seed/script não visto) | Opção "Agência inteira" no `NovaPipelineModal` (`pipeline/page.tsx:248-263`) → a API já sabe organizar (`garantirEstagiosGerais`) | P / baixo | Nenhuma / master (criação de quadro da agência) | Teste de rota de criação + componente do modal | Recuperação de desastre sem script manual |

---

## 6. Backlog P3 (score < 20)

| ID | Item / Módulo | Problema (evidência) | Automação proposta | Esf./Risco | Notas |
|---|---|---|---|---|---|
| AUD-35 | Boot log de alertas — arquitetura | `sendOpsAlert` é no-op silencioso sem `ALERT_SLACK_WEBHOOK_URL` (`alerts.ts:24-25`); estado da env NOT_VERIFIED | Linha de boot "alertas: CONFIGURADOS/MUDOS" (padrão de `worker/index.ts:222-225`) | P / baixo | Pré-requisito de confiança para AUD-02 e watchdog |
| AUD-36 | Uma task só por demanda — jornadas-api | Criação da demanda gera task espelho; send-to-production gera OUTRA "[Brief] ..." sem FK entre elas (`demands/service.ts:73`, `briefs/service.ts:238-251`). CONFIRMED_BY_CODE (G5) | Reusar `demands.clickupTaskId` no send-to-production (atualizar a task espelho) | M / médio | Mudança de modelo de dados operacional; fazer junto ou depois de AUD-06 |
| AUD-37 | Root-cause do reconciliador de automações — automacoes | `reagendadas: 1` a cada 15 min (132 ocorrências) apesar do repeatable existir e disparar — `getRepeatableJobs()` não o devolve (`reconciliar-automacoes.ts:113-114`). CONFIRMED_IN_RUNTIME o comportamento; causa INFERRED | Logar ids quando `reagendadas>0` por um ciclo ou comparar com `proximasExecucoes()` | M / baixo | O warn virou ruído; esconderia dessincronia real |
| AUD-39 | Topologia GPU gateway / Redis↔studio-node — arquitetura | `gpu-gateway.ts:190` escuta 0.0.0.0:11500 mas o compose não publica porta (`docker-compose.prod.yml:88-115`); studio-node consome fila de Redis sem porta publicada (:43-47). Reachability NOT_VERIFIED | Publicar porta na interface tailscale ou documentar desativação | M / médio | Hoje o comentário promete o que o compose não entrega |
| AUD-38 | Outcome real em automation_runs — automacoes | `automation_runs` registra `dispatched` mesmo quando a resposta é pedido de esclarecimento do guard (log de hoje 16:00:09→16:00:18, conversa c13cd01b); `success_rate` conta como êxito (`automations/routes.ts:184`). INFERRED com evidência forte de log — confirmar lendo a conversa | Gravar outcome real (respondeu/esclareceu/falhou) e reescrever o prompt da automação sem verbos de despacho | M / médio | Métrica honesta da tela /workflows |
| AUD-40 | Autorizar autor de menção — permissoes-seguranca | Webhook autentica o ClickUp, não o AUTOR do comentário; qualquer membro/convidado do workspace dispara LLM e resposta pública com a chave da agência (`clickup/routes.ts:1292-1335`). CONFIRMED_BY_CODE | Responder só se o autor resolver para `users` ativo (reusar `resolverPessoaPorClickupUserId`, já importado em routes.ts:5) | M / médio | Raio limitado: resposta é só comentário; combina com AUD-32 |
| AUD-41 | Paginar/recortar GET /pipelines — performance | Dois queries trazem TODOS os boards + TODOS os cartões sem limit (`pipeline/routes.ts:378-409`); com o quadro geral cheio (~1.239 cartões possíveis, comentário :320) o JSON é o maior payload recorrente do app. INFERRED o tamanho (0,5-0,9 MB estimado) | Boards sem cards + `GET /pipelines/:id/cards` sob demanda | M / médio | Esperar AUD-09 (invalidação WS) para não amplificar refetches |
| AUD-42 | Verificação forte do webhook WhatsApp — jornadas-api | Verificação por `apikey` no corpo do payload (`communications/routes.ts:205-210`), mais fraca que assinatura; nunca testado contra Evolution real (BLOCKED_EXTERNAL, :174-186). CONFIRMED_BY_CODE | Assinatura/segredo por header conforme o vendor ativo (W-API) + teste contra instância real | M / médio | Exige acesso à instância real; WhatsApp hoje declarado como não conectado no inbox (jornadas-web.md, `inbox/page.tsx:95-97`) — prioridade sobe quando o canal ligar |

---

## 7. Sequenciamento sugerido

Ordem de execução que respeita dependências e mantém quick wins cedo:

1. **Semana 0 (verificações, sem código):** AUD-02 (inscrição do webhook), AUD-05 (restart do worker + decisão das flags), confirmação de env de AUD-03 e AUD-07 (`CLICKUP_WRITE_SCOPE_LIST_ID`, `INTEGRATION_ENCRYPTION_KEY` por processo). São NOT_VERIFIED que mudam a severidade de três P0.
2. **Onda 1 (quick wins P, score alto):** AUD-01 (dedup — uma linha, para de perder dado hoje), AUD-09, AUD-11, AUD-12, AUD-13, AUD-19, AUD-22, AUD-26, AUD-27, AUD-30.
3. **Onda 2 (P1 de esforço M):** AUD-10, AUD-08 (+AUD-16 no mesmo front da ficha), AUD-14, AUD-15, AUD-17, AUD-18, AUD-21.
4. **Onda 3 (estruturais P0):** AUD-03 + AUD-04 (juntos — mesma fronteira de escrita), AUD-06 (com dry-run), AUD-07 (com leitura dual e janela de migração).
5. **Contínuo:** AUD-31 (testes) acompanha cada onda; P2/P3 entram conforme a onda toca o módulo (ex.: AUD-33 e AUD-28 junto com AUD-14; AUD-32 e AUD-40 junto com AUD-03).

---

## 8. Cobertura das fontes e limitações

- **Fontes cobertas:** todos os 11 relatórios contribuíram com pelo menos um item (agentes: AUD-24; arquitetura: AUD-35, AUD-39; automacoes: AUD-05, AUD-27, AUD-29, AUD-30, AUD-37, AUD-38; clickup-gateway: AUD-18, AUD-20, AUD-23; clickup-sync: AUD-01, AUD-02, AUD-09, AUD-22, AUD-28; contexto-inteligencia: AUD-16, AUD-17, AUD-19, AUD-25; jornadas-api: AUD-06, AUD-08, AUD-13, AUD-15, AUD-36, AUD-42; jornadas-web: AUD-11, AUD-12, AUD-21, AUD-34; performance-fase13: AUD-10, AUD-14, AUD-33, AUD-41; permissoes-seguranca: AUD-03, AUD-04, AUD-07, AUD-26, AUD-32, AUD-40; testes-fase-11: AUD-31).
- **Não entram no backlog** (achados das fontes classificados como documentação/higiene, sem automação associada): correção de docs desatualizadas (`brain/03`, comentário do CI, `mocks/pipeline.ts:18`, auditorias antigas), remoção de código morto (`removeTaskFromList`, `createFolder`, `createList`, `groupTasksByClient`, desigual-node), renomear `/knowledge`, nomes hardcoded na tela Hoje. São legítimos, mas são tarefas de manutenção, não automação.
- **Dados insuficientes (declarados, não inventados):** (1) estado real das env na VPS — muda a severidade final de AUD-02/03/04/07/35; (2) inscrição real do webhook; (3) contagens de uso em produção (eventos/dia, visitas/tela, demandas/semana) — sem elas toda economia é HIPÓTESE; (4) topologia real do worker de produção (VPS × Mac local); (5) se a API permite colaborador em `approvals/*` (AUD-21); (6) payload real de webhook com `history_items[].id` (AUD-01); (7) banco de produção (quadro geral existente, uso da conta qa-motion, volume de sinais).
- **Escopo:** este documento não edita código; classificações DEPLOYED seguem o SHA `419dd4d` confirmado em `/health` (agentes.md §2). Estados de produção dependentes de env/banco permanecem NOT_VERIFIED como indicado item a item.
