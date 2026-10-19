# Oportunidades de Automação — Desigual OS

**Data:** 15/10/2026 · **HEAD auditado:** `419dd4d` (branch `feat/otto-motion-engine`; API deployada na VPS no mesmo SHA, web na Vercel).
**Fontes:** os 11 relatórios de `artifacts/auditoria-2026-10-15/` (arquitetura, agentes, automações, clickup-gateway, clickup-sync, contexto-inteligencia, jornadas-api, jornadas-web, performance-fase13, permissoes-seguranca, testes-fase-11). Achados de segurança e de testes são tratados nos documentos próprios da série; aqui entram só quando viram trabalho operacional.
**Método:** toda oportunidade nasce de uma limitação observada com evidência `arquivo:linha`. As 4 afirmações mais críticas foram re-verificadas no código nesta sessão de redação (marcadas "re-verificado 15/10").
**Etiquetas:** CONFIRMED_BY_CODE / CONFIRMED_BY_TEST / CONFIRMED_IN_RUNTIME / CONFIRMED_IN_DEPLOY / INFERRED / NOT_VERIFIED.

**Regra determinístico vs IA (Fase 11.1 do mandato):** regra simples onde basta; LLM só para interpretação, classificação, resumo e sugestão. Cada proposta abaixo declara seu tipo.

---

## 1. O que o Bento 3.1 já cobre (não duplicar)

Antes de listar oportunidades, o que já existe e NÃO é oportunidade nova (CONFIRMED_BY_CODE, detalhes em `artifacts/auditoria-2026-10-15/agentes.md` §1.2):

- Criação/edição/comentário de tarefas pelo chat com verificação read-back (`bento-action-guard.ts:1497`, `bento-update-executor.ts`).
- Escrita estruturada via core OpenAI + executor MCP-first (`bento-openai-core.ts:276`, `bento-mcp-executor.ts:69-76`), atrás de flag default-off.
- Contexto multifonte no prompt (aprovações/demandas/agenda/inbox/mídia) — `contexto-multifonte.ts`, flags ligadas na VPS desde 14/10 (CONFIRMED_IN_DEPLOY por registro em bento-3.1-progress.md:300-302).
- Proatividade: varredura 15/15 min e briefing 8h (`scheduler/bento-varredura.ts`, `bento-briefing.ts`) — deployados 14/10, **mas ver §4, R0: o worker em produção rodava código de 13/10 na auditoria de automações**, ou seja a proatividade estava no ar só no fonte (CONFIRMED_IN_RUNTIME por ps + log de boot, automacoes.md §3.4).
- Atalhos determinísticos: panorama, segmentação de campanha, documentos/ata, exportação Notion, handoff Bento→Jarbas.
- Vínculo automático usuário↔ClickUp por e-mail (`apps/api/src/lib/vinculo-clickup.ts:15-29`), wired em `/me`, `/clickup/tasks/me` e pipeline.

Onde uma oportunidade abaixo é "fechar o circuito" de algo que o Bento 3.1 já oferece, isso está dito explicitamente.

---

## 2. Matriz das frentes A–L

| Frente | Oportunidade real? | Resumo |
|---|---|---|
| A. Criação inteligente de tarefas | **Parcial** — majoritariamente coberta pelo Bento 3.1 | Residual: unificar delete no executor MCP; ligar registro de tempo |
| B. Demanda → ClickUp | **Sim** | Espelho sem prazo, task duplicada por demanda, status terminal sem caminho |
| C. Inbox → demanda → tarefa | **Sim** — a frente mais bloqueada | Thread nasce sem cliente e não há rota de vínculo; conversão redigita título |
| D. Briefing automático | **Sim** | Rascunho de brief é concatenação crua; extração estruturada é caso de LLM legítimo |
| E. Responsável inteligente | **Sim** | Oferta proativa sem executor; mapeamento user→assignee ausente; sugestão por assignments |
| F. Prazos / prioridades | **Sim** | Oferta "dia útil seguinte" sem executor; prazo não chega ao ClickUp; prioridade 100% manual |
| G. Aprovações | **Sim** | Aprovação de brief é decorativa; tool_call aprovado não executa |
| H. Sincronização | **Sim** | Sem volta ClickUp→demanda; reconciliação agendada; invalidação de quadros via WS |
| I. Notificações | **Limitada** | Coberta pelo Bento 3.1 (varredura/briefing); residual: alertas de ops e sinais de carteira no /today |
| J. Bento como camada operacional | **Sim, mas de fechamento** | O que falta é executar o que ele já oferece (E/F) e honestidade de outcome |
| K. Pipeline inteligente | **Não como automação nova** | As lacunas são correções de sincronia/custo (§4), não automação de decisão |
| L. Onboarding | **Sim, pequena** | Vínculo automático já existe; residual: concessão de acesso por select e fichas do Bento |

Frentes **sem** oportunidade de automação nova: **K** (o pipeline já é bidirecional; o que falta é confiabilidade, §4) e, na prática, o núcleo de **I** (já é o Bento 3.1; os 188 sinais da 1ª varredura não chegarem à equipe é lacuna de dados — 0 contas com `clickup_email` — já registrada em bento-3.1-progress.md:310-312, não reaberta aqui).

---

## 3. Oportunidades por frente

### A. Criação inteligente de tarefas

O grosso já existe (Bento 3.1: create/multi-create com read-back, criação via MCP). Duas oportunidades residuais:

**A1 — Delete pelo mesmo caminho MCP (ou resposta honesta de provedor)**
- **Problema:** usuário com token OAuth do ClickUp MCP tem create/update/comment pelo executor MCP, mas delete cai no guard legado REST — dois caminhos de escrita para o mesmo usuário.
- **Evidência:** `MCP_SUPPORTED_INTENTS = create/update/comment` em `apps/worker/src/processors/bento-mcp-executor.ts:52`; delete só no guard legado (`bento-action-guard.ts:1556-1599`). CONFIRMED_BY_CODE.
- **Fluxo atual:** usuário pede delete → guard legado intercepta antes do core → executa via REST com confirmação em duas voltas.
- **Proposta (determinística):** ou estender `MCP_SUPPORTED_INTENTS` com delete mantendo a confirmação em duas voltas como política (não do modelo), ou declarar na resposta qual provedor executou — o envelope já carrega `provider`; verificar se chega à UI (NOT_VERIFIED).
- **Benefício:** um só caminho de escrita por usuário; auditoria uniforme.
- **Não automatizar:** a confirmação humana do delete em si — já é regra do sistema e deve continuar.

**A2 — Ligar o registro de tempo (`registrarTempo`)**
- **Problema:** a função existe, está wired no executor do Bento, mas o workspace ClickUp recusa (ClickApp Time Tracking desligado, erro TIMEENTRY_072 traduzido).
- **Evidência:** `packages/tool-gateway/src/clickup-client.ts:1001` e mensagem de erro pronta em `:991-1024`; caller `bento-update-executor.ts` (import :6). CONFIRMED_BY_CODE.
- **Proposta (zero código novo):** ligar o ClickApp "Time Tracking" no workspace. CONFIRMED_BY_CODE que é configuração, não código.
- **Benefício:** "registra 2h nessa task" vira comando executável do Bento.
- **Não automatizar:** validação de horas faturáveis — julgamento de quem lança.

### B. Demanda → ClickUp

**B1 — Uma task por demanda, com prazo, espelhada nas duas direções**
- **Problema atual:** criar demanda gera task espelho; "enviar para produção" gera **outra** task "[Brief] ..." sem vínculo com a primeira; o prazo da demanda não vai em nenhuma das duas; e `done/cancelled` só existe via PATCH sem chamador na UI — quinzena nunca termina e o KPI "Quinzenas abertas" cresce para sempre.
- **Evidência:** espelho sem `dueDate` em `apps/api/src/demands/service.ts:105-108`; segunda task em `apps/api/src/briefs/service.ts:238-251`; `updateDemandStatus` em `demands/service.ts:178-199` sem chamador web (grep em `apps/web`, jornadas-api.md §3 G3/G4/G5); KPI em `apps/api/src/agency-control-center/routes.ts:117`. CONFIRMED_BY_CODE.
- **Fluxo atual:** demanda criada → task A (título+descrição) → brief aprovado → task B criada → ninguém atualiza task A → status terminal inalcançável pela interface.
- **Proposta (determinística):** (1) passar `dueDate` no espelho e defaultar o send-to-production para `demand.dueDate` quando o body vier vazio (a UI chama com `{}` — `apps/web/src/hooks/use-briefs.ts:65`); (2) reutilizar `demands.clickupTaskId` no send-to-production, atualizando a task espelho em vez de criar "[Brief]"; (3) expor o PATCH de status na tela `/demands/[id]`.
- **Fluxo futuro:** uma task ClickUp por demanda, do nascimento ao `done`, com prazo igual nos dois lados.
- **Benefício:** quadro de pipeline (que segue o `clickupTaskId`) passa a contar a vida inteira da demanda; KPI de atrasados deixa de ser ruído permanente.
- **Reaproveitar:** `demands.clickupTaskId/clickupTaskUrl` já existem no schema (`packages/database/src/schema/demands.ts:19`); mapa de status já existe (`pipeline/quadro-geral.ts:categoriaDoStatus`); rota PATCH já testada (jornadas-api.md §5, 40/40 verdes).
- **Não automatizar:** a decisão de cancelar uma quinzena — transição terminal deve ser gesto humano explícito.

### C. Inbox → demanda → tarefa

A frente mais bloqueada do sistema: o caso comum (contato novo) não consegue virar demanda.

**C1 — Vínculo contato/thread → cliente**
- **Problema atual:** o webhook do WhatsApp cria contato com `clientId: null` e **nenhuma rota da API escreve** `contacts.clientId` ou `conversationThreads.clientId`. A aba "Quinzenas" do inbox renderiza `<SemCliente />` e a conversão em demanda é impossível para qualquer contato novo.
- **Evidência:** `apps/api/src/communications/routes.ts:220` (insert com null); grep sem nenhuma rota de escrita (jornadas-api.md §3 G2); painel esperando clientId em `apps/web/src/components/inbox/thread-context-panel.tsx:116`. CONFIRMED_BY_CODE.
- **Fluxo atual:** mensagem chega → thread órfã → atendente lê, abre o ClickUp na mão, cria tarefa fora do OS.
- **Proposta (determinística + sugestão por IA opcional):** `PATCH /inbox/threads/:id/client` escrevendo o vínculo; na UI, select de clientes do tenant. Camada opcional de IA: sugerir o cliente pelo histórico do telefone/nome — sugestão, nunca gravação automática.
- **Fluxo futuro:** mensagem chega → atendente vincula em 1 clique → painel de quinzenas do inbox destrava.
- **Benefício:** desbloqueia C2 e toda a cadeia inbox→demanda→ClickUp para o caso comum.
- **Reaproveitar:** `ClientDemandsPanel` já está pronto esperando `clientId`; `clients` do tenant já vêm de `useClients`.
- **Não automatizar:** o vínculo definitivo — cliente errado em thread é pior que thread sem cliente; IA sugere, humano confirma.

**C2 — "Virar quinzena" pré-preenchido**
- **Problema atual:** converter thread em demanda exige redigitar o título, mesmo com o texto da 1ª mensagem já gravado.
- **Evidência:** `apps/web/src/components/clients/client-demands-panel.tsx:51-58` (conversão manual); webhook grava `pushName` e texto (jornadas-api.md §4.3). CONFIRMED_BY_CODE.
- **Proposta (determinística, com IA opcional):** pré-preencher o título com a 1ª mensagem inbound da thread (já disponível via `listMessages`). Camada IA legítima: resumir a conversa em título+descrição de demanda — caso de uso de resumo, com edição humana antes de salvar.
- **Benefício:** elimina a redigitação no elo SOLICITAÇÃO→DEMANDA, hoje o mais manual da cadeia (tabela de elos em jornadas-api.md §2).
- **Não automatizar:** criação silenciosa de demanda sem revisão — demanda é objeto de negócio, não de log.

### D. Briefing automático

**D1 — Rascunho de brief com extração estruturada**
- **Problema atual:** `draftBriefFromDemand` concatena todas as mensagens inbound em `notes`; os campos estruturados (`objective`, `deliverable`, `channel`...) nascem sempre vazios e a pessoa redige tudo. O próprio cabeçalho declara o andaime.
- **Evidência:** `apps/api/src/briefs/service.ts:121-151` (concatenação com `sourceEvidence`, documentado como andaime). CONFIRMED_BY_CODE.
- **Fluxo atual:** demanda com mensagens → "Gerar rascunho" → notes lotado, campos vazios → redação do zero.
- **Proposta (IA — caso legítimo de interpretação/extração):** LLM preenche os campos estruturados a partir das mensagens, mantendo `sourceEvidence` por campo; cada versão continua imutável (`brief_versions`, unique (brief_id, version)), então o rascunho da IA é só mais uma versão editável.
- **Fluxo futuro:** rascunho nasce com objetivo/entregáveis/canal preenchidos e evidência linkada; humano edita e aprova.
- **Benefício:** o elo DEMANDA→BRIEFING deixa de ser redação integral; a estrutura de versionamento já garante rastro.
- **Reaproveitar:** `brief_versions` (imutabilidade), `sourceEvidence` (já populado), rota `POST /demands/:id/draft-brief` já existe.
- **Não automatizar:** aprovação da versão e envio à produção — decisão de negócio (ver G1: hoje a aprovação nem tem efeito; corrigir o efeito vem antes de qualquer automação).

**D2 — Meeting-brief consistente com prazos reais**
- **Problema:** o meeting-brief já lê demands abertas do cliente, mas sem G4/B1 resolvido os prazos do brief não concordam com o ClickUp.
- **Evidência:** `packages/tool-gateway/src/meeting-brief.ts:84` lê demands; omissão de `deadline` na descrição montada em `briefs/service.ts:216-227`. CONFIRMED_BY_CODE.
- **Proposta (determinística):** depende de B1; com prazo ponta a ponta, o meeting-brief e o "previstas para hoje" do control-center passam a concordar com o ClickUp. Sem oportunidade de código novo aqui além da dependência.
- **Não automatizar:** nada além do já automático.

### E. Responsável inteligente

**E1 — Fechar o circuito "Ficou sem responsável. Me diz de quem é"**
- **Problema atual:** a varredura/briefing do Bento oferece atribuir responsável; se o usuário responde, o turno cai no classificador genérico — a oferta promete um atalho que não existe.
- **Evidência:** texto da oferta em `apps/worker/src/processors/bento-proatividade.ts:93`; executor de update de assignee já existe (`bento-update-executor.ts`, com `resolveMemberByName` wired e testado — clickup-gateway.md §2 #3). CONFIRMED_BY_CODE; ausência de fechamento CONFIRMED_BY_CODE (agentes.md §4.2).
- **Proposta (determinística):** quando a oferta foi emitida para a task T e a resposta seguinte nomeia pessoa, executar `update_task` de assignee com read-back — o mesmo padrão do guard, com resolução de nome já testada (incl. caso "Gui/Guilherme").
- **Reaproveitar:** `bento-update-executor` + `resolveMemberByName` (`clickup-client.ts:182`) + verificação read-back.
- **Não automatizar:** atribuição quando o nome é ambíguo ou ausente — o sistema já adota "null, nunca um palpite" na resolução de owner de demanda (`demands/service.ts:22-29`, CONFIRMED_BY_TEST em demands/routes.test.ts:210-223); manter essa regra.

**E2 — Mapeamento usuário → assignee numérico do ClickUp na produção de brief**
- **Problema:** task de produção nasce sem responsável no ClickUp; a lacuna está documentada no próprio código.
- **Evidência:** `apps/api/src/briefs/service.ts:232-237`. CONFIRMED_BY_CODE.
- **Proposta (determinística):** usar o vínculo que já existe (`users.clickupEmail` → `findMemberByEmail`) para setar assignee no send-to-production, reaproveitando `resolveAccountOwner` (dono `account` da quinzena).
- **Reaproveitar:** `garantirEmailDoClickUp` (`lib/vinculo-clickup.ts:15-29`), `findMemberByEmail` (`clickup-client.ts:129`), `resolveAccountOwner`.
- **Não automatizar:** fallback silencioso — sem mapeamento, nasce sem responsável e se diz isso, como hoje.

**E3 — Sugestão de responsável na criação de cartão (UI)**
- **Problema:** "Novo cartão" abre Responsável vazio mesmo num quadro de um cliente cujos assignments são conhecidos; e a **edição** de cartão pede responsável em texto livre, quebrando agrupamentos ("Matheus" vs "Matheus Rial").
- **Evidência:** criação `apps/web/src/app/(shell)/pipeline/page.tsx:578-625`; edição em texto livre `pipeline/page.tsx:749` vs. select da criação `:621-624` (jornadas-web.md P6); assignments em `GET /clients/:id/assignments` (`clients/routes.ts:484-508`). CONFIRMED_BY_CODE.
- **Proposta (determinística):** ordenar/pré-selecionar por `responsibility='account'/'manager'` do cliente; trocar o input livre da edição pelo select de colaboradores. Sem IA — o dado já é estruturado.
- **Não automatizar:** nada; é prefill, a decisão continua humana.

### F. Prazos / prioridades

**F1 — Fechar o circuito "Quer que eu jogue pro dia útil seguinte?"**
- **Problema atual:** o Bento observa prazo em fim de semana e oferece mover; o helper que calcula a data **não tem nenhum chamador fora do teste**. "Sim" sozinho não autoriza escrita nem carrega o alvo.
- **Evidência:** oferta em `apps/worker/src/processors/bento-proatividade.ts:84`; `proximoDiaUtil` em `:131` sem callers (re-verificado 15/10: grep em apps/worker e packages retorna só a definição e o teste). CONFIRMED_BY_CODE.
- **Proposta (determinística):** detectar afirmativa após a observação de fim de semana → `update_task` com `proximoDiaUtil` + read-back. É o menor "sugere mas não executa" do sistema (agentes.md §4.1).
- **Reaproveitar:** helper de data, executor de update com verificação, texto da oferta — todos os blocos existem.
- **Não automatizar:** mover prazo sem a afirmativa — a oferta→confirmação em duas voltas é o desenho certo; só falta a segunda volta.

**F2 — Prazo ponta a ponta (demanda → ClickUp)**
- Coberto em B1 (é o mesmo defeito, visto pelo lado do prazo). Evidência: `demands/service.ts:105-108`, `briefs/service.ts:243` com UI chamando `{}` (`use-briefs.ts:65`). CONFIRMED_BY_CODE.

**F3 — Prioridade**
- **Estado:** prioridade de demanda é 100% manual; nenhuma classificação automática existe (jornadas-api.md §2, elo CLASSIFICAÇÃO "Fraca"). CONFIRMED_BY_CODE.
- **Avaliação:** **dados insuficientes** para propor automação — não há no repo critério de prioridade da agência (SLA, peso de cliente, janela quinzenal) codificado ou documentado que permita regra determinística, e uma sugestão por LLM sem critério seria ruído. O que falta: definição de negócio do critério. Até lá, nada a automatizar.

### G. Aprovações

**G1 — Aprovação com efeito real**
- **Problema atual:** existem dois sistemas paralelos — "Aprovar esta versão" (marca `brief.approvedVersionId`) e "Pedir aprovação" (cria `approval_requests`). Resolver o pedido como `approved` **não** marca versão; `rejected` **não** bloqueia nada; `sendBriefToProduction` só olha `approvedVersionId`. Ninguém consome `approval.resolved` para agir no recurso. Efeito colateral: o funil do control-center sub-reporta revisão/aprovação por design.
- **Evidência:** `apps/api/src/approvals/service.ts:89-125` (só atualiza a linha + evento); `briefs/service.ts:209`; grep sem consumers de `approval.resolved` (jornadas-api.md §3 G1/G8). CONFIRMED_BY_CODE.
- **Proposta (determinística):** em `resolveApproval`, quando `resourceType='brief'` e `approved`, marcar a versão mais recente como aprovada; bloquear send-to-production com pedido `pending/rejected` para o brief. Uma query a mais no service resolve G1 e G8 (jornadas-api.md §4.1).
- **Benefício:** a fila de aprovação deixa de ser decorativa e o funil passa a medir a operação real.
- **Reaproveitar:** resolução atômica já existe e é testada (`approvals/routes.test.ts:167-207`, CONFIRMED_BY_TEST); evento `approval.resolved` já é gravado.
- **Não automatizar:** a decisão de aprovar/rejeitar — é o julgamento humano que a fila existe para capturar.

**G2 — Execução pós-aprovação de tool_calls (caso Suzy)**
- **Problema atual:** masters aprovam em `POST /tool-calls/:id/approve`, mas a aprovação só marca o registro — `approveToolCall` devolve o input e ninguém executa. Para Suzy, a ação aprovada roda dentro do serviço externo, invisível ao OS: o OS registra o pedido, nunca o resultado.
- **Evidência:** `apps/api/src/tool-calls/routes.ts:234` e `:240-243` (só marca aprovado); Suzy sem caminho de execução no repo (agentes.md §1.4/§3.4); matriz `suzy/instagram write requiresApproval` (`packages/database/src/seed.ts`). CONFIRMED_BY_CODE.
- **Proposta (determinística na orquestração; a ação em si é integração):** executor de Instagram/WhatsApp no repo, atrás do Gateway, disparado pela aprovação e gravando o resultado real na tool_call.
- **Benefício:** a fila de aprovação vira controle de verdade (pedido → aprovação → execução auditável → resultado), hoje quebrada no último elo.
- **Reaproveitar:** fila de tool_calls, notificação de masters, rota de aprovação — tudo já wired.
- **Não automatizar:** publicação sem aprovação — a barreira `requiresApproval` é o produto, não o obstáculo. E o diretório `tool-calls/` tem **zero testes** (testes-fase-11.md §4) — escrever o executor sem teste de rota repete o erro.

### H. Sincronização

**H1 — Volta ClickUp → demanda**
- **Problema atual:** o webhook só move cartões de pipeline; `demands.status` nunca é tocado por evento do ClickUp. Tarefa "concluída" no ClickUp não conclui a quinzena.
- **Evidência:** `handleTaskChanged` (`apps/api/src/clickup/routes.ts:491-663`) sem tocar demands (jornadas-api.md §3 G3). CONFIRMED_BY_CODE.
- **Proposta (determinística):** quando `changed.taskId` bate com `demands.clickup_task_id` ou `briefs.external_task_id`, mapear status fechado do ClickUp → `demands.status='done'` (mapa já existe: `pipeline/quadro-geral.ts:categoriaDoStatus`).
- **Benefício:** fecha a cadeia ACOMPANHAMENTO e esvazia o KPI de quinzenas abertas.
- **Pré-requisito:** R1 (§4) — hoje o dedup do event store descarta todo `taskUpdated` após o primeiro por task; sem corrigir isso, a volta de status perde eventos.
- **Não automatizar:** `cancelled` — cancelamento deve continuar gesto humano (B1).

**H2 — Reconciliação agendada de eventos perdidos**
- **Problema atual:** o religar automático de webhook cobre suspensão futura, mas eventos perdidos na janela não voltam; a sincronia de quadros depende de alguém abrir a tela.
- **Evidência:** religar em `apps/worker/src/scheduler/integration-health.ts:82-116`; sync só sob visita/botão (`apps/web/src/hooks/use-pipelines.ts:60-72`, `pipeline/page.tsx:977-984`). CONFIRMED_BY_CODE.
- **Proposta (determinística):** job do worker rodando a lógica de `sincronizar-tarefas` do quadro geral (`apps/api/src/pipeline/routes.ts:974-1048`) a cada N minutos — a lógica já existe e é idempotente (clickup-sync.md §4.6).
- **Benefício:** elimina a classe "por que esse cartão está na coluna velha?" sem depender de visita à tela.
- **Não automatizar:** cadência agressiva — respeitar a janela de rate limit do ClickUp (100 req/min, comentário `clickup-operation.ts:337`).

**H3 — Invalidação de quadros via WebSocket**
- **Problema:** `clickup.task_changed` invalida só a ficha do cliente; os quadros nunca ficam sabendo do webhook até navegação/mutação local. Divergência garantida entre telas vizinhas.
- **Evidência:** `apps/web/src/hooks/use-realtime-events.ts:68-73`; `usePipelines` sem refetchInterval (`use-pipelines.ts:19-24`). CONFIRMED_BY_CODE (clickup-sync.md P3, performance-fase13.md P7).
- **Proposta (determinística):** invalidar `['pipelines']` no evento, ou publicar `pipeline.card_changed` dedicado em `sincronizar-webhook.ts` para não refazer o GET inteiro (que, com o quadro geral cheio, é o maior payload recorrente do app — INFERRED, performance-fase13.md P5).
- **Benefício:** com H3, o sync-on-open caro (§4, R4) pode virar sob-demanda.

**H4 — Filtro de QA por metadados em vez de nome**
- **Problema:** o filtro de artefatos de QA é regex de nome, aplicado só nas leituras em massa — o caminho do webhook não o usa, e cartões de QA acumulam em "Concluído" no quadro geral.
- **Evidência:** `pipeline/quadro-geral.ts:137-143`; webhook sem o filtro (grep vazio, clickup-sync.md P2). CONFIRMED_BY_CODE.
- **Proposta (determinística):** migrar para dado estrutural — tag `qa-artifact` (os executores já sabem `clickup.add_tag`, `bento-update-executor.ts:535`) ou lista de QA vinculada a cliente `environment='qa'` (já respeitado em `sincronizar-webhook.ts:98`); na transição, aplicar o filtro de nome também no webhook.
- **Não automatizar:** apagar artefatos — o desenho atual (ocultar, nunca excluir) é correto e deve permanecer.

### I. Notificações

Coberta na essência pelo Bento 3.1 (varredura + briefing). Residuais:

**I1 — Alertas de ops que admitem quando estão mudos**
- **Problema:** `sendOpsAlert` é no-op silencioso sem `ALERT_SLACK_WEBHOOK_URL`; todo o investimento de watchdog/heartbeat termina numa função que pode não entregar nada.
- **Evidência:** `packages/orchestrator/src/alerts.ts:24-25`; `.env.example:358` com a chave vazia; estado na VPS NOT_VERIFIED (política de segredos). CONFIRMED_BY_CODE o comportamento.
- **Proposta (determinística):** linha de boot "alertas: CONFIGURADOS/MUDOS", mesmo padrão do log de Agentic V2 (`apps/worker/src/index.ts:222-225`).
- **Não automatizar:** o conteúdo dos alertas — já é determinístico e adequado.

**I2 — Sinais de carteira no /today**
- **Problema:** `/today/summary` já devolve `clientes` inteiro e `/clients` já calcula `ultima_atividade`/`pedidos_30d`, mas a tela não deriva "cliente X parou há N dias".
- **Evidência:** `apps/api/src/today/routes.ts:80`; `clients/routes.ts:169-185,242-247`. CONFIRMED_BY_CODE (contexto-inteligencia.md O6).
- **Proposta (determinística):** derivação por threshold de dias, sem chamada nova. Verificar uso atual em `today/page.tsx` antes (NOT_VERIFIED).
- **Limite honesto:** com 0 registros reais em sinais até 30/09 (cabeçalho `signals/routes.ts:25-29`), qualquer coisa além da derivação simples é especulação — dados insuficientes para justificar IA aqui.

### J. Bento como camada operacional

O Bento já é a camada operacional para leitura e escrita pontual (§1). O que falta é fechamento e honestidade:

- **J1 — Fechamento das ofertas proativas:** coberto em E1 e F1 (são as duas ofertas concretas sem executor).
- **J2 — Outcome honesto de automações:** a automação horária do Bento despacha, o guard bloqueia como "potencial de escrita", e `automation_runs` grava `dispatched` — contado como sucesso no `success_rate` da tela. Evidência: log 16:00:09→16:00:18 de 15/10 (automacoes.md §3.1, INFERRED com evidência forte de log; confirmar lendo a conversa c13cd01b); contagem em `apps/api/src/automations/routes.ts:184`. CONFIRMED_IN_RUNTIME o sintoma. Proposta (determinística): gravar outcome real (respondeu/esclareceu/bloqueado) e alimentar o `success_rate` com ele; e revisar o prompt da automação — verbos de despacho disparam o guard.
- **J3 — Capacidade já pronta, subutilizada por dados:** com as 4 flags ligadas, perguntas tipo "o que tenho hoje?", "quem me deve resposta?" já são respondíveis via multifonte; a lacuna é 0 registros em aprovações/demandas/inbox (agentes.md §4.6, CONFIRMED_IN_DEPLOY por bento-3.1-progress.md:277-279). Não é oportunidade de código — é consequência de destravar C1/G1, que passam a gerar os dados que o multifonte lê.

### K. Pipeline inteligente — sem oportunidade de automação nova

O pipeline já é bidirecional com ClickUp primeiro na escrita (`pipeline/routes.ts:1227,1275`, CONFIRMED_BY_CODE). Todas as lacunas encontradas são de **confiabilidade e custo** (§4: dedup, N+1, invalidação, payload) ou de **UI** (criação de quadro geral sem caminho — jornadas-web.md P9; kanban read-only em /tasks — P4), não de decisão automatizável. Automatizar "inteligência" sobre o quadro antes de corrigir o dedup do event store (R1) seria construir sobre histórico incompleto: `task.updated` hoje conta só a primeira atualização de cada task.

### L. Onboarding

**L1 — Concessão de acesso sem digitação de e-mail**
- **Problema:** `GrantAccessForm` pede e-mail digitado para a mesma população (membros da org) que o painel ao lado já lista via `useCollaborators`; o 404 por typo é o modo de falha atual.
- **Evidência:** `apps/web/src/components/clients/grant-access-form.tsx:24-31` vs. `client-team-panel.tsx:33,65-76`; validação de membership no backend (`clients/routes.ts`, rota /access). CONFIRMED_BY_CODE (contexto-inteligencia.md O1).
- **Proposta (determinística):** select de membros. Zero dado novo.
- **Não automatizar:** a decisão de quem recebe acesso — permanece humana por definição.

**L2 — Fichas do cliente na memória do Bento**
- **Problema:** o agendamento diário 06:30 existe só no papel — plist não instalado, placeholder `/CAMINHO/DO/brain-desigual` no repo; hoje depende de alguém rodar `sincronizar-fichas.sh` na mão.
- **Evidência:** ausência em `~/Library/LaunchAgents`, sem log; `infra/launchd/com.desigualos.fichas.plist` com placeholder (automacoes.md §1.6/§3.5). CONFIRMED_IN_RUNTIME (na máquina auditada).
- **Proposta (determinística):** instalar o plist (ou migrar o job para o scheduler do worker, onde já existe infraestrutura de repeatable jobs — `apps/worker/src/scheduler/index.ts:80-144`) ou apagar do repo e de CLAUDE.md. Hoje é documentação de uma automação que não existe.
- **Benefício:** o dossiê que o Bento lê por turno deixa de depender de memória humana.

---

## 4. Correções de confiabilidade que eliminam trabalho operacional

Não são "automação nova" — são defeitos que hoje geram retrabalho manual (sincronizar de novo, conferir se salvou, procurar tarefa perdida, duvidar de métrica). As três primeiras foram re-verificadas no código nesta sessão.

**R0 — Worker de produção anterior ao Bento 3.1 (ação operacional, não código)**
- Na auditoria de automações, o processo worker estava de pé desde 13/10 16:48, com 13 jobs repetíveis no log de boot; o fonte arma 14 (varredura adicionada em 14/10). Sem restart, varredura/briefing/tuning de fila existem só no fonte.
- Evidência: ps + log de boot + git log (automacoes.md §3.4). CONFIRMED_IN_RUNTIME na máquina auditada; estado do worker Docker da VPS NOT_VERIFIED. Ação: restart e confirmação do 14º job no boot.

**R1 — Dedup do event store apaga todo `taskUpdated` após o primeiro por task**
- **Problema:** `externalId = ${event}:${taskId}:${webhook_id}`, e `webhook_id` é o id da **inscrição** — constante. O índice único (source, external_id) grava só o primeiro update de cada task; os demais voltam `duplicate` e somem. Perdem-se: linha do tempo, proatividade (`task.updated` é KNOWN_TYPE) e o sinal de vida do integration-health.
- **Evidência:** `apps/api/src/clickup/routes.ts:606` (re-verificado 15/10); índice em `packages/orchestrator/src/event-store.ts:117-137`; descarte em `routes.ts:634-636`. CONFIRMED_BY_CODE.
- **Proposta (determinística):** `history_items[0].id` como externalId, fallback `event:taskId:history_date`. Disponibilidade do campo em payload real: INFERRED da doc oficial referenciada em `webhook.ts:26-34`.
- **Elimina:** o trabalho de reconstruir "o que mudou hoje?" fora do sistema — e é pré-requisito de H1 e de qualquer inteligência sobre o quadro (K).

**R2 — N+1 serial de writes no sync de tarefas**
- **Problema:** um `await db.update` por tarefa, serial, no loop do sync; com RTT ~130ms medido, 200 tarefas mudadas ≈ 26s dentro de uma requisição que o usuário disparou ao abrir a tela.
- **Evidência:** `apps/api/src/pipeline/routes.ts:1111-1128` (re-verificado 15/10); mesmo padrão em `:1016-1019` e `:918-927`; RTT em `packages/database/src/client.ts:24` (MEASURED, comentário). CONFIRMED_BY_CODE.
- **Proposta (determinística):** batchar por `stageId` destino + `inArray` — o próprio arquivo já faz isso 30 linhas abaixo para moves do quadro geral (`:1032-1034`).
- **Elimina:** a espera (e a tentação de re-clicar "Sincronizar") a cada abertura de quadro.

**R3 — `/clickup/tasks/me` sem cache dentro do `/today/summary`**
- **Problema:** a rota chama `queryOperationTasks` direto, sem `consultarComCache` — toda visita ao Hoje paga uma varredura ao vivo do ClickUp por usuário. A rota irmã (`/agency`) passa pelo cache no mesmo arquivo.
- **Evidência:** `apps/api/src/clickup/routes.ts:1103-1110` (re-verificado 15/10) vs. `:1020`; cache em `:411-470`; composição do summary em `today/routes.ts:70-71`. CONFIRMED_BY_CODE.
- **Proposta (determinística):** incluir `assigneeIds` na chave do cache existente; o webhook já invalida o cache inteiro, então a frescura não piora.
- **Elimina:** a seção mais lenta da tela mais visitada (INFERRED que dita o tempo de assentamento — performance-fase13.md P1).

**Demais correções (formato compacto):**

| # | Problema | Evidência | Proposta | Reaproveita |
|---|---|---|---|---|
| R4 | Sync-on-open do pipeline paga ClickUp ao vivo a cada visita, redundante com o webhook | `pipeline/page.tsx:977-984`; `pipeline/routes.ts:223-242,322-334`; comentário :320 (1.239 tarefas abertas em 15/10) — CONFIRMED_BY_CODE | Com H3 (invalidação WS), trocar por sync sob demanda com badge "atualizado há Xmin" | caches de R3, evento WS existente |
| R5 | `getTeamMembers` sem cache: cada resolução de nome = 1 GET /team inteiro; rajadas de escrita estouram 429 sem retry em 2 dos 3 arquivos de rede | `clickup-client.ts:130,183,238`; retry só em `clickup-operation.ts:232-248` — CONFIRMED_BY_CODE | Cache curto (30-60s) de membros + extrair o retry-429 para o `fetchClickUp` compartilhado (`clickup-client.ts:54`) | retry já testado em clickup-operation |
| R6 | Reconciliador de automações "chora lobo": re-registra repeatable existente a cada ciclo (132 ocorrências), anulando o valor diagnóstico do warn | `reconciliar-automacoes.ts:113-114`; log de 15/10 — CONFIRMED_IN_RUNTIME o comportamento; causa INFERRED (listagem cega a repeatables com jobId customizado) | Logar ids quando `reagendadas>0` por um ciclo e comparar com `proximasExecucoes()` | `proximasExecucoes()` já existe (`automation-queue.ts:69-81`) |
| R7 | Fila `automations` sem teto de retenção — Redis acumula histórico sem fim | `automation-queue.ts:14-17` vs. teto em `scheduler/index.ts:70-73` — CONFIRMED_BY_CODE | Copiar `removeOnComplete:100, removeOnFail:500` | constantes já definidas |
| R8 | `inference-warmth` falha em 100% dos ciclos (276 warns idênticos) e o `.catch(() => null)` engole a causa | `inference-warmth.ts:137-145` — CONFIRMED_IN_RUNTIME o sintoma; causa NOT_VERIFIED | Capturar a mensagem de erro no catch | pino já presente |
| R9 | Fallback de `estagiosDaLista` baixa a lista inteira (fechadas+subtasks) para descobrir colunas; drag no quadro geral faz 2-3 chamadas ClickUp sequenciais | `pipeline/routes.ts:209-214,1244-1280` — CONFIRMED_BY_CODE | Cache curto de `listStatusDetailsForList` (status de lista quase nunca muda) + fallback com `includeClosed:false, subtasks:false` | endpoint direto já é o caminho primário |
| R10 | GET /pipelines devolve todos os quadros + todos os cartões, sem paginação; com quadro geral cheio é o maior payload recorrente | `pipeline/routes.ts:378-409` — CONFIRMED_BY_CODE; tamanho INFERRED (0,5-0,9 MB) | Boards sem cards + `GET /pipelines/:id/cards` sob demanda | índices já cobrem as where clauses (`schema/pipeline.ts:113-117`) |
| R11 | Healthcheck do worker é `pgrep` (o próprio comentário admite que é fraco) | `docker-compose.prod.yml:111`; heartbeat Redis em `worker-heartbeat.ts:29-34` — CONFIRMED_BY_CODE | Healthcheck `redis-cli EXISTS desigual:worker:heartbeat` | heartbeat já escrito a cada 10s |
| R12 | Anti-loop de menção não cobre Otto; com Redis fora (fail-open), resposta do Otto com "@otto" re-dispararia | `BOT_REPLY_MARKER` em `clickup/routes.ts:58` vs. `detectMentionedAgent` casando `@otto` (`agent-mention.ts:42`) — CONFIRMED_BY_CODE; loop INFERRED | Incluir Otto no marker | dedup por replyId já existe (:1336) |
| R13 | Saúde do webhook lê só `webhooks[0]` — com webhook de dev convivendo, o religar automático pode mirar o errado | `integration-health.ts:49` — CONFIRMED_BY_CODE | Filtrar pelo endpoint da VPS | dados já vêm no payload |

---

## 5. O que NÃO deve ser automatizado (consolidado)

Consolidação dos limites declarados em cada oportunidade — todos já são desenho do sistema, não proposta nova:

1. **Decisões de aprovação** (brief, criativo, campanha, publicação): a fila existe para capturar julgamento humano; automatizar a decisão destruiria o artefato. G1/G2 automatizam o **efeito** da decisão, nunca a decisão.
2. **Confirmação de delete** no ClickUp: duas voltas humanas, já regra (`bento-action-guard.ts:1556-1599`).
3. **Vínculo contato→cliente e assignee ambíguo**: IA sugere, humano confirma; o sistema já adota "null, nunca um palpite" (`demands/service.ts:22-29`).
4. **Transições terminais de demanda** (`cancelled`): gesto humano explícito.
5. **Publicação em canais do cliente** (Instagram/WhatsApp): a barreira `requiresApproval` da matriz (`seed.ts`) é o produto, não o obstáculo.
6. **Exclusão de artefatos de QA**: ocultar, nunca apagar (H4).

---

## 6. Limitações deste documento

- Não li `.env` nem consultei VPS/banco/ClickUp real (política da auditoria): valores de flags (`BENTO_OPENAI_CORE_ENABLED`, `BENTO_PROACTIVE_*`, `CLICKUP_WRITE_SCOPE_LIST_ID` por processo), a inscrição real do webhook (se cobre `taskCreated/Updated/Deleted` — clickup-sync.md §1, NOT_VERIFIED) e contagens de produção são NOT_VERIFIED. Se a inscrição não cobrir eventos de task, H1/H2/H3 e R1/R4 mudam de prioridade: o caminho inteiro do webhook estaria morto em produção e a primeira "automação" seria registrá-lo.
- A cadeia automação→guard (J2) é INFERRED por proximidade temporal de log; confirmar lendo a conversa c13cd01b.
- Estimativas de latência/payload (R2, R10) são MEASURED de baselines antigos ou INFERRED por contagem de round-trips; não há baseline de latência HTTP por rota (lacuna registrada em performance-fase13.md §4).
- Benefícios são qualitativos; **dados insuficientes** para quantificar horas de trabalho operacional eliminadas — não existe telemetria de tempo-de-tarefa manual no repo. O que falta: instrumentação ou estimativa da operação.
