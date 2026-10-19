# Desigual OS como Control Plane — arquitetura atual e alvo

Fase 0 da virada estratégica. Escrito antes de alterar qualquer código, para separar o que já existe do que falta.

**A mudança em uma frase:** o Desigual OS para de tentar ser um Claude melhor e passa a ser a camada que falta ao Claude — conhecimento privado, memória compartilhada, operação real, execução controlada e auditoria.

---

## A. O QUE JÁ EXISTE E SERVE

Boa notícia primeiro: o núcleo do control plane já está construído e em produção. O que faltava era a superfície.

| Camada | Onde | Estado |
|---|---|---|
| **Servidor MCP remoto** | `apps/mcp` | Funciona. OAuth 2.1 completo, 26 tools, transporte HTTP streaming, SDK oficial 1.31.0 |
| **Domínio do MCP** | `packages/mcp-domain` | 48 testes. Scopes com teto por papel, idempotência, memória com procedência |
| **Autenticação** | `apps/mcp/src/auth` | OAuth delegando identidade ao Supabase. Token hasheado, curto (1h), revogável, com refresh rotativo |
| **Permissões** | `organization_members.role` + `packages/mcp-domain/src/scopes.ts` | 7 papéis, teto por papel, interseção com o token. Papel lido do banco a cada chamada |
| **Auditoria** | `audit_logs` (migração 0044) | `old_value`/`new_value`, `request_id`, `session_id`, `source='mcp'`, `tool`, `resource` |
| **Event store** | `operational_events` | Idempotente por `(source, external_id)`. Já carrega organização, funcionário, resumo, importância, visibilidade |
| **Memória** | `memories` | `status`, `confidence`, `source_type`, `superseded_by`, `environment`. Supersessão e isolamento por cliente testados |
| **Resolução de escopo** | `packages/context-engine/src/resolve-scope.ts` | Cliente, pessoa, temporal, global, herança de turno anterior |
| **ClickUp** | `packages/tool-gateway` | Leitura e escrita com read-back campo a campo, reconcile-first, resolução de membro sem adivinhar |
| **Contexto** | `packages/context-engine` | `build-operational-context`, `briefing-engine`, `build-change-context`, `natureza-do-cliente` |
| **Saúde** | `apps/worker/scripts/saude-do-bento.mts` | Separa QUEBRA de RECUSA LEGÍTIMA. Existe como script, não como produto |
| **Motor operacional** | `packages/bento-core` + `apps/worker/src/processors` | Planner, policy, executores verificados, guard |

**Conclusão da auditoria:** não há nada grande para construir do zero. Há coisa para **expor**, **renomear** e **operacionalizar**.

---

## B. ARQUITETURA ATUAL

```
Tammy / Endrigo / Pedro
        │
        ▼
   apps/web  (chat do Bento — a interface principal hoje)
        │
        ▼
   apps/api  ──► resolve escopo, monta contexto, enfileira
        │
        ▼
   apps/worker ──► callBento ──► bento-qa (Mac Mini, serviço externo, opaco)
        │
        └──► tool-gateway ──► ClickUp

   apps/mcp  (existe, 26 tools, OAuth — NÃO está no ar, NÃO está conectado)
```

O caminho que a equipe usa hoje passa pelo chat e termina num serviço externo que o repositório não controla. O MCP existe ao lado, completo, e ninguém usa.

---

## C. ARQUITETURA ALVO

```
Claude Tammy   Claude Endrigo   Claude Pedro   Claude Criativo
      │              │               │              │
      └──────────────┴───────┬───────┴──────────────┘
                             │ MCP sobre HTTPS
                             ▼
                    ┌─────────────────┐
                    │  DESIGUAL MCP   │  ← identidade, papel, scope
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   CONTEXT PACK          POLICIES             AUDIT + EVENTS
   (só o necessário)     (permissão,          (quem, o quê,
                          idempotência,         quando, qual
                          read-back)            cliente)
        │                    │                    │
        └────────────────────┼────────────────────┘
                             ▼
                    ┌─────────────────┐
                    │  BENTO ENGINE   │  ← deixa de ser interface,
                    │  (infraestrutura)│    vira motor
                    └────────┬────────┘
                             ▼
              ClickUp · memória · event store · vault
```

**Claude pensa. O Desigual OS sabe, decide se pode, executa e registra.**

---

## D. O QUE MUDA DE PAPEL

| Componente | Era | Passa a ser |
|---|---|---|
| **Chat do Bento** (`apps/web`) | a interface principal | console interno / debug. Não some |
| **`bento-qa`** (Mac Mini) | quem escreve a resposta | não participa do caminho MCP. O Claude do funcionário é quem raciocina |
| **`bento-core` + processors** | motor do chat | motor do MCP: resolve escopo, aplica política, executa, relê |
| **`apps/mcp`** | protótipo ao lado | **a superfície do produto** |
| **`apps/web` home** | chat | Control Center: saúde, atividade, memória, permissões, auditoria |

O `bento-qa` sair do caminho é a maior simplificação da virada: ele é a caixa-preta que o repositório não controla, e o Claude do funcionário faz melhor o que ele fazia.

---

## E. O QUE FALTA, EM ORDEM

| # | Peça | Esforço | Por quê |
|---|---|---|---|
| 1 | **Publicar o MCP em HTTPS** | pequeno, mas bloqueado por infra | Sem endpoint público nada mais importa. `cloudflared` não está instalado nesta máquina |
| 2 | **Contrato de nomes `desigual.*`** | pequeno | As 26 tools existem com outros nomes; a missão fixa 12 nomes para a V1 |
| 3 | **Persistência de escopo entre chamadas** | médio | O MCP hoje é sem estado por requisição. "e o que tá travado lá?" precisa lembrar o cliente |
| 4 | **`get_recent_changes` sobre o event store** | pequeno | O builder já existe (`build-change-context`); falta a tool |
| 5 | **`remember` / `recall` com escopos** | médio | A tabela tem o que precisa; faltam os escopos `AGENCY/CLIENT/EMPLOYEE/USER_PRIVATE` e a garantia de não vazamento |
| 6 | **Control Center** (`apps/web`) | grande | Saúde, atividade, memória, permissões, auditoria, integrações, incidentes |
| 7 | **Concorrência** | médio | O MCP não herda o "uma pergunta por vez" do `bento-qa` porque não passa por ele — mas precisa ser provado com carga |
| 8 | **Bateria de aceite com 4 usuários** | médio | Depende de 1 e 2 |

---

## F-BIS. A REGRA QUE SEPARA O CONTROL PLANE DO PRODUTO ANTERIOR

Esta é a linha que decide se a virada é real ou é maquiagem, e por isso está
travada em teste (`apps/mcp/src/architecture.test.ts`), não em revisão de PR.

**Nenhuma tool MCP de leitura determinística pode depender do pipeline serial
do Bento.**

O produto anterior tinha um formato:

```
Claude → MCP → Bento Chat (bento-qa, um nó, uma pergunta por vez) → resposta
```

Isso herdaria para o control plane exatamente o gargalo que ele existe para
eliminar — o `bento-qa` é um serviço externo, opaco, que atende uma pergunta
de cada vez (medido pelas duas sessões que trabalharam nisto: "Ollama 502" e
"ocupado respondendo outra pergunta" em uso concorrente).

O formato real, verificado por teste estático em todo arquivo de `apps/mcp`:

```
Claude → MCP → context-engine / tool-gateway / mcp-domain / banco
```

`get_operation_overview`, `search_tasks`, `recall`, `get_health`,
`get_current_permissions` — toda leitura determinística vai direto aos módulos
internos. Nenhuma delas importa `@desigual-os/orchestrator`,
`@desigual-os/agent-runtime`, `@desigual-os/bento-core`, `@desigual-os/router`
nem referencia `callBento`/`bento-qa`. `package.json` não declara essas
dependências, e o teste falha se alguém as reintroduzir — inclusive por um
import solto num arquivo novo.

**O Bento Core continua existindo**, mas só onde há raciocínio real a fazer —
resolução de escopo ambíguo, política de escrita, planejamento de ação. Ele é
reaproveitado como infraestrutura interna do `create_task`/`update_task`
(via `tool-gateway`, com read-back e idempotência), nunca como a resposta a
uma pergunta de leitura.

**Prova, não afirmação:** `pnpm --filter @desigual-os/mcp test` roda 19
verificações, uma por arquivo fonte do MCP, cada uma varrendo o conteúdo em
busca dos pacotes e símbolos proibidos. Concorrência real também foi medida —
`apps/mcp/scripts/aceite.mts`, seção 5 — com 4 usuários e 10 chamadas
simultâneas, sem fila serial nenhuma.

---

## F. DECISÕES QUE ESTA VIRADA JÁ TOMA

**O MCP não chama LLM.** Nenhum caminho do `apps/mcp` faz inferência. O Claude do funcionário já está raciocinando; uma segunda inferência aqui seria custo duplo e latência dobrada. `LLMProvider` continua não existindo como dependência.

**O Claude nunca fala com o ClickUp direto.** Toda escrita passa por policy, idempotência, read-back e auditoria. É isso que separa "o Claude tem acesso ao ClickUp" de "o Claude opera a agência com segurança".

**Memória privada não vaza.** O escopo `USER_PRIVATE` é a única garantia que não pode falhar em nenhuma circunstância, e precisa de teste próprio, não de revisão de código.

**Sucesso exige read-back.** Já é invariante da casa (INV-003) e vale igual no MCP: HTTP 200 não é sucesso.

---

## G. O QUE NÃO SE FAZ

Registrado porque a tentação é real e o custo é alto:

- não deletar o Bento — ele vira infraestrutura, não lixo;
- não criar banco, memória ou fila paralelos — o que existe funciona e tem teste;
- não expor ferramenta genérica (`run_sql`, `execute_shell`, `read_file`) — ferramenta de domínio só;
- não usar LLM onde função determinística resolve;
- não inventar URL de MCP que não foi publicada e testada.
