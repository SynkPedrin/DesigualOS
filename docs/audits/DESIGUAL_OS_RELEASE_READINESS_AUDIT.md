# DESIGUAL OS — RELEASE READINESS AUDIT

Audit SHA: `9bd37b78739f651fe48c23323f66dfa55a89919a`
Date: 2026-09-22, America/Sao_Paulo. Coleta iniciada aproximadamente às 12:20.
Repository: `/Users/pedro/DesigualOS`, branch `main`.
Natureza: AUDITORIA. Nenhuma correção, deploy, restart de produção, alteração de permissões ou escrita em ClickUp/Meta foi realizada por esta auditoria.

## EXECUTIVE SUMMARY

**CORE OPERATIONS SCORE: 47/100 — RED — NOT OPERATIONAL**

**FULL PLATFORM SCORE: 49/100 — RED — NOT OPERATIONAL**

**NO-GO para liberar a operação diária no estado auditado.**

1. Há três P0: operação ClickUp diferente da solicitada, fronteiras de acesso incompletas e tokens válidos em logs.
2. Um pedido de atualizar status criou uma tarefa chamada “pronto”; confirmado no histórico do banco, no parser atual e por GET no ClickUp.
3. O isolamento novo protege algumas rotas, mas não cobre conversas, projetos, execuções, WebSocket, aprovações e todos os caminhos de assets.
4. Dois tokens ainda não expirados apareceram na amostra dos logs; nenhum valor foi reproduzido neste relatório.
5. Jarbas ainda depende de prosa externa sem validação de métricas; Otto regenerou opções após “Agora gostei.” na amostra real.
6. Há base funcional relevante: 1.854 testes passaram ao final, 18 typechecks e 18 lints passaram; fresh migration e replay passaram.
7. O editor exportou PNG/JPEG/PDF em Chromium real isolado; isso não prova o ciclo completo de geração e publicação.
8. A liberação depende de fechar P0, validar intenção/ação e preservar conteúdo aprovado; depois, canary restrito e observado.

## SCOPE, METHOD AND EVIDENCE

O pedido anexado foi tratado como solicitação do usuário. Comentários de código e relatórios antigos são hipóteses, não provas. O HEAD foi registrado antes das verificações; **o checkout tem 153 entradas no `git status --porcelain`**, incluindo alterações e arquivos não rastreados. Consequentemente, resultados sobre o checkout não equivalem a certificar o commit isolado.

Foram separados quatro níveis:

- **CODE:** caminho lido no código atual; implementação não significa funcionamento ao vivo.
- **TEST:** execução local com dependências simuladas ou infraestrutura descartável explicitamente identificada.
- **LIVE READ:** consulta nova, somente leitura, a serviço ou banco real.
- **RUNTIME RECORD:** resposta/execução já persistida, relida diretamente do banco/log. Não equivale a uma nova execução E2E.

Consultas de negócio ao PostgreSQL utilizaram transação `READ ONLY`, pool de uma conexão e `SET LOCAL statement_timeout='8s'`. Testes mutativos de banco rodaram em contêiner PostgreSQL descartável, com porta apenas em loopback. O experimento Redis rodou em contêiner separado sem rede. Ambos foram removidos ao final. Não foram publicados eventos sintéticos no Redis de produção.

Somente o relatório é entregue como arquivo. Bundles de auditoria foram construídos em memória, sem substituir `dist` ou `.next`. Nenhum teste foi editado. O navegador isolado usou callbacks em memória e bloqueio de rede; não salvou documentos de clientes.

**Integridade:** SHA-256 do manifesto de 992 arquivos sob `apps`, `packages`, `nodes`, `database`, `infra` e `scripts`, excluindo `node_modules`, `.next`, `dist` e `.turbo`: `6eb54ea6a6bd719bcc42c5e1ea6167b78bd4a43dc062c0c56d16d2e005cae725`. O mesmo valor foi observado antes e depois dos testes. HEAD permaneceu igual. Essa evidência não pretende cobrir arquivos externos ao conjunto.

### Evidence register

| ID | Fonte e procedimento | Resultado observado |
|---|---|---|
| E01 | Git, versões, processos, portas, launchd, Docker | HEAD acima; checkout alterado; Node 24.20.0; pnpm 9.9.0; API/worker ativos |
| E02 | GET `/health` nas portas 3001 e 3011; GET web publicado | HTTP 200; health da API não testa banco/Redis nem fornece SHA |
| E03 | Leitura dos últimos 8 MB do log da API, somente contagens de JWT | 2.242 ocorrências em URLs `/ws?token=`, 13 tokens distintos, 2 não expirados no momento da contagem |
| E04 | Handler real de `apps/api/src/ws/routes.ts` transpilado em memória, auth/pubsub simulados, dois usuários sintéticos | Usuário B recebeu `message.delta` pública e `execution.completed` da organização A; mensagem privada do dono A foi bloqueada |
| E05 | Banco real, catálogo, grants, buckets e journal | Uma organização, 9 memberships, zero clientes sem organização; papel de conexão `postgres` com bypass de RLS; buckets públicos; hashes de 38 migrações correspondem |
| E06 | Drizzle migrator real em PostgreSQL 16 descartável | Fresh: 38 entradas em 335 ms; replay: 38 entradas, 5 ms, sem reaplicação. Produção é PostgreSQL 17.6 |
| E07 | Suites atuais, credenciais removidas/substituídas por dados de teste; testes tenant em banco descartável | 1.854 casos passaram ao final; histórico de interferências do harness descrito no inventário |
| E08 | Typecheck/lint de cada pacote; build.mjs com `write:false` em memória | 18/18 typechecks e 18/18 lints; zero erros e 24 warnings; 5/5 bundles de servidor/nodes |
| E09 | Histórico recente de Bento + GET `/api/v2/task/86bc556zm` no ClickUp | Pedido de alterar status; tarefa real nova `pronto`, status `aberto`, zero responsáveis, descrição com 598 caracteres |
| E10 | Classificadores reais executados em memória | Pedido E09: `ACTION_REQUEST`, família update, mas `classifyIntentForTest → none`; guard converte `none` em criação |
| E11 | GET ClickUp `/user`, `/team/:id`, `/team/:id/webhook` com `CLICKUP_API_KEY` | 200; 19 membros; webhook ativo, fail_count 0, 8 tipos de evento |
| E12 | GET health Bento/Jarbas/Suzy/Otto; GET Ollama tags e GPU admission | Serviços respondem; Otto declara `release_sha=ae3d847`, modelo `qwen3.6:35b-a3b`; gateway ativo |
| E13 | GET ComfyUI system_stats, queue e object_info/UNETLoader | 0.33.4, RTX 4090; fila vazia; Flux2 e MiniMax H3 presentes no loader |
| E14 | Componente/hook real do editor em Chromium, React/Fabric reais, DPR 2 | PNG 1080×1350, 2160×2700, 4320×5400; JPEG 1080×1350; PDF com MediaBox 810×1012,5 pt; conteúdo não vazio |
| E15 | Função real `groundClaims` com evidência sintética contraditória | “Cosentino tem 999 tarefas” aceita com confiança 0,9 diante da evidência “Cosentino tem 3 tarefas” |
| E16 | Função real `checkDateRangeMatch` com fonte sintética de setembro inteiro | “ontem” e range ISO passam sem comparação; range por extenso 19–21/09 é bloqueado |
| E17 | Função real `createVerifiedSeniorTask`, dependências externas simuladas, duas chamadas concorrentes | Falha na busca de duplicatas produz dois creates e dois resultados success |
| E18 | Redis real: CLIENT LIST/config/persistence; pubsub em Redis descartável | Um consumidor por fila por DB 0/1; AOF desligado; publish em DB 1 entregue a subscriber DB 0 no experimento isolado |
| E19 | Respostas reais de Otto/Jarbas/Suzy e tempos do banco | Amostras qualitativas e percentis abaixo; não usados como comprovação de correção factual |
| E20 | HTTP sem autenticação e preflight | Cinco rotas retornaram 401; preflight permite Authorization/Content-Type, não `x-organization-id` |
| E21 | HEAD sem autenticação de um asset já existente | HTTP 200, `image/svg+xml`; URL não reproduzida |

## SCORECARD

As notas representam prontidão demonstrada, não percentual de testes aprovados. Incerteza em um fluxo crítico reduz a confiança; ausência de prova não foi descrita como falha funcional confirmada.

| Area | Weight | Score | Weighted | Status | Evidence |
|------|------:|------:|------:|------|------|
| A. Infrastructure & Runtime Reliability | 12% | 65 | 7,80 | Parcial: supervisionado, recuperação incompleta | E01/E02/E12/E18; `infra/launchd`; sem restore comprovado |
| B. Database / Tenant / Security | 10% | 25 | 2,50 | BLOCKED: acesso e tokens | E03–E06/E20/E21; P0-02/P0-03 |
| C. Operational Kernel / Context / Memory | 10% | 45 | 4,50 | BLOCKED: intenção e grounding | E10/E15; P0-01/P1-03 |
| D. Bento | 12% | 40 | 4,80 | BLOCKED: update virou create | E09/E10/E11; testes não capturaram construção real |
| E. Otto | 10% | 55 | 5,50 | Parcial: criativo útil, aprovação instável | E07/E12/E19; P1-10 |
| F. Jarbas | 8% | 30 | 2,40 | BLOCKED: dados/ranking não verificados | E16/E19; cap 40 aplicado como limite |
| G. Suzy | 6% | 40 | 2,40 | Parcial: respostas, sem CRM/E2E comprovado | E12/E19; dependência de serviço externo |
| H. Integrations / Tool Gateway | 10% | 55 | 5,50 | Parcial: ClickUp live, garantias desiguais | E11/E17; P1-01/P1-06/P1-08/P1-09 |
| I. Studio + Generation Pipeline | 10% | 65 | 6,50 | Editor demonstrado; geração ponta a ponta não revalidada | E13/E14/E21; 5 jobs de imagem completed nos últimos 7 dias |
| J. QA / Observability / Deployment | 12% | 60 | 7,20 | Boa cobertura local, release sem atestado completo | E07/E08/E18/E19; P1-04/P1-05/P2-03 |
| **Total bruto** | **100%** | | **49,10** | | |

**CORE:** `(49,10 − 6,50) / 0,90 = 47,33`, apresentado como **47**.

**FULL:** bruto 49,10; limite por cross-tenant/credential exposure = 49; resultado **49**. Limite geral de P0 = 59 também existe, mas o mais restritivo prevalece. Caps de fake success/core 69, Bento 74 e Otto 79 não elevam notas que já são menores. Jarbas 30 está abaixo do cap 40. O cap de Studio sem export utilizável não foi aplicado: a exportação foi demonstrada no componente real isolado.

**Qualquer P0 força RED**, independentemente da média.

## P0 BLOCKERS

### P0-01 — Pedido de atualizar tarefa produz criação inesperada

- **Problem:** “altere essa task para o status ‘pronto’” autoriza família update no primeiro classificador, não é reconhecido pelo segundo e entra no default create. O texto entre aspas vira nome da nova tarefa.
- **Evidence:** `apps/worker/src/processors/bento-action-guard.ts:61`, `:126`, `:189`, `:550`; E09/E10. Histórico de 22/09 registra a solicitação e a afirmação de criação; GET ClickUp confirmou `86bc556zm`, nome `pronto`, status `aberto`, sem responsável. A tarefa é preexistente à auditoria; **não foi criada nem alterada pelo auditor**.
- **Impact:** mutação não solicitada em cliente real; demanda original permanece sem a alteração pretendida. O guard compartilhado é usado por Bento e Otto.
- **Affected system:** operational kernel, Bento/Otto, ClickUp.
- **Recommended fix:** operação não reconhecida deve parar; nunca converter update desconhecido em create. Usar uma representação única e tipada de intenção/alvo. Cobrir “altere status”, datas explícitas e referências de conversa antes de reabrir writes.
- **Estimated difficulty:** média, 4–8 h de engenharia + 2–4 h de aceite restrito. Prioridade máxima.
- **STATUS/RISK:** confirmado por código, teste isolado e leitura externa. P0 aberto.

### P0-02 — Fronteira de organização incompleta em leituras, ações e assets

- **Problem:** parte da nova camada tenant está correta, mas rotas antigas continuam globais; a conexão do backend ignora RLS. Papel `master` é global em vários pontos.
- **Evidence:** `apps/api/src/executions/routes.ts:7` e `:36` leem execuções/steps sem usuário/organização; `projects/routes.ts:66` e handlers de mutação não vinculam membership; `search/routes.ts:62` pesquisa clientes/usuários globalmente; `conversations/routes.ts:16` aceita qualquer conversa pública e permite master global; `tool-calls/routes.ts:146` lista pendências globais; `studio/canvas-routes.ts:495` mantém delete de master sem tenant. E04 reproduziu entrega de conteúdo entre organizações no handler WS. E05 confirma papel `postgres` com bypass e ausência de RLS nas tabelas centrais. E21 confirma asset acessível sem sessão; ambos os buckets são públicos.
- **Impact:** usuário autenticado de outra organização pode alcançar conteúdo fora do seu escopo; master global pode atingir recursos estrangeiros nos caminhos citados. URL de upload não constitui controle de acesso.
- **Affected system:** REST, realtime, permissões, aprovação de tools, Studio/storage, memória compartilhada.
- **Recommended fix:** exigir tenant em cada entrada, vincular recursos/filas/memória ao tenant, rever master global e usar downloads autorizados/URLs assinadas para conteúdo privado. A autorização precisa ser revalidada no consumidor da fila.
- **Estimated difficulty:** alta, 1–3 dias para cobertura consistente + testes adversariais. Não declarar resolvido com o helper de clientes apenas.
- **STATUS/RISK:** código e handler demonstram a falha; banco real possui atualmente uma organização. Não foi criada organização estrangeira em produção nem extraído conteúdo por uma conta alheia. Testes de automações em banco isolado passam, mas não cobrem essas rotas.

### P0-03 — Tokens de sessão ativos gravados em logs

- **Problem:** WebSocket recebe bearer em query string e Fastify registra URL completa; não há redaction correspondente.
- **Evidence:** `apps/api/src/ws/routes.ts:59`; `apps/api/src/server.ts:63`; `packages/logging/src/index.ts`. E03: no tail de 8 MB, 2.242 URLs com JWT, 13 tokens distintos, **2 ainda não expirados** na coleta. Log da API tinha aproximadamente 184 MB.
- **Impact:** leitura/cópia do log concede acesso à sessão enquanto válida; compartilhar logs pode compartilhar credenciais.
- **Affected system:** auth, realtime, logging e suporte.
- **Recommended fix:** mascarar query antes do logger ou usar credencial efêmera de handshake; restringir/expurgar cópias e invalidar sessões afetadas em procedimento autorizado. Testar ausência de bearer em logs futuros.
- **Estimated difficulty:** baixa/média, 2–4 h de correção e validação; contenção de logs em paralelo.
- **STATUS/RISK:** exposição confirmada; não há evidência de uso malicioso. Nenhum token foi impresso, incluído no relatório ou usado pelo auditor.

## P1 BLOCKERS

| ID | Problem / evidence | Impact / affected system | Recommended fix | Estimated difficulty |
|---|---|---|---|---|
| P1-01 | Idempotência senior depende de busca por título, sem claim atômico; erro da busca vira `null`. `packages/tool-gateway/src/senior-operation.ts:107–124`; E17 produziu dois creates após lookup falhar | Tarefa duplicada em concorrência/retry; título igual pode reutilizar demanda legítima diferente | Chave durável por intenção/execução, reserva atômica, estado incerto reconciliável; falha de dedup não autoriza novo create | Média, 6–12 h |
| P1-02 | Jarbas valida apenas alguns ranges declarados na prosa, não dataset/métricas/ranking. E16 e resposta real E19; guard fail-open e workflow alternativo sem o mesmo gate | Período/ranking incorreto pode orientar decisão operacional | Contrato estruturado de fonte, período, métricas e completude; cálculo/ranking determinístico; bloquear resultado sem evidência | Alta, 1–2 dias, depende do serviço externo |
| P1-03 | Grounding aceita palavra compartilhada como prova de número contraditório. `packages/agent-runtime/src/grounding.ts:136`; E15: 999 diante de 3 recebe confiança 0,9 | Dado falso pode ser rotulado como fundamentado | Vincular claim ao valor, unidade, entidade e período; rejeitar contradições mesmo quando nome coincide | Média, 4–8 h |
| P1-04 | Checkout contém alterações não commitadas e migrações já aplicadas; API/worker executam `tsx src`, sem SHA no health; Otto declara SHA anterior | Rollback/redeploy do HEAD não reproduz estado auditado; não é possível certificar equivalência entre web, API, worker e nodes | Release imutável com SHA/digest por serviço, inventário de schema, build completo e aceite do mesmo artefato | Média, 4–8 h após estabilizar alterações |
| P1-05 | Redis real está sem AOF; enqueue não é transação com Postgres, há compensação mas não outbox; nenhum restore foi demonstrado. E18, `chat-service.ts:88`; health expõe backup null | Falha abrupta pode perder jobs desde snapshot; registros de execução não garantem reenqueue | Definir RPO/RTO, persistência durável, reconciliação/outbox, backup e ensaio de restore em ambiente isolado | Média/alta, 8–16 h |
| P1-06 | Aprovação marca approved antes da execução, sem claim condicional; update/delete aprovados e confirmação remota retornam completed sem read-back. `gateway.ts:130`, `tool-calls/routes.ts:163`; attachment admite ID null | Dupla aprovação, ação presa após falha e sucesso sem confirmação da operação crítica | Estado pending→executing→verified/failed com transição atômica e verificação específica; retry reconciliado | Média, 6–12 h |
| P1-07 | QA usa Redis DB 1, produção DB 0, mas ambos publicam no canal fixo `desigual-os:ws-events`; E18 comprova que DBs não isolam pubsub | Eventos de QA chegam à produção; IDs/estados de testes contaminam UI. Jobs isolados não significam stack isolada | Instância Redis ou namespace por ambiente em canais, heartbeat e filas; confirmar também isolamento de banco/serviços externos | Baixa/média, 3–6 h |
| P1-08 | Jarbas/Suzy executam `/internal/ask` remoto antes de detectar `[AGUARDA_APROVACAO]`. `execute-job.ts:350`; `agent-ask-client.ts:61`; executor de aprovação envia texto “pode prosseguir” | Gateway local não prova ausência de efeitos colaterais remotos; permissão por prompt não é capability read-only | Endpoint/capability sem ferramentas mutativas para análise e escrita remota com autorização estruturada/idempotência | Alta, 1–2 dias com dono do serviço externo |
| P1-09 | URL de anexo aceita qualquer `z.string().url()` e backend faz fetch/arrayBuffer sem allowlist de destino ou teto próprio. `clickup/routes.ts:80`; `clickup-client.ts:267` | SSRF e consumo de memória por usuário autorizado; conteúdo interno pode ser reenviado ao ClickUp | Restringir a assets autorizados, validar destino após redirects/DNS e limitar tamanho/tempo de download | Média, 4–8 h; exploração real não executada |
| P1-10 | Na conversa real do Otto, feedback “Ficou genérico.” gerou opções novas; o turno seguinte “Agora gostei.” gerou outro conjunto e recomendou outra opção. E19, mensagem `0c329c9a-203c-4a15-94e6-2ef61c77e861` | Aprovação não estabiliza necessariamente o artefato; designer pode receber conteúdo diferente do aprovado | Estado explícito draft/version/approval; ack de aprovação deve preservar conteúdo e task deve referenciar hash/versão | Média, 4–8 h + aceite V1→V2→aprovação→task |

Não foi alegado que todas essas falhas já produziram incidente. P1-01/P1-03/P1-07 foram reproduzidos isoladamente; P1-02/P1-10 têm respostas reais; os demais têm caminhos de código/configuração identificados e limitações de prova descritas.

## P2 / P3 REGISTER

| ID | Severity | Finding | Evidence / condição de fechamento |
|---|---|---|---|
| P2-01 | P2 | Seleção de organização não funciona no browser cross-origin: header exigido pelo backend falta no CORS | E20; `server.ts` allowedHeaders e `lib/tenant-context.ts`; fechar com teste de usuário com duas memberships pela web |
| P2-02 | P2 | Controle otimista do Canva é opcional para clientes que omitem version | `canvas-routes.ts:165`, `:403`; testes de concorrência passam no contrato novo; exigir versão ou separar compatibilidade explicitamente |
| P2-03 | P2 | Latência não está decomposta consistentemente em routing/context/model/tool/verification | Logs/steps existem, mas percentis disponíveis são de execução total; spans correlacionados necessários |
| P2-04 | P2 | Checklist e subtarefa nativa não têm primitivas correspondentes verificadas no cliente ClickUp | `clickup-client.ts` e inventário abaixo; referência textual não substitui checklist/subtask nativo |
| P2-05 | P2 | Testes dependem de variáveis ambientais não declaradas no próprio teste | `integration-health.test.ts` precisa de CLICKUP_API_KEY mesmo com fetch mockado; harness inicial falhou; tornar suíte hermética |
| P2-06 | P2 | Revogação de sessão não é imediata em todos os canais; disabled usa cache HTTP de 30 s e WS dura até expiração | `auth/middleware.ts`, `ws/routes.ts`; deleted não é validado universalmente; testar revogação sem esperar reconexão |
| P3-01 | P3 | Comentários de arquitetura/CI estão desatualizados | CI afirma “4 dos 17 packages”; existem 18 pacotes e 14 suites; comentário de delete Canvas ainda presume hasClientAccess=true |
| P3-02 | P3 | 24 warnings de lint, sobretudo imports/variáveis sem uso e consistência de tipos | E08; não são blockers de produção por si só |

## SNAPSHOT AND SOURCE VS RUNTIME — PHASES 0–2

### Workspace real

- Apps: `apps/web`, `apps/api`, `apps/worker`.
- Packages: `agent-runtime`, `auth`, `context-engine`, `database`, `logging`, `node-protocol`, `orchestrator`, `otto`, `router`, `token-engine`, `tool-gateway`, `types`.
- Nodes: `desigual-node`, `otto-node`, `studio-node`.
- Últimos commits: `9bd37b7` briefing seguro/update_brief; `fdffea8` vocativo/assignee; `d0caf9b` remoção de touchConversation; `ae3d847` lista criativa; `32df73a` conceito/lista.
- Alterações locais incluem tenant foundation 0035–0037, Canvas/versionamento, schema, contexto externo, workers e testes. No **HEAD puro**, `apps/api/src/lib/access.ts` ainda devolve `true` para qualquer cliente. A versão local melhorou isso, mas não foi commitada.

### Processos e serviços

| Serviço | Evidência do snapshot | Source/runtime |
|---|---|---|
| API produção | PID 41909, porta 3001, início 22/09 11:37:30/31, launchd | `tsx src/server.ts`, não usa dist; sem release SHA no health |
| Worker produção | PID 41910, gateway 11500, mesmo início | `tsx src/index.ts`, Redis DB 0 |
| API QA | PID 50265, porta 3011, início 12:02:28/30 | Mesmo caminho de código; ambiente efetivo de todos os recursos não é atestado |
| Worker QA | PID 50271, gateway 11511, início 12:02:28/30 | Redis explicitamente `localhost:6380/1` no ambiente de início |
| Web local | PID 51493, porta 3002, Next 16.3.5 | `.env.local` em live; equivalência ao web publicado não comprovada |
| Web publicado | GET 200 | SHA/build/config da Vercel: NOT VERIFIED; credencial local OIDC não prova deploy atual |
| Otto remoto | Health 200, NODE_OTTO_01 | SHA declarado `ae3d847`, build_time `2026-09-19T00:51:51.394Z` |
| Redis Desigual | `desigual-os-redis`, 127.0.0.1:6380, healthy, restart always | Volume persistente, RDB; AOF off |
| Ollama local | PID 1056, 127.0.0.1:11434 | Tags: kairo, qwen3.5:9b, qwen3.5:4b, moondream; não confundir com modelo remoto do Otto |
| GPU | ComfyUI remoto em 8188; gateway local 11500 | RTX 4090, ComfyUI 0.33.4 |
| Tailscale | Processo/extensão ativos e listener 443 | GET web/health funciona; configuração completa do Funnel e failover não atestada |

Há containers de outros projetos (Supabase ZHEN, Orvyn, n8n, Evolution); sua existência **não comprova** integração com Desigual. Portas 5432/6379 pertencem a outro projeto. Não foram reiniciados ou modificados.

API/worker launchd instalados têm `KeepAlive=true`, `RunAtLoad=true`, `ThrottleInterval=10` e logs em `~/Library/Logs/desigualos-*.log`. Também existe supervisor shell alternativo; não foi acionado.

**STALE API/WORKER:** não comprovado como defeito de comportamento; falta identidade imutável. Apenas `packages/types/src/canva.ts` tinha mtime posterior ao início de produção no conjunto verificado; tipo alterado não prova JavaScript obsoleto. **STALE WEB:** NOT VERIFIED. **Otto:** SHA declarado é anterior, mas diff entre `ae3d847` e HEAD está principalmente no worker/gateway; não se pode concluir que o código do otto-node mudou só pela diferença de SHA. A divergência exige rastreabilidade, não uma alegação automática de runtime quebrado.

### Architecture map

```text
USER
  → WEB Next/React (Supabase Auth; API mode live ou MSW mock)
  → API Fastify (JWT, RBAC, tenant em parte das rotas)
  → ROUTER (heurísticas + classificador/fallback)
  → PostgreSQL (conversa, execução, decisão)
  → BullMQ / Redis (queue-bento, queue-otto, queue-jarbas, queue-suzy...)
  → WORKER
      → Bento/Otto action guard → entity/context → ClickUp client
                                 → read-back em caminhos senior → resposta
      → loop V2 opcional → plano/evidence/actions/evaluation
      → caminho direto → node/serviço externo
          Bento: bento-qa + memória externa
          Otto: otto-node → Ollama remoto, Brain-Marketing
          Jarbas/Suzy: agentes-desigual /internal/ask
  → PostgreSQL (resposta/estado/custos) + Redis pubsub
  → API WebSocket → WEB

STUDIO: WEB → API → studio_jobs + fila studio → studio-node
        → ComfyUI Flux2 / MiniMax H3 → QA/finish/compositor
        → Supabase Storage + studio_assets → canvas/galeria/export
```

**Caminhos alternativos relevantes:** REST ClickUp direto; fila de aprovação; webhook ClickUp/menções; automações; workflow multiagente com `callNode`; helpers textuais sem tools; Studio worker separado. Gateway não é uma única fronteira universal: o guard senior usa primitivas verificadas próprias, REST usa outros wrappers, e agentes remotos têm efeitos fora deste repositório.

Não foi identificado worker duplicado consumindo **a mesma fila no mesmo DB Redis** no snapshot. Existe duplicação de stacks e canal pubsub comum. Legacy `desigual-node`, dispatch direto e loop V2 coexistem; não foram declarados mortos apenas por coexistirem.

## ENVIRONMENT AUDIT — PHASE 3

Inventário final foi feito com **o parser dotenv usado pela aplicação**, sem imprimir valores. Uma sondagem inicial com uma variável alternativa vazia produziu 401; foi descartada após verificar o consumidor real `CLICKUP_API_KEY`, que retorna 200. O 401 não é finding de indisponibilidade.

| Categoria | Nomes | Classificação observada |
|---|---|---|
| Runtime | NODE_ENV, PORT, FRONTEND_URL | PRESENT; launchd define NODE_ENV antes do dotenv, portanto prevalece sobre arquivo |
| Banco/cache | DATABASE_URL, REDIS_URL, REDIS_HOST_PORT | PRESENT / PRODUCTION por vínculo de código e processos; QA sobrescreve Redis DB |
| Pool | DATABASE_POOL_MAX, DATABASE_CONNECT_TIMEOUT_S | Ausentes no `.env` lido; defaults 3 e 15 s; ausência não é erro obrigatório |
| Auth/storage | SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, NODE_SECRET, MASTER_USER_EMAILS, INTEGRATION_ENCRYPTION_KEY | PRESENT; valores nunca publicados |
| ClickUp | CLICKUP_API_KEY, CLICKUP_TEAM_ID, CLICKUP_CLIENT_ID, CLICKUP_CLIENT_SECRET, CLICKUP_REDIRECT_URI, CLICKUP_WEBHOOK_SECRET | PRESENT; API_KEY validada ao vivo; OAuth não exercitado |
| Variáveis alternativas/cloud | ANTHROPIC_API_KEY, OPENAI_API_KEY, CLICKUP_TOKEN, META_TOKEN, INSTAGRAM_TOKEN | **EMPTY**, não PRESENT funcional; Anthropic indisponível neste ambiente |
| Bento | BENTO_QA_URL, BENTO_QA_TOKEN, BENTO_MEMORY_API_URL, BENTO_MEMORY_API_TOKEN | PRESENT; health QA 200; conteúdo/memória externa não certificado por health |
| Agentes remotos | AGENTES_ASK_TOKEN, JARBAS_ASK_URL, SUZY_ASK_URL, PROBE_OTTO_HOST | PRESENT; healths 200 |
| Enxame | ENXAME_TOKEN, ENXAME_SWARM_API_URL | PRESENT; caminho em código, operação externa NOT VERIFIED |
| LLM local | COPY_OLLAMA_URL, COPY_OLLAMA_MODEL | PRESENT; fallback em código; não supor modelo local igual ao Otto remoto |
| Imagens de catálogo | PEXELS_API_KEY, UNSPLASH_ACCESS_KEY, UNSPLASH_SECRET_KEY, PIXABAY_API_KEY | PRESENT; busca não executada nesta auditoria |
| Email | RESEND_API_KEY, RESEND_FROM_EMAIL | PRESENT; envio não executado |
| GPU | MAX_GPU_STRONG_CONCURRENCY, GPU_QUEUE_MAX_DEPTH, GPU_QUEUE_MAX_WAIT_MS, GPU_GATEWAY_PORT, GPU_UPSTREAM_URL, GPU_UPSTREAM_TIMEOUT_MS | PRESENT; admission health 200 |
| Writes | BENTO_MULTI_ACTION_WRITE, BENTO_WRITE_ALLOWLIST | PRESENT; allowlist de usuário não limita automaticamente listas de clientes |
| Cerca/switch | BENTO_WRITE_ENABLED, CLICKUP_WRITE_SCOPE_LIST_ID, CLICKUP_TEST_LIST_ID | Não definidos no `.env` principal; default habilita escrita e não impõe lista única. Nenhuma flag foi alterada |
| Loop/canary | AGENT_LOOP_V2, AGENT_LOOP_OTTO_V2, TAMMY_RC_ENABLED | Ausentes nesse arquivo; não afirmar canary Tammy ativo por histórico; overrides remotos UNKNOWN |
| `.env.local` raiz | VERCEL_OIDC_TOKEN, QA_USER_EMAIL, QA_USER_PASSWORD | PRESENT / ferramenta e TEST-ONLY; não carregado pelo env.ts de API/worker |
| `.env.local` web | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_API_MODE | PRESENT; API_MODE=live localmente; env de deploy Vercel UNKNOWN |
| Studio remoto | COMFYUI_URL, SUPABASE_STORAGE_BUCKET, STUDIO_CRITIC_PROVIDER, CRITIC_OLLAMA_URL/MODEL, STUDIO_QA_MAX_ATTEMPTS | Defaults mapeados no código; env efetiva da máquina GPU UNKNOWN |
| Alertas | ALERT_SLACK_WEBHOOK_URL | Não identificado no `.env` principal; entrega de alerta fora do processo NOT VERIFIED |

Nenhuma chave repetida foi identificada pelo inventário de nomes nos arquivos inspecionados. Há coexistência de aliases com usos diferentes; são caminhos distintos, não tokens equivalentes. `.env` backup existe e amplia a superfície de segredo local; conteúdo não publicado. Ambiente completo pós-dotenv dos processos, secrets da Vercel e nodes remotos não foram extraídos. O `ps` mostra ambiente de início e **não prova** todos os valores carregados depois pelo dotenv.

## INFRA READINESS — PHASES 4, 24, 35–36

| Serviço | Status / health | Restart / timeout / retry | Failure mode / observability |
|---|---|---|---|
| Web | URL publicada 200, Next local ativo | Deploy Vercel e rollback exato NOT VERIFIED; API fetch 30 s, upload 120 s | Sem prova de SHA; modo mock é default se env faltar |
| API | Health 200 | launchd KeepAlive; restart 10 s; shutdown app.close | `/health` é liveness, não readiness de DB/Redis; rate limit 300/min |
| Worker | PID e filas ativos | launchd; drain 55 s; Bento/Otto 2 tentativas, Jarbas/Suzy 1 | Heartbeat/watchdog; retries não resolvem intenção errada nem dedup fraca |
| PostgreSQL | Leitura real OK, 17.6 | Pool 3 por processo, connect 15 s; timeout real observado 2 min | Três consultas lentas podem ocupar todo pool; hosts/processos somam conexões |
| Redis | Healthy, DBs 0/1 | restart always, volume RDB, AOF off | Reinício normal não equivale a crash/power loss seguro; não há prova de perda zero |
| Ollama/model | Tags local e health remoto OK | Otto timeout externo 360 s; COPY fallback 120 s; gateway controla admissão | CPU/GPU/rede externa; sem Anthropic local configurada para resgate universal |
| GPU/ComfyUI | RTX 4090, queue 0/0 | Studio concurrency 1; lock 25 min; retry/read history por prompt_id | Geração cara/longa, saúde não prova qualidade; supervisão remota NOT VERIFIED |
| Storage | Buckets e HEAD público OK | Upload Studio tenta 3× com backoff; upsert por path | Público; autenticação da API não protege download direto |
| Network | Acesso às sondas remotas OK | Tailscale ativo; redundância não comprovada | Mac, Docker Desktop e rede local são dependências do serviço publicado |
| Queue | Consumidores distintos DB 0/1 | Retenção completed 100/failed 500; Otto 1, demais agentes até 5 | Sem DLQ operacional dedicada demonstrada; pubsub atravessa DBs |

**Se API cair, volta?** Há configuração instalada para restart, mas nenhum processo real foi derrubado para provar RTO. **Se worker cair?** BullMQ possui recuperação de locks, e existe tratamento de shutdown/erro; execução externa pode já ter ocorrido, portanto dedup continua necessária. **Se Redis reiniciar?** RDB é configurado como `3600 1 300 100 60 10000`; AOF=off. Snapshot não garante recuperar todo job aceito.

**Se Ollama ficar offline?** Providers retornam erro/timeout; alguns helpers caem em null/fallback. Não existe prova de fallback universal funcional para todos os agentes. **Se ClickUp atrasar?** Cliente tem AbortSignal e tratamento de falha; o perigo é a ambiguidade de write timeout seguida de retry. **Se uma chamada pendurar?** Há limites em clientes principais, mas não um deadline absoluto único para cada execução e para todo efeito externo.

### Disaster scenarios

| Cenário | Expected behavior | Actual evidence | Risk |
|---|---|---|---|
| Redis offline | Recusar ou reconciliar enqueue; não prometer conclusão | chat-service compensa insert com failed em erro, mas insert/queue não são atômicos; ioredis maxRetriesPerRequest=null | P1-05; espera/reconciliação incerta |
| Redis crash | Recuperar jobs aceitos | RDB sem AOF; nenhum crash provocado | Janela de perda não eliminada |
| Worker crash | Reprocessar com dedup | BullMQ retry/locks e drain existem; E17 falha no caminho dedup | Duplicação de tarefa |
| API restart | Reconectar sem vazamento/duplicata | Supervisão e fechamento existem; WS sem replay durável demonstrado | Eventos perdidos; fronteira tenant insuficiente |
| Ollama offline/model timeout | Falha clara, sem ação inventada | Tests de provider/failure taxonomy passam; nenhum serviço real foi desligado | Latência até deadline; fallback parcial |
| ClickUp 500/timeout | Não afirmar sucesso; tratar outcome incerto | Tests com fetch mockado passam; lookup dedup falho permite create | P1-01/P1-06 |
| DB pool exhausted | Timeout limitado e erro útil | Pool 3; statement_timeout=2min; logs têm CONNECT_TIMEOUT/ECONNRESET/ENOTFOUND | Head-of-line blocking; upstream timeout antes do DB |
| Invalid model output | Recusar/replanejar sem side effect | Parsers/tests existem; grounding aceita contradição E15 | P1-03; prosa externa não basta |
| Studio retry | Retomar prompt_id sem gerar duas vezes | Código/testes de resume e idempotency passam | Queda real/restore remoto NOT VERIFIED |

### Backup, deployment and rollback

CI contém build/typecheck/lint/test em push/PR main, Node 20; ambiente auditado Node 24.20.0. Histórico de CI remoto não consultado. Existe runbook e scripts, mas não foi apresentado backup/restore bem-sucedido nesta auditoria; a própria API retorna `last_backup_at:null`. Isso não permite concluir que o provedor Supabase não tenha backup: **plano, retenção, PITR e restauração do provedor estão NOT VERIFIED**.

**Se o deploy de amanhã quebrar, conseguimos voltar?** Não com confiança demonstrada. É necessário alinhar código sujo, migrações já aplicadas, build web e nodes externos; o HEAD sozinho não contém parte da segurança em execução. Um git checkout/restart não é um rollback atestado.

## DATABASE — PHASE 5

Fresh e replay com o migrator Drizzle real passaram em banco vazio descartável. Também passaram a execução ordenada dos 38 SQLs e uma transação única contendo todos. Limitação: PostgreSQL descartável 16, produção 17.6; runner oficial usa SSL obrigatório e não foi apontado para produção. A verificação real usou o mesmo migrator com conexão local sem TLS. Journal remoto tem hashes e timestamps correspondentes aos 38 SQLs locais; isso valida histórico de migração, **não uma prova completa de ausência de DDL manual**.

Foram lidos índices e FKs das tabelas. Clientes/automations possuem organization_id nullable; organization_members possui FKs e unique org/user. Uma organização e 9 memberships em produção; nenhum cliente com organização null na coleta. Conversations, executions, memories e várias tabelas operacionais não têm organization_id direto, exigindo escopo via joins/caller. Falhas de caller tornam-se relevantes porque o backend conecta como postgres com bypass RLS.

Grants públicos de tabelas `public` para anon/authenticated/PUBLIC não foram encontrados; migrações 0036/0037 estão aplicadas. Essa defesa fecha Data API direta, não corrige consultas amplas feitas pela API com papel privilegiado.

Índices úteis existem para conversation/user/client, messages/conversation, tasks/client/list, assets/client, memories/client, health/node, custos e notificações. Automation_runs, project_files, projects, jobs e tool_results têm cobertura mais modesta; número de índices sozinho não demonstra gargalo. Busca `translate + ILIKE/word_similarity` tem potencial de scan; não foi executado EXPLAIN ANALYZE pesado nem inventado N+1 com base apenas no nome de função. Há montagem de contexto em paralelo e limites de recuperação; inspeção não detectou leak comprovado de conexões.

Races relevantes: criação senior sem claim durável, aprovação SELECT→UPDATE sem condição, dual write Postgres/Redis, e Canvas com versão opcional. Nenhuma constraint ou dado produtivo foi alterado.

## SECURITY — PHASES 6, 26, 30, 32

**Tenant:** melhoria local real em `hasClientAccess`, `requireTenant`, automations e senior runtime. Testes reais de automations cobriram duas organizações, inclusive master, recurso estrangeiro e selector forjado. Isso não certifica rotas globais restantes. Delete Canvas de master e approval gateway precisam da mesma fronteira.

**Permissions:** JWT e RBAC existem; cinco endpoints sem bearer retornaram 401. Registro just-in-time não concede automaticamente collaborator ao signup comum. Entretanto, várias leituras usam apenas requireAuth, e um perfil sem papel pode continuar elegível a esses caminhos. Roles/permissões globais não substituem membership por organização.

**Auth:** testes de JWT/issuer/expiração e middleware passaram; disabled é checado; cache 30 s pode adiar efeito. Provisioning retorna usuário existente sem filtro universal de deleted_at; senior context e helpers novos fazem esse filtro. Login/logout/refresh via Supabase e web com conta real não foram reexecutados. Casos multi-org/selector foram testados no backend isolado; preflight real revela P2-01. WebSocket expira com o JWT, mas não reverifica membership/disabled continuamente.

**Secrets:** tokens criptografados com AES-256-GCM no banco para OAuth; atualmente `integration_connections` não tem linhas. Isso não mitiga bearer em query/log. Logs foram examinados sem publicar chaves, emails ou payloads completos. Contagem de JWT ativo é prova de exposição, não de comprometimento.

**Prompt injection:** sanitizador `packages/context-engine/src/texto-externo.ts` remove controles/quebras, limita campos a 300 caracteres e neutraliza marcadores estruturais; seus testes passam. Ele não impede instrução maliciosa em prosa nem garante segurança do serviço externo. Os gates de autorização precisam continuar fora do LLM. Não foi enviado texto malicioso a agentes reais que possam publicar ou escrever em clientes.

| Vetor | Verificação segura | Conclusão |
|---|---|---|
| Nome de task malicioso | Suite `texto-externo.test.ts` / contexto operacional | Defesa estrutural local demonstrada; não equivale a imunidade semântica |
| Comentário ClickUp malicioso | Caminho de contexto/briefing inspecionado | Conteúdo externo pode influenciar LLM; permissão não pode vir do comentário; E2E remoto NOT VERIFIED |
| Mensagem de lead | Serviço Suzy externo inspecionado pela fronteira HTTP | Capability read-only não garantida pelo contrato; teste adversarial externo não executado |
| Dossiê do cliente | Retrieval/sanitização/limites inspecionados | Não há prova de isolamento por organização em todos os recalls; P0-02 |

## TOOL SAFETY / SUBCALL SAFETY — PHASES 7–8, 29

### Matriz efetiva do banco

Esta é a matriz **lida no banco atual**, não a descrição histórica do seed. `requires_approval` é um bit do gateway; não prova que todo caminho usa o gateway.

| Agente | Tool | Access | Approval |
|---|---|---|---|
| Bento | clickup | write | não |
| Bento | clickup.delete_task | write | sim |
| Bento | clickup.update_task | write | sim |
| Bento | instagram | none | não |
| Bento | meta_ads | none | não |
| Bento | obsidian | read | não |
| Bento | studio | write | não |
| Jarbas | clickup | write | não |
| Jarbas | google_ads | write | não |
| Jarbas | meta_ads | write | sim |
| Jarbas | studio | write | não |
| Suzy | clickup | write | não |
| Suzy | instagram | write | sim |
| Suzy | meta_ads | none | não |
| Suzy | whatsapp | write | não |
| Studio | clickup | write | não |
| Studio | gpu | write | não |
| Studio | instagram | write | sim |
| Studio | storage | write | não |
| Otto | clickup | write | não |
| Otto | obsidian | read | não |
| Otto | studio | write | não |

**Jarbas não é read-only na matriz global.** O worker exclui Jarbas do loop V2, mas a superfície remota e a aprovação de Meta continuam existindo. A auditoria efetuou ZERO mutações Meta.

### Primitivas e garantias por caminho

| Tool/caminho | R/W, recurso e agente | Permission / tenant | Idempotency / read-after-write | Destructive / confirmation |
|---|---|---|---|---|
| getTeamMembers / findMember / resolveMember | R, ClickUp/users; callers operacionais | Credencial workspace; resolução de nome com ambiguidade | Não aplicável | Não |
| getTask / getTaskListId / getTaskComments / listStatuses / queryOperationTasks / getTasksInList | R, ClickUp/tasks | Caller precisa vincular lista/cliente; client baixo nível não recebe tenant | Paginação/timeout; dado real quando consulta acontece | Não |
| createTask / createAttributedTask | W, task; REST/Bento/Otto/outros callers | Cerca de lista/switch; REST verifica cliente; nem todo caller é senior | REST claim curto; create baixo nível não verifica conteúdo | Não destrutiva, mas ação indevida possível |
| createVerifiedSeniorTask | W, Bento/Otto | Contexto senior e clickup:write; binding de lista fica com caller | Read-back presente; dedup por título fail-open/race E17 | Orçamento de mutações; sem aprovação por item |
| updateTask | W, nome/status/prazo/prioridade/assignee/descrição | Scope/switch; guard revalida senior; REST pede gateway | Guard verifica estado; REST/approval não fazem read-back | Mutação; aprovação depende do caminho |
| createTaskComment / replyToComment | W, comentário | Scope/switch; caller define contexto | Action executor tem read-back; wrapper direto só resposta HTTP | Sem confirmação destrutiva |
| uploadTaskAttachment | W, anexo de URL | Scope da task, origem da URL sem validação suficiente | Pode retornar id null; não verifica presença por GET | SSRF/tamanho P1-09 |
| deleteTask | W, exclusão | Scope/switch; rota solicita approval | Sem verificação posterior de ausência; aprovação global/race | Destrutiva, exige approval na rota |
| requestToolCall / approveToolCall | W, registro/autorização | Matriz de agente e RBAC; tenant não universal | Loga; SELECT→UPDATE não é claim atômico | Autoriza efeitos; P1-06 |
| askBentoQA / askAgent / callNode | HTTP POST para agente | Segredo de serviço; escopo remoto depende do receptor | Timeout; não garante idempotência de efeitos remotos | Pode acionar tools remotas; capabilities não explícitas |
| completeTextSafely / completeTextViaOllama | Texto, sem tools | Chamada direta ao provider, sem identidade de writer | Não há mutação operacional disponível | Subcall adequada para resumo/briefing |
| studio queue / ComfyUI generation | W, GPU/job/asset | API checa acesso; worker verifica job existente/cancelado/completed, não membership atual universal | prompt_id/resume, asset idempotency e storage upsert | Consome GPU; retomada real não induzida |
| storage upload/delete | W, arquivo | Service key; autorização fica no caller | Upload upsert; delete depende de erro SDK | Delete destrutivo; posse/tenant precisam preceder |
| Meta/Instagram approval | W, serviço externo | Approval local após proposta em texto | Sem recibo/read-back estruturado da operação real | P1-08; não exercitado |
| WhatsApp/CRM/email | W quando disponível | Remoto ou rota específica; não são ferramentas universais implementadas só por constarem na matriz | Não comprovado E2E | Nenhuma mensagem enviada nesta auditoria |

`AgentActionType` também prevê ações tipadas como comentário, responsável, prioridade, approval e no_action. As capacidades efetivas dependem do executor; uma string na matriz ou enum não foi classificada como integração pronta.

**Subcalls:** o writer de briefing em `execute-job.ts` usa `completeTextSafely` e fallback textual direto, não `callNode('bento')`; a correção do incidente descrito nos comentários está presente no HEAD atual. Não foi encontrado outro uso equivalente desse writer herdando tools. Porém `processWorkflowStep` chama `callNode` diretamente, e a ferramenta analyze do loop despacha um node real: **não são helpers comprovadamente sem efeitos**. Jarbas/Suzy retornam prosa de backends com ferramentas próprias. “Analyze” no nome local não cria uma sandbox no remoto.

**Fake success:** create/update senior possui sinal verified, mas isso verifica atributos da tarefa, não se era a operação pretendida — P0-01 passou mesmo com read-back. Aprovação REST marca completed após HTTP/retorno textual; attachment pode confirmar attached com ID null. Logo, a afirmação “toda escrita crítica é verificada” é falsa. Não foi simulado sucesso falso contra cliente real.

## OPERATIONAL KERNEL / MEMORY — PHASES 9, 15

Há componentes para intent, client/person/task resolution, conversation_artifact, operational context, episódios, blackboards, planos e budgets. A composição não é uniforme: guard determinístico → segundo classificador; caminho direto; loop V2; workflow. E10 mostra que discordância entre classificadores produz ação errada.

| Entrada | Resultado observado no parser atual | Interpretação |
|---|---|---|
| “altere essa task para o status ‘pronto’” | Write autorizado como update; operação none; fallback create | P0-01 |
| “muda o prazo dessa task para 25/09/2026” | Write autorizado; operação none | Mesmo risco de cair em create; não executado externamente |
| “atualiza essa” | READ_ONLY / none | Não comprova atualização por referência |
| “manda pra ele” | READ_ONLY / none | Não resolve intenção operacional nessa forma |
| “isso”, “a que eu gostei”, “quem foi?” | READ_ONLY / none | Pode seguir para LLM/contexto; classificação isolada não testa resposta completa |
| “essa”, “ele”, “ela”, “a anterior” | Regex/referências e testes existentes inspecionados | Conversa/artifact tem suporte parcial; aceitação completa NOT VERIFIED |

Contexto recente é limitado e incluído também no caminho direto de agentes que o aceitam. Bento possui canal apartado para dados operacionais. Há material anterior/anexos no guard, versões criativas e referências. Isso é melhor que depender só de prompt; ainda não garante continuidade em toda expressão natural.

Memórias têm status/expiry/environment, client/user/agent opcionais, importance e limites. `recallMemories` filtra environment por default production, mas `clientId` e `userId` só entram se fornecidos; sem eles a consulta não é tenant-scoped. `build-context` tem filtros mais estreitos em alguns recalls. `resolveEnvironment` retorna production quando não consegue obter cliente. Erros de retrieval frequentemente viram lista vazia: evitam crash, mas precisam distinguir “não há dado” de “fonte falhou”.

Não foi comprovada contaminação específica de conteúdo privado em resposta atual por memória; existe risco de projeto e callers sem escopo, incorporado ao P0-02. Também não foi considerada memória longa prova de capacidade de CRM/lead state.

## AGENT READINESS — PHASES 10–14

### Bento

**Score: 40. Status: BLOCKED para escrita autônoma.**

Capabilities verified: integração ClickUp em leitura; membros/webhook; suites de intenção, contexto, operação e read-back; tarefa real criada encontrada por GET; carregamento de autoridade senior pelo banco.

Capabilities partial: conhecer clientes/operadores/tasks/prazos/comentários/briefings; a resposta operacional relida traz 120 tasks e detalhamento, mas a totalidade dessas contagens não foi recalculada nesta auditoria. Create, assign, due date, status e update_brief têm código/testes e verificação parcial. Anexos viram referências/attachments, com ressalvas do downloader.

Capabilities missing/not verified: checklist e subtask nativos; update com toda variedade de linguagem; conclusão de trabalho humano é **deliberadamente recusada** no guard, portanto não foi contada como feature quebrada. Delete existe por approval, mas não está certificado como fluxo seguro ponta a ponta.

Briefing: composer possui contexto, objetivo, entregáveis, instruções, referências e pendências; safe writer preenche campos do pedido e approved draft é preservado por código/testes. Sem Anthropic configurada, depende do fallback local. Ausência de `[CONFIRMAR]` quando informação está disponível **não foi certificada para todos os casos**. O título `pronto` evidencia que qualidade de briefing não compensa seleção errada da operação.

Top risks: P0-01, P1-01, P1-03, P1-06; loop/direct externo não universalmente read-only. Read-after-write deve conferir também intenção/alvo.

### Otto

**Score: 55. Status: revisão humana obrigatória; autonomia ainda não liberável.**

Capabilities verified: health remoto com modelo/dossiê Brain indexável; 245 testes do pacote Otto e 39 do node; rascunhos reais com hook/cenas/texto na tela/CTA; handlers de artefato e preservação no guard.

Capabilities partial: brand/audience/offer/contexto criativo e feedback. Amostra “Ficou genérico.” gerou ideias específicas em formato de cenas, mas o agente declarou ausência de DNA real do cliente e usou hipótese. É honestidade útil, não conhecimento de marca comprovado. Benchmark/research tem adapters e testes; providers/search em produção não revalidados.

Capabilities missing/not verified: ciclo completo V1→feedback→V2→approval→task com comparação byte/hash em runtime atual; P1-10 mostra regeneração após aprovação conversacional. A task de QA que o Otto informou já existir não foi alterada nesta auditoria.

Top risks: redefinir a peça aprovada, entregar hipótese como direção de marca e usar guard de escrita com P0-01.

### Jarbas

**Score: 30, cap máximo 40. Status: não usar para decisões de performance sem conferir fonte.**

Origem real: worker → `callAgentesDesigual` → `JARBAS_ASK_URL/internal/ask`; o parser/cálculo Meta vive fora do repo. O cliente retorna string answer. O código local não recalcula spend, leads, ranking ou datas da fonte.

Capabilities verified: health 200; chamada/erro/guard em testes; histórico real mostra SOURCE_RANGE_MISMATCH e resposta posterior pedindo métrica. O guard impediu um ranking de mês inteiro para pedido de 19–21/09.

Capabilities partial: datas por extenso/DD/MM com ano. “ontem”, range ISO e follow-up sem dois extremos canônicos não são confrontados; E16 demonstra fail-open. `processWorkflowStep` chama o node por outro caminho sem o mesmo bloco de pós-validação mostrado no single-agent.

Capabilities missing/not verified: dataset estruturado, completude/paginação Meta, comparação de períodos e clientes, ranking determinístico e repetição factual com mesmo dataset. Nenhuma mutação Meta executada.

| Métrica | Regra que deve ser comprovada | Resultado da auditoria |
|---|---|---|
| Spend, impressions, reach, clicks, leads, conversions, revenue | Fonte, intervalo, timezone, atribuição, unidade e completude | Fórmula/origem remota NOT VERIFIED |
| Frequency | Impressions / reach; reach não é aditivo entre recortes | NOT VERIFIED |
| CPM | Spend / impressions × 1000 | NOT VERIFIED |
| CTR | Clicks / impressions × 100, com definição de clique explícita | NOT VERIFIED |
| CPC | Spend / clicks | NOT VERIFIED |
| CPL | Spend / leads | NOT VERIFIED |
| CPA | Spend / conversões definidas | NOT VERIFIED |
| ROAS | Receita atribuída / gasto em mídia | NOT VERIFIED |
| ROI | (Retorno − custo total) / custo total; não confundir receita/gasto de mídia com lucro | NOT VERIFIED |
| Conversion rate | Conversões / denominador declarado, por exemplo cliques | NOT VERIFIED |

As fórmulas acima são critérios de aceite, não alegação de implementação. Divisão por zero, ausência de valor e mistura de modelos de atribuição precisam de contrato explícito.

### Suzy

**Score: 40. Status: assistência de texto parcial; atendimento integrado não certificado.**

Capabilities verified: health remoto 200; histórico real. Em pedido de responder lead sobre sábado/preços, Suzy declarou não ter dados e pediu informações, sem inventar preço. Em objeção “tá caro”, amostra anterior propôs pergunta para distinguir preço versus momento e próximo passo.

Capabilities partial: tratamento textual de objeção e follow-up. A melhor amostra de objeção é de 13/09, portanto demonstra uma resposta histórica, não estado comportamental completo do runtime atual.

Capabilities missing/not verified: resolução inequívoca de lead, CRM stage/history, continuidade de identidade entre WhatsApp/Instagram/chat, dedup de envio e confirmação de entrega. Os serviços remotos podem enviar mensagens; nenhuma mensagem real foi enviada pela auditoria.

Top risks: P1-08, sessão fallback `internal-orchestrator` quando sessionId falta, histórico/lead externos não escopados pelo contrato local.

### Quality evaluation of actual outputs

Escala qualitativa sobre a amostra, sem fingir uma avaliação estatística. “NV” = não verificado. Testes de substring não foram usados como prova de qualidade.

| Critério | Bento | Otto | Jarbas | Suzy |
|---|---|---|---|---|
| Intent correctness | FAIL: update→create | Parcial: aprovação→novas opções | Parcial: período corrigido, depois pede métrica | Adequado nas amostras textuais |
| Context | Usa cliente/task; referente operacional falha | Reconhece feedback, declara falta de DNA | Follow-up ainda pede cliente/métrica | Falta horário/preço explícita |
| Grounding | Read-back existe, claim validator fraco | Hipótese identificada, fonte de marca NV | Dataset/ranking NV; guard parcial | Não inventa dado ausente nas amostras |
| Specificity | Lista operacional concreta; tarefa errada | Cenas concretas, marca pouco ancorada | Insuficiente para decisão | Objeção contextual, sem lead real comprovado |
| Completeness | Não completou alteração pedida | Criativo estruturado; approval instável | Sem resposta factual validada do período | Rascunho/limitação, não atendimento completo |
| Continuity | Referente→ação incorreta | FAIL no “Agora gostei.” | Parcial em follow-up de período | NV em lead multiturmo real |
| Action correctness | FAIL confirmado | Criação usa o mesmo guard vulnerável | Nenhuma ação Meta testada | Nenhum envio testado |
| Honesty | Diz o que criou, mas não fez o pedido | Declara hipóteses; preservação falha | Bloqueio explícito é positivo; prosa livre persiste | Boa ao admitir lacuna |
| Usefulness | Leitura útil; escrita insegura | Útil como rascunho com revisão | Exige conferência humana de fonte | Útil como apoio de resposta |
| Latency | p50 9,04 s observacional | p50 11,72 s observacional | p50 0,77 s inclui respostas curtas | n=1 recente, insuficiente |

## INTEGRATION READINESS — PHASES 16–17

| Integration | Declared | Code exists | Credential present | Read works | Write works | Production verified | Failure handling | Owner area |
|---|---|---|---|---|---|---|---|---|
| ClickUp global | Sim | Client, routes, guard, webhook | Sim, API_KEY válida | **LIVE READ** user/team/task/webhook | Histórico de create confirmado; nenhuma escrita de auditoria | Parcial, sem certificar fluxo seguro | Timeouts, guard, read-back senior; dedup falha | Integrações + operações |
| ClickUp OAuth | Sim | OAuth/encryption/sync | App creds presentes; zero conexões na tabela | NOT VERIFIED por OAuth | NOT VERIFIED | Não | Erros HTTP/envelope criptografado | Integrações |
| Meta Ads | Sim | Adapter remoto/approval; cálculo fora do repo | Local META_TOKEN vazio; credencial remota UNKNOWN | Health Jarbas não é Meta read | ZERO na auditoria | Não | Deadline; prosa/approval parcial | Performance + serviço Jarbas |
| Google Ads | Sim na matriz | Não foi comprovado executor local completo | UNKNOWN | NOT VERIFIED | NOT VERIFIED | Não | UNKNOWN | Performance |
| Instagram | Sim | Adapter/approval remoto | Token local vazio; remoto UNKNOWN | NOT VERIFIED | NOT VERIFIED | Não | Dependente remoto | Atendimento |
| WhatsApp | Sim | Susy-service externo | AGENTES_ASK_TOKEN presente; provider remoto UNKNOWN | Health apenas | NOT VERIFIED | Não | Sem retry automático Suzy por risco de duplicação | Atendimento |
| CRM | Requisito de produto | Não localizado fluxo local completo de lead/stage | UNKNOWN | NOT VERIFIED | NOT VERIFIED | Não | UNKNOWN | Atendimento/produto |
| Bento QA/memory | Sim | HTTP clients/context | Sim | Health QA 200; retrieval integral NV | Não aplicável ao teste | Parcial | Timeout e erro tipado | Agentes |
| Otto/Brain | Sim | Node + pacote criativo | Segredo/config presente por health | Health/índice 160 docs | Geração textual apenas em registros reais | Parcial | Provider timeout/fallback parcial | Criativo/IA |
| Ollama | Sim | Providers e gateway | Não exige chave nesses endpoints | Tags/health/admission 200 | Inferência nova não solicitada | Parcial | Timeout/admission; teste de cancelamento passou | Infra/IA |
| Anthropic | Sim | SDK e safe-complete | EMPTY local | NOT VERIFIED | NOT VERIFIED | Não | Null/fallback quando sem chave | IA |
| ComfyUI / Flux2 | Sim | Graphs/generate/resume | Host acessível | Loader/system/queue 200 | 5 jobs image completed/7d no DB; sem nova geração | Parcial | Retry GET, checkpoint prompt_id | Studio/GPU |
| MiniMax H3 vídeo | Sim | Video-router, sequence, H3, assembly | Modelo no loader | Modelo presente | NOT VERIFIED end-to-end | Não nesta auditoria | Poll/resume/timeouts específicos | Studio/GPU |
| Supabase DB/Auth | Sim | Postgres/JWT | Sim | DB real e auth negativas OK | Somente banco descartável | Parcial | Pool/timeout; sessão parcial | Backend/infra |
| Supabase Storage | Sim | Upload/delete/public URL | Sim | HEAD asset 200 sem sessão | Não exercitado | Disponibilidade, não privacidade | SDK errors/retry Studio | Backend/Studio |
| Resend/email | Sim | Rotas/admin/cliente HTTP | Sim | Não aplicável | Nenhum email enviado | Não | Implementação, entrega NV | Backend |
| Pexels/Unsplash/Pixabay | Sim | Image-search routes | Sim | NOT VERIFIED | Não aplicável | Não | Testes de image search | Studio |
| Enxame/swarm | Sim | URLs/adapters | Sim | NOT VERIFIED | NOT VERIFIED | Não | Dependência externa | Infra/agentes |
| Slack alertas | Opcional | alerts.ts | Ausente local | Não aplicável | Nenhum alerta enviado | Não | Testes mockados | SRE |

### ClickUp capability matrix

| Operação | Implemented | Tested now | Live verified nesta auditoria |
|---|---|---|---|
| list/search/get | Sim | Unit/mock | Get task/team/webhook sim; list completa/search não |
| create | Sim, múltiplos callers | Unit/mock + falha de intenção reproduzida | Task preexistente confirmada; novo create não executado |
| update/status/complete | PUT e guard parcial; complete humano recusado | Unit/mock | Não; update→create observado |
| assign | Sim, resolução por nome/email e ambiguidade | Unit/mock | Membros lidos; assign não executado |
| comments/replies | Sim | Unit/mock parcial | Não |
| due date/priority | Sim, cobertura linguística parcial | Unit/mock | Não |
| attachments/reference | Sim | Código e testes parciais | Não; ID null/SSRF precisam fechar |
| checklist/subtask | Não comprovado nativo | Não | Não |
| delete | Sim por approval | Código/testes parciais | Não, deliberadamente não exercitado |

Client→list fica em clients.clickupListId; user→ClickUp usa email/membros. Resolução ambígua possui retorno próprio. Idempotência REST de 15 s e idempotência senior por título são mecanismos diferentes, nenhum substitui reconciliação durável após timeout.

## STUDIO READINESS — PHASES 18–21, 27

**Studio Score: 65.** Editor exporta, mas release completo de geração/asset/isolamento ainda é parcial.

| Área | Evidência / status |
|---|---|
| Canvas/viewport/zoom/pan/resize | Fabric real; hook inicializou em Chromium DPR 2; unidades/layout têm tests. Jornada com toda UI publicada não executada |
| Selection/multi-select/layers | Implementação e suites de group/reorder/arrange/snap passaram; não equivale a teste manual de todas as ferramentas |
| Text/colors/effects | Texto e shape adicionados no navegador real; export contém pixels não brancos. Controles de texto/sombra/filtro têm tests |
| Fonts | FontFace/CDN sob demanda, cache e erro explícito; teste browser usou Arial local. Fontes remotas/variantes offline NOT VERIFIED |
| Images/crop | Implementação e testes de modelo/persistência; parte das suites usa fake canvas/image. CORS/arquivos reais em todos os formatos NV |
| Undo/redo | No browser, undo habilitou redo e redo funcionou; suites cobrem estado/histórico. O undo exercitado era mudança de texto, não exclusão de objeto |
| Copy/paste/shortcuts/artboards | Código e testes locais; clipboard de SO e todos atalhos não exercitados E2E |
| Autosave/persistence | Tests do hook e rotas/concurrency passaram; callback do harness só em memória. Reload produtivo e conflito entre dois designers NV |
| Export PNG | 1× 1080×1350 / 47.011 bytes; 2× 2160×2700 / 147.196; 4× 4320×5400 / 512.974; dimensões lidas no IHDR |
| Export JPEG | Imagem decodificada no browser, 1080×1350 |
| Export PDF | Blob application/pdf, 28.691 bytes; MediaBox 810×1012,5 pt, consistente com conversão 0,75 pt/px do jsPDF. Raster dentro do PDF |
| SVG | Asset SVG existe no storage; isso não prova export SVG nativo do editor. NOT VERIFIED/sem interface de export demonstrada |
| Generation | Flux2 UNET e pipelines reais, resume/checkpoint/storage; health/modelo presente, sem novo job de geração nesta auditoria |
| Video | MiniMax H3 instalado e pipeline em código/testes; não classificado como “pronto” pela existência de UI/modelo |

O componente exportou **149.187 pixels não brancos de 1.458.000** na imagem 1×. Isso demonstra conteúdo útil básico, não avaliação estética de campanha. Primeiro harness em about:blank falhou por ausência de crypto.randomUUID em contexto não seguro; rerun em origem HTTPS sintética resolveu. Não é defeito atribuído ao produto.

Pipeline de imagem: API→studio_jobs→BullMQ→studio-node→workflow router/ComfyUI→critic/QA/finish→Storage→asset. Registry declara Flux2; GET atual confirma `flux2_dev_fp8mixed.safetensors`. Registry histórico não foi aceito como prova para todos os encoders/VAEs/LoRAs. No banco: 84 jobs totais, 50 completed/33 failed/1 cancelled; nos últimos 7 dias, 5 imagens completed, 2 failed, 1 cancelled. Tempo médio gpu_time_ms dos 5 completed: aproximadamente 417 s. Não é taxa de falha de release controlado: mistura workloads e revisões.

Vídeo possui H3, sequência, retomada, polling, montagem e download/storage; loaders confirmam variantes FL2VA/REF2VA. Qualidade, fidelidade, texto, rostos, consistência de marca, resolução final e latência atual de vídeo: **NOT VERIFIED**. Não foi consumida GPU real com novo job para mascarar a ausência de isolamento comprovado do pipeline de produção.

Assets: filenames sanitizados em uploads, MIME declarado, limite de 25 MB na API de uploads. Buckets não têm file_size_limit nem allowed_mime_types no catálogo; paths/client IDs não substituem autorização. URLs são públicas, sem expiração assinada nessa implementação. Upload SDK com upsert reduz duplicação por path; asset metadata e thumbnails existem. Cleanup e remoção entre storage/DB não são transação única. Download de referências arbitrárias pelo backend precisa fechar P1-09.

## RELIABILITY / ERROR HANDLING — PHASES 28–29

Retries: BullMQ configurado por agente; Jarbas/Suzy têm uma tentativa para reduzir duplicação externa. ComfyUI repete GET/poll, preserva prompt_id, e evita retry cego do POST de geração. Storage Studio repete upload no mesmo path.

Timeouts: clientes principais usam AbortSignal; auth/API têm limites distintos; DB real aceita query por até 2 min. Não confundir deadline HTTP com cancelamento do efeito no sistema externo.

Taxonomia: existem error codes de cliente/ambiguidade/permissão/write/verification/source_range, além de `failure-taxonomy`. A cobertura não é universal: `source_range` só valida casos extraíveis; get/list podem converter falha em vazio; API emite mensagens genéricas em erros não previstos.

`catch(() => null)` na dedup senior é inseguro; `catch(() => [])` em contexto pode esconder indisponibilidade; `pubsub.ts` ignora erro de parse/callback. Nem todo catch é bug: callbacks best-effort de notificações não devem derrubar operação principal. Classificou-se apenas o efeito relevante.

Na amostra de logs aparecem DNS/ECONNRESET/CONNECT_TIMEOUT e falhas de envio de learnings. As contagens são do tail/histórico, sem janela homogênea: não foram apresentadas como erro atual por minuto. Há 47 `FST_ERR_CTP_EMPTY_JSON_BODY` no tail da API; apontam requisições inválidas, não necessariamente indisponibilidade do serviço.

## REALTIME — PHASE 25

Canal único Redis, servidor WS autenticado por query bearer, filtros de DM remetente/destinatário e mensagem privada por owner. Socket fecha na expiração do token; subscriber reconecta via cliente Redis. Não há replay de mensagens de pubsub demonstrado nem envelope tenant obrigatório.

Teste executado com **dois usuários e duas conversas sintéticas** usando o handler atual: conversa pública A chega a B; privada A não chega; execution.completed A chega a B. Não é teste de duas contas reais na web. Separação DB 0/1 não isola pubsub (experimento real em Redis descartável). Eventos de Studio incluem job_id e, na conclusão, asset_url, agravando a necessidade de audience autorizada.

## PERFORMANCE / AI LATENCY — PHASES 22–23

Nenhuma carga foi enviada a provedores pagos ou agentes produtivos. Concorrência 1/5/10 usuários em chat/Bento/Otto/ClickUp: **NOT VERIFIED**. Throughput e taxa de erro sob carga: **NOT VERIFIED**. Não substituir isso por benchmark de `/health`.

Tempos abaixo são **observacionais**, extraídos de `completed_at−started_at`, últimas 24 h da coleta, apenas execuções completed. Não incluem necessariamente espera na fila, browser, nem isolam modelos/fast paths. Dataset pode conter QA; não é SLA.

| Agente | n completed | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Bento | 41 | 9,043 s | 24,547 s | 52,089 s |
| Otto | 23 | 11,715 s | 21,816 s | 27,111 s |
| Jarbas | 27 | 0,771 s | 10,096 s | 16,606 s |
| Suzy | 1 | 11,378 s | 11,378 s | 11,378 s |

Havia também 1 Bento failed e 1 Jarbas timeout no recorte. O registro timeout do Jarbas durou aproximadamente 8.286,7 s entre timestamps, muito além do HTTP timeout; isso pode representar estado antigo finalizado por varredura, **não prova** que a chamada HTTP executou por 138 min. Ilustra por que estado/timeout total e fase precisam ser distinguíveis.

Routing/context/model/tool/verification têm código, logs e alguns duration_ms, mas não há decomposição consistente exportada para esse conjunto. Assim, **não há evidência suficiente para atribuir o maior gargalo real a uma fase única**. Rede do banco, waits de GPU e geração são candidatos do código; dizer “é o LLM” sem trace seria especulação. Studio image completed/7d tem gpu_time médio de 417 s, que não equivale a tempo puro de inferência.

## OBSERVABILITY / LOGGING — PHASES 31–32

Fastify possui reqId; aplicação usa executionId, execution_steps, agent state/evidence/outcomes, tool_calls/results, audit_logs, custos e worker heartbeat. Há sinais úteis para diagnóstico. Porém não há contrato único que obrigue user+organization+intent+entities+sources+mutation+verification+phase latency em todos os caminhos. Aprovações podem ter executionId null; eventos WS não têm audience tenant obrigatória; ferramentas remotas podem executar fora do trace local.

Logs de API e worker estão em arquivos de longa duração; rotação/retention do arquivo local não foi comprovada. Retenção de health_checks e jobs existe em código. P0-03 tem precedência sobre melhorar dashboards: primeiro impedir credencial em log. PII operacional e respostas aparecem em alguns logger.warn; coleta/relatório limitaram-se ao necessário para evidência.

## TEST INVENTORY — PHASES 33–34

| Pacote | Casos finais aprovados | Natureza predominante |
|---|---:|---|
| agent-runtime | 71 | lógica/grounding/planner, unit |
| auth | 21 | RBAC/provisioning mocks + JWT com servidor local |
| context-engine | 193 | contexto/resolução/sanitização, mocks |
| database | 3 | schema/timestamps |
| orchestrator | 151 | filas/memória/alertas, mocks |
| otto | 245 | criativo/brain/providers, fixtures/mocks |
| router | 21 | regras/classificador, mocks |
| tool-gateway | 72 | ClickUp/safety/verificação, fetch mockado |
| types | 22 | schemas/lógica |
| api | 106 | 103 unit/mock + **3 com PostgreSQL real descartável** |
| web | 212 | jsdom, parte com canvas/image fake |
| worker | 532 | unit/mock + gateway com sockets HTTP locais reais |
| otto-node | 39 | execução/health/config com providers simulados |
| studio-node | 166 | geração/QA/resume/modelos com dependências simuladas |
| **Total** | **1.854** | **Não são 1.854 E2Es reais** |

**Execução:** pacotes sequenciais, Vitest sem cache, máximo dois workers; testes tenant opt-in rodados separadamente em banco descartável. Typecheck `tsc --noEmit --incremental false`; lint sem fix. Cinco build.mjs executados em memória com write:false; validam bundling, não boot de artefato nem build completo Next/Vercel.

**Histórico honesto de falhas:** primeira rodada: 1.846 passed, 5 failed, 3 skipped. Um teste ClickUp foi barrado pelo kill switch imposto no harness; dois do GPU gateway falharam com variáveis de timeout vazias; dois de integration-health exigiam CLICKUP_API_KEY apesar do fetch mockado. Segundo passo: gateway 4/4 e tool-gateway 72/72, ainda 2 falhas de integration-health. Com valores sintéticos coerentes e chave inválida apenas no processo mockado, worker completo 532/532. Três opt-in tenant passaram em PostgreSQL isolado. Nenhum teste/fonte/env de produção foi alterado. Os resultados iniciais não foram escondidos nem tratados como cinco bugs de produto.

**Unit / mocked integration:** principal cobertura acima. **Real integration:** fresh/replay Drizzle; 3 tenant tests; servidor HTTP local do GPU gateway/JWT; componente Canvas em Chromium real; sondas read-only externas. **Live E2E agentes:** 0 novos fluxos completos executados; foram relidos registros reais e confirmado efeito ClickUp por GET. **UI E2E publicada autenticada:** NOT VERIFIED. **Browser component integration:** Canvas/export real passou; persistência/storage/auth eram substituídos por callbacks/ambiente isolado.

Não foi executado `pnpm build` global sobre a árvore ativa porque reescreveria artefatos compartilhados do web/servidor. Build Next completo deve ser feito em ambiente descartável de release, com env de build equivalente; não se considera coberto pelo bundling em memória. Não foram rodados specs E2E existentes que fazem login/criação em cliente default diferente do escopo autorizado sem revisar cada efeito. Suítes genéricas de UI não foram marcadas PASS.

Busca por TODO/FIXME/HACK/stub/mock foi triada por código executável. `TODO` em comentários portugueses muitas vezes significa “todo”, não pendência. Nenhum finding foi criado só por match textual.

## WHAT IS ACTUALLY MOCKED

- Web possui MSW com dados de clients, executions, studio, tool-calls, team, admin, costs, messages, notifications e conversations. Default de API_MODE é mock; arquivo web local define live. Modo do bundle publicado não foi certificado.
- Testes ClickUp simulam fetch e objetos de tarefa; passar não prova create/update externo.
- Grande parte de context-engine/orchestrator/worker/API simula banco, fila e providers.
- Várias suites Canvas usam fake canvas 2D e fake Image; prova de pixels foi feita separadamente no browser real.
- Studio tests simulam respostas ComfyUI/LLM/storage; loader presente e enum de modelo não provam geração completa.
- Os testes adversariais novos desta auditoria usaram código real transpilado em memória, mas dependências simuladas quando explicitado. Não são teste de produção.
- Matriz `google_ads`, WhatsApp ou Instagram não é evidência de executor local funcional. Dependência externa desconhecida foi classificada UNKNOWN, não “mock” automaticamente.

## WHAT IS ACTUALLY LIVE

- API 3001, QA 3011, URL web publicada, gateway GPU e Ollama local respondem.
- Banco PostgreSQL real: catálogo, journal, memberships, índices, grants, estado de jobs e respostas consultados em leitura.
- ClickUp: autenticação válida, 19 membros, webhook ativo e tarefa `pronto` existente confirmados por GET.
- Bento/Jarbas/Suzy health e Otto health/model/brain retornaram 200. Isso prova endpoint, não qualidade do agente.
- ComfyUI 0.33.4 na RTX 4090; filas consultadas e UNETs Flux2/MiniMax presentes.
- Storage: um asset já existente respondeu HEAD 200 sem autenticação.
- Redis produtivo healthy, persistência e consumidores inspecionados; nenhum evento de teste publicado ali.
- Os históricos de Bento/Otto/Jarbas/Suzy são respostas reais persistidas, e os jobs Studio completed são estados do banco. Não foram promovidos automaticamente a “verificados ponta a ponta”.

## 24-HOUR PLAN

Plano de correção recomendado; **não implementado por esta auditoria**. Sequência é por risco. Há mais trabalho que uma pessoa consegue garantir em 24 h; se a fronteira tenant não fechar no prazo, o resultado continua NO-GO.

| Ordem | Owner area | Trabalho necessário | Estimated effort | Dependency | Definition of done |
|---|---|---|---|---|---|
| 1 | Backend/segurança | Conter logs com tokens; corrigir logging/handshake e tratar sessões/cópias afetadas | 2–4 h | Responsável pelo ambiente | Novo bearer nunca aparece em request/error logs; sessões expostas tratadas; regressão automatizada |
| 2 | Worker/IA operacional | Fechar update→create; revisar todas as famílias de operação | 4–8 h + aceite | Parser/guard | E09 e datas explícitas não criam tasks; ambiguidade para; teste de criação legítima continua passando |
| 3 | Backend/segurança | Fechar fronteiras REST/WS/approval/assets; priorizar também leitura por usuário sem papel | 1–3 dias | Política de organização/master | Dois tenants reais isolados em testes; zero leitura/escrita/stream estrangeiro; download privado autorizado |
| 4 | Integrações | Dedup durável e approval com execução/verification atômicas | 6–12 h | Intenção/alvo corrigidos | Duas chamadas/retry após timeout produzem um efeito; completed só após prova |
| 5 | SRE/QA | Separar ambiente QA em pubsub/banco; produzir release rastreável e smoke restrito | 4–8 h | Itens 1–4 para aceitar writes | Mesmo SHA/digest por serviço, sem cross-talk; teste usa só Cliente Teste 7/Pedro Gabriel |

Qualquer decisão de ligar/desligar escrita, revogar sessão ou alterar buckets é operação de correção futura, não ação tomada nesta auditoria. Enquanto P0 permanecer, não liberar uso diário nem recomendar apenas “cuidado no prompt”.

## THIS WEEK PLAN

Máximo de dez entregas, com aceite operacional:

1. **Fechar os três P0** com regressão e replay dos casos sintéticos + caso update→create, sem alterar cliente real para teste.
2. **Release imutável e rollback ensaiado**: web/API/worker/nodes/schema identificados; build Next completo e boot dos artefatos em QA.
3. **Bento operacional**: create/update/assign/status/due/comment usando alvo inequívoco; read-back da operação pretendida; idempotência em concorrência/timeout; apenas Cliente Teste 7/Pedro no aceite mutativo.
4. **Otto V1→V2→approval→task**: conteúdo aprovado versionado e preservado; cenário “Agora gostei.” não regenera; designer confirma utilidade real da peça.
5. **Jarbas read-only com prova factual**: datas relativas/ISO/follow-up, fórmulas, ranking e comparação calculados sobre dataset registrado; mesma entrada/dataset produz mesmos fatos.
6. **Suzy com escopo honesto**: certificar lead/contexto/CRM e envio idempotente em sandbox; se não disponível, publicar somente como apoio de texto, sem promessa de atendimento integrado.
7. **Backup/Redis/reconciliação**: RPO/RTO, snapshot/AOF ou alternativa definida, restore isolado e reprocessamento seguro de jobs órfãos.
8. **Studio canary**: browser UI real, save/reload/conflito, asset privado, PNG/JPEG/PDF; um pipeline imagem e um vídeo em ambiente isolado com qualidade humana, latência e lineage.
9. **Observabilidade de execução**: request→execution→tenant→tool→verification e tempos por etapa; falha de fonte não vira dado vazio silencioso; alerta entregue a canal aprovado.
10. **Aceite de carga leve** em QA: 1/5/10 usuários, p50/p95/p99/erro/throughput; produção só recebe canary após gates, sem carga em provider pago.

## CAN WAIT

- Remoção de imports não usados e modernização de comentários, depois dos bloqueios reais.
- Polimento visual e ferramentas adicionais de Canvas; o export básico já tem prova.
- Checklist/subtask nativo se houver workaround operacional explícito em tarefa/descrição e isso não for indispensável ao canary.
- Novos modelos, providers de vídeo ou expansão de Google Ads/CRM antes de certificar os caminhos existentes.
- Otimização especulativa de índices sem plano/latência observados.
- Uma régua estética automatizada mais sofisticada antes de corrigir intenção, fonte, aprovação e isolamento.

P2-01 (organização), P2-02 (concorrência) e P2-06 (revogação) podem subir de prioridade conforme o perfil dos usuários do canary; não são “polish” universalmente dispensável.

## TOP 10 WAYS THIS SYSTEM COULD FAIL TOMORROW

Ordenação qualitativa por impacto × probabilidade, usando evidência observada; não são probabilidades numéricas inventadas.

1. **Pedido cotidiano de atualizar tarefa cria outra tarefa no cliente** — P0-01, já observado e reproduzido no parser.
2. **Token válido sai junto de um log de suporte** — P0-03, exposição atual confirmada.
3. **Usuário alcança conversa/execução/asset de outra organização** — P0-02; barreira incompleta e download público.
4. **Retry/duplo clique gera duas tasks** — P1-01; dedup falha aberta e sem reserva atômica no fluxo senior.
5. **Jarbas orienta decisão com período/ranking não comprovado** — P1-02; range ISO/relativo passa e fatos vêm em prosa.
6. **Otto troca a ideia depois de aprovada** — P1-10; efeito já visto em conversa real.
7. **Evento de QA aparece na UI de produção** — P1-07; canal Redis comum atravessa DBs.
8. **Queda/redeploy perde job ou torna rollback irreproduzível** — P1-04/P1-05; source sujo, RDB sem AOF e restore não demonstrado.
9. **Aprovação aparece como completed sem prova da ação externa** — P1-06/P1-08; HTTP/prosa não equivalem a efeito verificado.
10. **Um número inventado passa pelo grounding porque o nome coincide** — P1-03; 999 versus 3 foi aceito com confiança 0,9.

## PHASE COVERAGE AND LIMITS

| Fase | Resultado desta auditoria |
|---|---|
| 0 Snapshot | Registrado Git, processos, versões, serviços, portas, containers |
| 1 Architecture | Mapeada por código/callers e runtimes observados |
| 2 Source/runtime | Divergência/ausência de identidade documentadas; equivalência completa NOT VERIFIED |
| 3 Env | Nomes/classificação com parser dotenv; secrets nunca impressos |
| 4 Infra | Sondas live e configuração; sem restart/fault injection produtivo |
| 5 DB | Catálogo/journal/hash; fresh/replay real em isolado; drift DDL completo NV |
| 6 Tenant | Automations passam em DB isolado; gaps REST/WS/asset confirmados |
| 7 Tools | Matriz DB + primitivas/callers/garantias, sem writes reais |
| 8 Subcalls | Writer textual seguro verificado; dispatch remoto não é sandbox |
| 9 Kernel | Casos linguísticos puros reproduzidos; falha crítica de operação |
| 10 Bento | Código/testes/histórico + efeito real lido no ClickUp |
| 11 Otto | Código/testes/health + outputs/approval real relidos |
| 12 Jarbas | Guard adversarial + resposta real; dataset/fórmulas remotos NV |
| 13 Suzy | Health/código/histórico; lead/CRM/channel E2E NV |
| 14 Quality | Amostras reais avaliadas semanticamente; não benchmark estatístico |
| 15 Memory | Escopo/expiry/limites/callers inspecionados; isolamento universal ausente |
| 16 ClickUp | Reads live; writes apenas em mocks; nenhuma alteração externa |
| 17 Integrations | Matriz separa credencial/implementação/serviço/função |
| 18 Studio | Suites + hook real Chromium/export; UI completa/persistência externa NV |
| 19 Image | Comfy/modelos e jobs existentes; nova geração/qualidade NV |
| 20 Video | Código/modelo/testes; vídeo final atual NV |
| 21 Assets | Fluxo/código/buckets/HEAD; isolamento insuficiente |
| 22 Performance | Percentis observados; carga 1/5/10 NV |
| 23 AI latency | Tempo global medido; decomposição/gargalo causal NV |
| 24 Queues | Consumidores/config live; pubsub cross-DB reproduzido isolado |
| 25 Realtime | Dois usuários/conversas sintéticos, handler real; cross-talk encontrado |
| 26 Auth | Tests/HTTP negativos; login/logout real não reexecutados |
| 27 Files | Upload/MIME/limites/storage inspecionados; SSRF identificado |
| 28 Errors | Taxonomia/catches/logs triados por efeito operacional |
| 29 Fake success | Garantias variam por caminho; read-back não valida intenção |
| 30 Injection | Defesa estrutural testada; adversarial remoto mutativo não executado |
| 31 Observability | Rastro parcial, falta correlação/tenant/tempos uniformes |
| 32 Logging | Exposição de bearer comprovada sem revelar valores |
| 33 Tests | 1.854 finais, typecheck/lint completos, bundles em memória; limites de E2E/build claros |
| 34 Code quality | Sem findings por regex bruto; warnings/stale comments separados |
| 35 Production | Supervisão existe; release/backup/rollback não atestados |
| 36 Disaster | Experimentos locais + comportamento de código; nenhum serviço produtivo derrubado |

## FINAL VERDICT

**CORE OPERATIONS: 47/100**

**FULL PLATFORM: 49/100**

**OPEN P0: 3**

**OPEN P1: 10**

**OPEN P2: 6**

**OPEN P3: 2**

**CAN THE AGENCY USE IT THIS WEEK? NO, no estado auditado.**

Pode chegar a **YES WITH RESTRICTIONS** nesta semana somente depois de fechar os P0 e comprovar os fluxos centrais no mesmo artefato de release. Restrições propostas para esse futuro canary: usuários nominalmente autorizados; aceite mutativo só Cliente Teste 7/Pedro Gabriel antes de ampliação; Meta somente leitura; Jarbas sem decisão factual não comprovada; Suzy sem envio autônomo até certificar identidade/entrega; Otto com aprovação de versão explícita; Studio com export/save/reload e privacidade demonstrados; acompanhamento de erros e rollback ensaiado.

Não confundir essa possibilidade de correção com aprovação atual. O sistema possui bastante implementação útil e testes, mas hoje pode executar a ação errada e expor conteúdo/sessão. Esses defeitos têm prioridade sobre novas features e sobre aumentar a nota.
