# Desigual OS 2.0 — Step 1/2: inventário e fit/gap de `apps/mcp`, `packages/mcp-domain`, memória e event bus

**Data:** 30/09/2026 · **SHA:** 2139fe5 · **Autor:** sessão desigualos-26
**Escopo:** a metade acordada com a sessão desigualos-61 — MCP, memória, event bus,
RBAC de função, fronteira de tenant no backend. Complementa
`desigual-2.0-inventario-web-api.md` (apps/web, apps/api), que cobre o resto.

Tudo aqui foi medido em produção — banco real, deploy real — não estimado.

---

## 1. O que já existe, funcionando, medido hoje

### 1.1 MCP — canal de cada Claude com o Desigual

`https://desigual-mcp-production.up.railway.app/mcp`, OAuth 2.1 completo (RFC 7591
registro dinâmico, PKCE, consentimento por e-mail/senha real), um processo separado
de `apps/api`. **37 tools, 28 leitura / 9 escrita**, cobrindo identidade, clientes,
tarefas, memória institucional, eventos operacionais, sinais proativos, auditoria e
saúde do sistema. Sessão por conexão (`mcp_sessions`), token nunca em claro
(`mcp_tokens`, só hash).

### 1.2 RBAC por FUNÇÃO — já existe, já é o que o prompt pede em espírito

`packages/mcp-domain/src/scopes.ts` define **7 papéis** (`SUPER_ADMIN`, `MANAGER`,
`CREATIVE`, `CUSTOMER_SUCCESS`, `TRAFFIC_MANAGER`, `QA`, `VIEWER`), cada um com um
TETO de scopes — o token pede um subconjunto, nunca mais que o papel permite, e o
papel é lido do banco a cada chamada (rebaixamento vale no próximo turno, sem esperar
token expirar). Convive com o RBAC legado (`roles`/`permissions`/`user_roles`,
2 papéis: `owner`/`collaborator`) que ainda governa a aplicação web — os dois
moram na mesma coluna (`organization_members.role`, texto livre), documentado assim
de propósito desde a criação.

**Isto já é a distinção que o prompt pede entre "papel por função" e "papel de
acesso"** (§16) — não precisa reconstruir, precisa generalizar pra um segundo eixo
(tenant), que é a seção 3.

### 1.3 Memória institucional e event bus — construído hoje, provado ao vivo

- `memories`: decisão, preferência, feedback, aprendizado, perfil de cliente (brain +
  dossiê). Escopo (`AGENCY`/`CLIENT`/`EMPLOYEE`/`USER_PRIVATE`/...) com garantia de
  que `USER_PRIVATE` nunca atravessa, nem pra `SUPER_ADMIN` — função pura, testada por
  varredura de SQL real, não por inspeção de objeto.
- `operational_events`: vocabulário de negócio (`CLIENT_DECISION`, `STRATEGY_CHANGED`,
  `PREFERENCE_LEARNED`...) que o Claude de cada funcionário registra, filtrado por um
  classificador determinístico que recusa hipótese e conversa casual antes de virar
  memória — código, não instrução de prompt.
- `proactive_signals`: pipeline evento → classifica → notifica, ligado hoje
  (encontramos e corrigimos um gap onde ele existia desde muito antes e nunca tinha
  emitido um sinal sequer, porque as escritas do MCP nasciam com `processed_at` já
  preenchido).
- `get_brain_overview`: retrato agregado (clientes/memórias/decisões) que o
  onboarding da outra sessão consome — números reais, nunca estimados.

O exemplo do §3 do prompt master ("Esther" resolvida como PESSOA antes de CLIENTE)
**ainda não está implementado como entity resolution formal** — hoje cada tool
resolve cliente pelo nome (`search_clients`) e pessoa por auditoria/atividade
(`get_agent_activity`), mas não há uma camada `resolveEntity()` única que decida
"isto é pessoa ou cliente" antes de rotear a busca. Ver seção 3.4.

---

## 2. O achado P0 do dia, e o que já foi fechado no meu lado

Mesmo achado que a outra sessão documentou: **9 de 77 tabelas têm `organization_id`**;
as 6 que faltavam são justamente as de conteúdo (`memories`, `conversations`,
`messages`, `executions`, `agent_episodes`, `proactive_signals`), isoladas só por
convenção (salto via `client_id`/`user_id`). A convenção já falhou duas vezes no
mesmo dia — anotação privada vazando em duas portas diferentes pra `memories`.

**Fechado, no meu lado, medido:**

| Camada | O que foi feito |
|---|---|
| Schema | Migração `0045`: coluna nullable nas 6 tabelas + backfill pelo vínculo indireto que já existia. Sem carimbar organização única por dedução — linha que não resolve fica `NULL`, visível. |
| Escrita (MCP) | `remember`, `save_client_feedback`, `save_learning` populam `organization_id` direto no INSERT. |
| Leitura (MCP) | `fronteiraDeOrganizacao` — fonte canônica única, aplicada em `search_memory`, `recall`, `get_signals`, `get_brain_overview`, `get_client_context` (as DUAS consultas), `get_client_preferences`, e os 3 contadores globais de `get_health` que tinham escapado por agregação. |
| Event bus | `organization_id` passado pela cadeia inteira (`PendingEvent` → `NormalizedEvent` → `SignalCandidate`) em vez de re-derivado — resolve o caso que `organizacaoDaEscrita({clientId})` sozinho não cobre: sinal sem cliente. |

**Ainda em aberto, não é meu lado:** os pontos de escrita de `apps/worker` (3
`memories`, 1 `conversations`, 2 `messages`, 2 `executions`, 1 `agent_episodes`, 1
`proactive_signals`) e as rotas de leitura de `apps/api` — a outra sessão está
nisso.

---

## 3. Fit/Gap — PROVIDER → ORGANIZATIONS → TENANTS, visto do backend

| Capacidade | Existe | Estado | Decisão |
|---|---|---|---|
| Organização como unidade | Sim | `organizations` + `organization_members`, 1 linha hoje | **Reaproveitar.** É literalmente a tabela que o modelo TENANT precisa — falta o nível PROVIDER acima, não uma tabela nova de tenant. |
| RBAC por função (papel dentro da organização) | Sim | 7 papéis, teto por scope, resolvido a cada chamada | **Reaproveitar.** Já é o eixo "o que a pessoa pode". Falta o eixo "em qual organização" — ver 3.1. |
| Fronteira de organização no dado | Parcial | 9/77 tabelas antes de hoje; 15/77 depois (0045) | **Em andamento**, os dois lados. |
| Principal com UMA organização | Sim, e é a limitação central | `McpPrincipal.organizationId: string` — singular, resolvido 1:1 via `organization_members` | **Precisa adaptar** antes de qualquer "Bento Master vê tudo" — ver 3.1. |
| Provider (Desigual gerenciando múltiplos tenants) | Não existe | Nenhuma tabela, nenhum conceito | **Criar**, só depois de decidir 3.1 — não antes. |
| Entity resolution (pessoa vs. cliente vs. tudo mais) | Parcial | Cada tool resolve à sua moda; sem camada única | **Adaptar** — generalizar o que já funciona (ver 3.4), não reescrever do zero. |
| Event bus multi-fonte | Parcial | Só ClickUp (webhook) e MCP (chat) hoje; `NormalizedEvent`/`SignalCandidate` já são genéricos o bastante pra receber mais fontes | **Reaproveitar a forma, estender o conteúdo** quando outra fonte existir (CRM, financeiro — não construir agora, §51). |
| Vault (projeção legível) | Sim, mas não tenant-aware | Escreve num namespace por cliente, não por organização | **Adaptar**, só quando Cosentino virar tenant de verdade (3.1 decide o resto). |

### 3.1 O bloqueio real, e por que não decidi sozinho

`McpPrincipal.organizationId` é uma STRING, uma organização só, resolvida por
`organization_members` (uma linha por usuário+organização, com `unique` nos dois
juntos — hoje o schema já PERMITE uma pessoa pertencer a mais de uma organização,
só ninguém pertence a duas ainda). Pra "Bento Master" (§5, Pedro vendo todas as
empresas) existir de verdade, esse campo precisa virar uma LISTA de organizações
acessíveis, ou o principal precisa carregar um papel `PROVIDER_*` que bypassa o
filtro — e qualquer uma das duas é decisão de segurança, não de conveniência:
decide quem, tecnicamente, consegue atravessar a fronteira que a seção 2 acabou de
fechar.

**Não fiz essa mudança sem confirmar antes por dois motivos, na ordem certa:**

1. É o tipo de decisão que o próprio prompt master pede pra parar e perguntar (§77:
   "decisão irreversível de produto/dados") — mudar o modelo de autorização central
   depois de gastar o dia fechando vazamento nele merece um "sim, é isso mesmo" de
   quem pediu.
2. Não faz sentido desenhar o modelo de acesso multi-organização **antes** de saber
   se Cosentino vira uma organização nova de verdade ou fica como está — são a
   mesma pergunta, feita duas vezes, se eu decidir uma sem a outra.

### 3.2 Cosentino como tenant — o que isso custa no meu lado, medido

Hoje: 58 clientes, todos na mesma organização (`b534f65c…`). Cosentino tem 493
memórias associadas por `client_id`, não por organização própria. Se Cosentino virar
uma `organization` nova:

- Toda memória/evento/sinal DELE precisaria migrar de `organization_id = Desigual`
  pra `organization_id = Cosentino` — mecânico, mas em 500+ linhas, e precisa rodar
  com o mesmo rigor de antes/depois da migração 0045 (§42 do prompt).
- Um funcionário Desigual que atende Cosentino (Tammy, por exemplo) precisaria
  pertencer às DUAS organizações — o schema permite (visto acima), o código de
  resolução de principal (3.1) não usa essa possibilidade hoje.
- `carregarClienteDaOrganizacao` (o portão que toda tool client-scoped passa) teria
  que aceitar "cliente de uma organização que não é a do principal, mas que o
  principal tem acesso cross-org autorizado" — hoje ele rejeita isso por desenho,
  de propósito (é o que garante a fronteira de hoje).

Nenhuma dessas três é grande sozinha. As três juntas são o "Fase A" de verdade, e
são a razão de eu ter parado no inventário em vez de já ter migrado Cosentino.

### 3.3 O que eu NÃO reconstruiria, mesmo com autorização ampla

- **RBAC do zero.** Os 7 papéis por função já fazem o que `TENANT_OWNER`/
  `TENANT_ADMIN`/`TENANT_MEMBER` do prompt master pedem, com nome diferente. Trocar
  nome quebra 37 tools e a bateria de aceite que já testam contra eles — o prompt
  master pede exatamente isto (§16: "não assumir estes nomes se já existir modelo
  melhor").
- **Um "Bento por tenant" como processo separado.** O prompt master já avisa (§6):
  mesmo motor, contexto e permissão diferentes. `montarServidor()` já roda por
  requisição — o isolamento certo é no principal (3.1), não em subir um processo
  novo por cliente.

### 3.4 Entity resolution — o que existe, o que falta

Hoje: `search_clients` (nome → cliente), `get_client_context` (cliente → contexto
completo), `get_agent_activity`/auditoria (usuário → ação). O que falta é a CAMADA
ANTES dessas três: dado um nome solto ("Esther"), decidir se é pessoa, cliente ou
nenhum dos dois, ANTES de rotear pra uma tool específica. Isso hoje é decisão do
Claude que está chamando a tool (ele escolhe qual tool chamar), não do servidor —
funciona bem quando o Claude já sabe distinguir (como no caso real que o Endrigo
testou), frágil quando não sabe. Vale construir como função pura em
`packages/mcp-domain`, reaproveitando `people`/`clients`
(`packages/database/src/schema/knowledge-plane.ts`, que já existe e já resolve
exatamente esse tipo de ambiguidade pra campanha — ver comentário do arquivo sobre
o bug real da Esther, de antes desta sessão). Não fiz isso ainda porque é uma
FEATURE nova, não uma correção — cabe em Fase E do plano de implementação, não em
Fase A.

---

## 4. Recomendação de sequência, dado o que está medido

1. **Fechar o P0 de segurança nos dois lados primeiro** (em andamento, apps/worker e
   apps/api faltando). Não faz sentido decidir modelo de tenant sobre uma fronteira
   que ainda vaza.
2. **Decidir 3.1 explicitamente com quem pediu** — lista de organizações no
   principal, ou papel `PROVIDER_*` que bypassa. Sem isso, Fase A não tem chão.
3. **Só depois, migrar Cosentino** (3.2), com contagem antes/depois de cada tabela
   afetada, do mesmo jeito que a migração 0045 foi provada hoje.
4. **Entity resolution (3.4) e o resto do prompt master** vêm depois — são features
   novas sobre uma fundação que ainda não existe.

Não implementei 2-4 porque cada um depende de uma decisão que não é só minha —
exatamente a régua que a sessão paralela também está seguindo hoje.
