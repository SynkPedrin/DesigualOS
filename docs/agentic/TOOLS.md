# Tools

Status: Tool Gateway e matriz de permissões PRÉ-EXISTENTES e em produção.
Na V2, as ferramentas do loop são os próprios agentes remotos (tratados como
caixa-preta); o registry de tools internas não mudou.

Código: `packages/tool-gateway/` (gateway.ts, agent-ask-client.ts,
clickup-client.ts, bento-qa-client.ts, clickup-operation.ts), tabelas
`agent_tools`, `tool_calls`, `tool_results`
(packages/database/src/schema/agents-infra.ts e tools.ts).

## O registry real de hoje

Não existe um registry dinâmico de ferramentas. O que existe são três peças:

### 1. Matriz de permissões `agent_tools`

Dados, nunca hardcoded: linhas `(agent_id, tool)` com `access`
(`none` / `read` / `write`, enum `tool_access`) e `requires_approval`. Seed em
`packages/database/src/seed.ts`, com backfill de segurança que corrige
`requires_approval` em linhas antigas (achado real: jarbas/meta_ads e
suzy/instagram entraram sem aprovação até 08/09/2026).

Regras da matriz no seed (exemplos reais):

| Agente | Tool | Acesso | Aprovação |
|---|---|---|---|
| bento | clickup.delete_task | write | obrigatória |
| jarbas | meta_ads | write | obrigatória |
| suzy | instagram | write | obrigatória |
| studio | instagram | write | obrigatória |

Sem linha na matriz = acesso negado. Nunca permite por omissão.

### 2. Tool Gateway (`gateway.ts`)

Ponto único de passagem para ação sensível:

- `requestToolCall` (gateway.ts:36): registra SEMPRE em `tool_calls` antes de
  decidir (audit trail primeiro), depois: sem acesso grava resultado `denied`
  em `tool_results`; com `requires_approval` notifica os masters
  (notificação `tool_call_pending_approval`) e devolve `pending_approval` sem
  executar; caso contrário devolve `approved`.
- `approveToolCall` (gateway.ts:127): marca `approved_by`/`approved_at` e
  devolve os dados da chamada. O Gateway NÃO executa a tool: quem pediu é
  quem executa depois da aprovação. Falha se já aprovada ou se não exigia
  aprovação.
- `listPendingToolCalls`: fila de aprovação (lida em `GET /tool-calls?pending=true`).
- `recordToolResult`: grava outcome (`completed` / `failed`) em `tool_results`.

### 3. Executors / clients concretos

- `clickup-client.ts` + `clickup-operation.ts`: operações ClickUp (tasks,
  comentários) com tratamento de erro tipado.
- `bento-qa-client.ts`: cliente HTTP do bento-qa (agente remoto fora do repo).
- `agent-ask-client.ts`: `askAgent`, chamada genérica a agente remoto com
  `AgentAskError` tipado.
- `webhook.ts`, `clickup-oauth.ts`, `attributed-task.ts`: integração e
  atribuição.

## Ferramentas dentro do Agent Loop (V2)

No caminho `AGENT_LOOP_V2`, o loop registra cada tentativa como
`ToolCallRecord` com `tool: 'agent:<nome>'` (ex: `agent:jarbas`), input
resumido (120 chars), ok, duration_ms e erro (`agentic-dispatch.ts:138`). Ou
seja: o agente remoto inteiro é UMA ferramenta do loop. O que ele fizer
internamente (tools próprias na máquina dele) é caixa-preta para o
Orchestrator e não aparece em `tool_calls`.

Não há hoje chamada de tool interna (ClickUp, meta_ads...) de dentro do loop:
o hook `act` só chama o agente remoto. Ferramentas internas como passos do
loop (com a fase WAITING_TOOL) são próximo passo.

## Tratamento de erro

- Gateway: negação não é exceção, é resultado (`denied` gravado em
  `tool_results` com o motivo). Aprovação pendente também é resultado, não erro.
- Loop: exceção do agente remoto dentro de `act` vira `ActResult` com
  `ok: false`, `recoverable: true` e a mensagem de erro: o loop observa,
  avalia e pode replanejar com `dispatch_reduzido` em vez de falhar de cara.
  `recoverable: false` (agente offline, permissão negada) encerra sem gastar
  iterações.
- `askAgent` lança `AgentAskError` tipado, tratado no execute-job.

## Autonomy policy

Não formalizada por níveis (a spec V2 descreve níveis de autonomia por classe
de ação; não implementado). O que existe na prática: a matriz `agent_tools`
com aprovação humana obrigatória para ações críticas (delete de task, escrita
em meta_ads, postagem em instagram), que funciona como uma política binária
(aprovado/negado) por par agente+tool.

## O que falta

- Descrições fortes de tools (contrato de entrada/saída legível por LLM para o agente escolher a tool certa): não implementado.
- Dynamic loading / registry de tools em runtime: não implementado (tools são código importado, não dados).
- Tools internas como passos do agent loop (fase WAITING_TOOL): não implementado.
- Visibilidade das tools que o agente remoto usou por dentro: não implementada (caixa-preta).
- Autonomy policy por níveis: não implementada.
