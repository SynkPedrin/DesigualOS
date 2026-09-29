# DESIGUAL OS MCP — mapa da arquitetura atual e o caminho até o servidor remoto

29/09/2026. Escrito para quem vai implementar o MCP e para quem decide o escopo.

Passo 1 da missão: **inspecionar antes de construir.** Este documento é o resultado da inspeção. Nada foi alterado para produzi-lo.

A conclusão curta: **a maior parte do "Desigual Core" que a missão descreve já existe e está em produção.** O que não existe é a *superfície* — um servidor MCP remoto com autorização própria — e três peças de domínio (papéis, evento organizacional, provider de tráfego). Isso muda bastante o tamanho do trabalho: não é construir um sistema, é expor um que já está de pé, e fechar buracos específicos.

---

## A. O QUE JÁ EXISTE

### A.1 Identidade, organização e RBAC — existe, e é melhor do que a missão supõe

| Peça | Onde | Estado real |
|---|---|---|
| Usuários | `users` | 10 linhas. Tem `authUserId` (Supabase), `email`, `clickupEmail`, `active`, soft delete |
| Organizações | `organizations`, `organization_members` | 10 memberships. `organization_id` já é a fronteira de tenant |
| Papéis | `roles` + `role_name` enum | **Só dois papéis: `master` e `colaborador`** (`packages/types/src/role.ts`) |
| Permissões | `permissions` (8 linhas) | `(role, resource, action)` com curinga `*`. É um RBAC de verdade |
| Resolução | `packages/auth/src/rbac.ts` | `loadUserAccess()` + `hasPermission()`, com curinga |
| Fronteira de tenant | `apps/api/src/lib/access.ts` | `hasClientAccess`, `authorizedClientIds`, `tenantSharingScope`, `hasOrganizationAccess` |
| Autenticação | `packages/auth/src/supabase-jwt.ts` | **JWT do Supabase**, não OAuth próprio |

Observação importante: `hasClientAccess` **já** verifica membership de organização. Havia um comentário no `operational-context.ts` dizendo que ela "devolve `true` pra todo mundo" — está desatualizado, a função foi endurecida. Não confie no comentário; confie na query.

### A.2 Memória — existe, e já tem a forma que a §11 pede

Tabela `memories` (474 linhas, 101 delas `client.profile`):

```
kind · content · metadata · source_type · source_id · confidence · importance
status · superseded_by · superseded_at · last_verified_at · expires_at
dedupe_key · environment · client_id · user_id · agent_id
```

`status` hoje usa `active`/`superseded`. A missão pede `OBSERVED | INFERRED | CONFIRMED | APPROVED | REJECTED | SUPERSEDED` — **é uma ampliação de vocabulário, não uma tabela nova.** A supersessão, a proveniência, a confiança e o isolamento por cliente e por ambiente já funcionam e têm teste.

Complementos que já existem: `agent_episodes` (memória episódica, 31 linhas), `campaigns` (860), `people` (23), `person_client_relations` (289), `client_knowledge_sync` (115).

### A.3 Event log — a tabela existe; o conteúdo, quase não

`operational_events`, 633 linhas. Colunas: `source, type, external_id, client_id, entity_type, entity_id, actor, payload, raw, occurred_at, processed_at, processing_error`.

Estado medido:

- **só dois tipos existem**: `task.created` (257) e `task.updated` (376), ambos do webhook do ClickUp;
- **`actor` é null em 100% das linhas** — o webhook não grava quem mexeu;
- a escrita é idempotente por `(source, external_id)`, com índice único;
- a leitura acabou de ser ligada (`eventsSince` tinha zero chamadores até hoje).

Para a missão, faltam as colunas `organization_id`, `employee_id`, `user_id`, `project_id`, `task_id`, `summary`, `importance`, `visibility` — e os ~25 tipos de evento de negócio (`CLIENT_FEEDBACK`, `CREATIVE_APPROVED`, `PREFERENCE_LEARNED`…). **Nenhum deles existe hoje.**

### A.4 Auditoria — existe, e é fina demais para a §12

`audit_logs`, 2.336 linhas. Colunas: `user_id, action, agent, client_id, timestamp, result, metadata`.

A §12 exige `employee_id, tool, resource, old_value, new_value, request_id, session_id, source`. Hoje tudo isso teria que caber em `metadata` (jsonb) — dá pra responder "quem alterou", mas não dá pra consultar por `request_id` nem comparar `old_value`/`new_value` sem varrer jsonb.

### A.5 Providers — o padrão já é o da missão, com um nome diferente

`packages/tool-gateway` **é** a camada de adapters:

```
clickup-client.ts (891 linhas) · clickup-operation.ts · clickup-oauth.ts
clickup-mcp-oauth.ts · notion-oauth.ts · gateway.ts · write-scope.ts
task-verification.ts · senior-operation.ts · bento-qa-client.ts
```

O que falta para virar o `TaskProvider` da §16 é a **interface**: hoje o domínio importa `createTask`/`updateTask` do ClickUp diretamente. A troca de provider exigiria mexer no domínio — exatamente o que a §16 quer evitar.

Capacidades reais de ESCRITA no ClickUp: criar, atualizar, deletar, status, responsável, comentário, resposta a comentário, tag, dependência, checklist, campo personalizado, watcher, anexo, tempo, adicionar a outra lista. Capacidades de LEITURA: `getTask`, `getTaskComments`, `listStatusesForTask`, `listCustomFields`, `getTeamMembers`, `queryOperationTasks`. **Não há leitura de espaço, pasta ou Doc** fora do fluxo de OAuth.

### A.6 Tráfego — não está neste repositório

`clientMetaAccounts` guarda só o mapa `clientId -> accountId` do Meta. O dado de campanha vive no **Jarbas, serviço externo** (`JARBAS_ASK_URL`, default `http://100.118.12.97:3102`), e o mapa autoritativo está num `clientData.js` fora do repo.

Consequência para a §8: o `TrafficProvider` precisa ser um **adapter sobre o Jarbas**, não uma integração Meta/Google nova. Construir integração direta seria uma segunda fonte de verdade para o mesmo número.

### A.7 MCP — não existe nada

`@modelcontextprotocol/sdk` **não é dependência de nenhum pacote**. O que existe é o lado *cliente*: `clickup-mcp-oauth.ts` guarda um token OAuth para que a OpenAI Responses fale com o MCP do ClickUp. O Desigual OS hoje **consome** MCP; não **serve** MCP.

### A.8 Autorização — existe autenticação, não existe authorization server

O sistema valida JWT do Supabase. Para Remote MCP, o servidor precisa **ser** (ou delegar a) um Authorization Server OAuth 2.1, com `/.well-known/oauth-authorization-server`, registro dinâmico de cliente, PKCE, e metadata de Protected Resource. Nada disso existe. É a maior peça nova.

### A.9 Infraestrutura

Fastify 4 com `helmet`, `cors`, `rate-limit`, `websocket`, `multipart`. Postgres (Supabase, schema `0043`, migrações SQL numeradas em `database/migrations/`). Redis (BullMQ). Supervisor local (`infra/supervisor.sh`) e plists de launchd. Deploy web na Vercel; API e worker no Mac Mini via Tailscale. **Não há HTTPS público hoje** — nem domínio, nem terminação TLS.

---

## B. O QUE A MISSÃO PEDE E NÃO EXISTE

Em ordem de esforço, do maior para o menor:

| # | Peça | Por que é grande |
|---|---|---|
| B-1 | **OAuth 2.1 Authorization Server** | Não existe nada. Precisa de discovery, registro dinâmico de cliente, PKCE, consentimento, tokens curtos e revogáveis, refresh, e ligação token→`user_id`+`organization_id`+scopes |
| B-2 | **Servidor MCP remoto (HTTP streaming)** | SDK novo, transporte novo, ~45 tools, superfície pública |
| B-3 | **7 papéis no lugar de 2** | `role_name` é um enum do Postgres; ampliar exige migração e uma matriz de permissões por papel |
| B-4 | **Evento organizacional** | ~25 tipos novos e 8 colunas novas em `operational_events`; hoje só existe o evento de webhook do ClickUp |
| B-5 | **Auditoria com `old_value`/`new_value`/`request_id`** | Colunas novas em `audit_logs` |
| B-6 | **Interfaces de provider** | `TaskProvider`, `TrafficProvider`, `AssetProvider`, `KnowledgeProvider` — extrair do que já existe |
| B-7 | **Entity resolution para o MCP** | Existe parcialmente (`resolve-client`, `entity-matching`, `campaigns.aliases`, `people.aliases`), mas sem contrato de "devolva candidatos em vez de escolher" |
| B-8 | **Idempotência por `idempotency_key`** | Existe reconcile-first no create do ClickUp e dedup por `ExecutionRecord`; falta a chave explícita na fronteira da tool |
| B-9 | **HTTPS público** | Domínio, TLS, exposição do Mac Mini ou realocação do servidor |

---

## C. DECISÕES QUE PRECISO PROPOR ANTES DE CODAR

### C.1 Onde o servidor MCP mora

**Proposta: `apps/mcp/`, processo separado, Fastify próprio.** Não dentro do `apps/api`.

Motivo: a API hoje serve o frontend com JWT do Supabase e está sob supervisor local. O MCP é superfície pública com modelo de autorização diferente e ciclo de vida diferente. Misturar os dois faz um incidente de um derrubar o outro, e faz o blast radius de uma mudança de auth cobrir o app inteiro. Os dois compartilham `packages/*` — o core é o mesmo, a porta é outra.

### C.2 Authorization Server: próprio ou delegado

O Supabase já é o IdP da casa. **Proposta: o MCP não implementa login — ele delega ao Supabase e emite tokens próprios de MCP**, curtos, com `user_id`, `organization_id` e scopes embutidos, revogáveis por linha em tabela. Assim não duplicamos gestão de identidade e continuamos donos do escopo por tool.

Isso ainda exige implementar os endpoints OAuth que o cliente MCP espera (discovery, authorize, token, registro de cliente) — mas o `authorize` vira uma ponte para a sessão Supabase, não uma tela de senha nova.

### C.3 Papéis: ampliar o enum ou usar `organization_members.role`

`organization_members` já tem uma coluna `role` (text, default `collaborator`) que hoje quase não é usada. **Proposta: os 7 papéis da missão viram valores dessa coluna** (é `text`, não enum — não exige migração de tipo), e `roles`/`permissions` continuam governando a permissão granular. Ampliar o enum `role_name` quebraria código que assume dois valores; usar a coluna que já existe é aditivo.

### C.4 Sem Anthropic API — já é o caso hoje

A §18 é um requisito que o repositório **já cumpre por acidente de arquitetura**: não há chamada à Anthropic API em nenhum caminho de resposta. `ANTHROPIC_API_KEY` está vazia no `.env` e o código que dependia dela (`completeTextSafely`) já cai em OpenAI ou Ollama local. O MCP deve manter isso: tools determinísticas, `LLMProvider` como interface opcional e não usada por padrão.

---

## D. O QUE EU NÃO CONSIGO ENTREGAR SOZINHO

Honestidade sobre a fronteira, para não virar surpresa no fim:

1. **`https://mcp.desigualos.com`** — depende de registrar/apontar DNS, emitir certificado e expor um host público. Hoje a API roda num Mac Mini atrás de Tailscale. Posso deixar o servidor pronto e documentar o caminho (Cloudflare Tunnel é o menor esforço aqui), mas não provisiono domínio nem TLS.
2. **Conectar na organização Claude** — o cadastro do connector e a liberação por membro acontecem no painel da Anthropic, com a conta de vocês. Documento o passo a passo; não executo.
3. **Validar contra o Claude Web de verdade** — só dá para testar de ponta a ponta depois de (1) e (2). Até lá, o teste é contra um cliente MCP local.
4. **Os 3 usuários Claude (SUPER, CRIATIVO, ATENDIMENTO)** — preciso saber a quais `users`/`organization_members` do banco eles correspondem para montar a matriz de papéis. Hoje há 10 usuários e 10 memberships.

---

## E. PLANO INCREMENTAL PROPOSTO

Cada fase entrega algo testável e não quebra nada do que existe.

| Fase | Entrega | Toca em |
|---|---|---|
| 1 | Interfaces de provider (`TaskProvider` etc.) + `ClickUpTaskProvider` sobre o `tool-gateway` atual | pacote novo `packages/mcp-domain` |
| 2 | Tabelas: `mcp_clients`, `mcp_tokens`, `mcp_sessions`; colunas novas em `audit_logs` e `operational_events` | migração **aditiva** |
| 3 | Papéis e matriz de permissão (7 papéis em `organization_members.role`) + seed | migração aditiva + seed |
| 4 | Servidor MCP com transporte HTTP + tools de **leitura** e identidade | `apps/mcp` novo |
| 5 | OAuth 2.1 delegando ao Supabase | `apps/mcp` |
| 6 | Tools de **escrita** com `idempotency_key`, auditoria e confirmação de destrutivo | `apps/mcp` |
| 7 | Eventos de negócio + memória com `status` ampliado | `packages/mcp-domain` + migração |
| 8 | Testes multi-usuário, RBAC, duplicidade, auditoria; E2E da §25 | `apps/mcp` |
| 9 | Documentação: `CLAUDE_MCP_SETUP.md`, `claude-organization-instructions.md` | `docs/` |

Fases 1 a 3 não tocam em nenhum arquivo que o trabalho em curso no Bento está editando.
