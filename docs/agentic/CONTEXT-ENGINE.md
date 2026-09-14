# Context Engine

Status: PRÉ-EXISTENTE, reusado pela V2. Não foi construído um Context Engine V2 novo.
Código: `packages/context-engine/`

## Decisão

A V2 avaliou o Context Engine existente e decidiu reusá-lo: ele já resolve os
problemas certos (entidade, escopo, contexto mínimo por execução) e já era
testado (build-context.test.ts, resolve-client.test.ts, resolve-scope.test.ts,
resolve-temporal.test.ts, briefing-engine.test.ts). O que a V2 adicionou foi o
`gatherContext` do agent loop, que complementa esse contexto com memória de
episódios e preferências do usuário no momento da execução.

## Como o contexto é montado hoje

O contexto de uma execução de chat é montado em dois momentos e dois processos:

### 1. Na API, antes do enqueue (`apps/api/src/chat/routes.ts`)

- Router decide o agente.
- `resolveClientFromText` / `resolveClientsFromText`
  (`packages/context-engine/src/resolve-client.ts`): entity resolution de
  clientes a partir do texto, com matches vindos do banco (nunca de lista no
  código).
- `resolveOperationalScope` (`packages/context-engine/src/resolve-scope.ts`):
  decide se a pergunta é GLOBAL, CLIENT, MULTI_CLIENT, AMBIGUOUS ou NONE, com
  entidades já resolvidas, janela temporal (resolve-temporal.ts), flags de
  comparativo/briefing e um `confidence` que permite escalar para um planner com
  LLM quando baixo (camada 2 da arquitetura em duas camadas, hoje não
  implementada: a camada 1 é determinística e é a única que roda).
- `buildContext` (`packages/context-engine/src/build-context.ts:65`): monta o
  contexto mínimo por execução, sem sair do Orchestrator:
  - usuário (nome), cliente (nome, tone of voice);
  - dossiê do cliente (memória kind `client.profile` mais recente, até 3000 chars);
  - arquivos de texto do projeto da conversa (até 5 arquivos, 2000 chars cada);
  - últimas 5 mensagens da conversa (nunca a conversa inteira);
  - até 3 aprendizados recentes do agente que vai responder (memories gravadas
    por `recordLearning`, até 300 chars cada).
  As buscas rodam em paralelo (`Promise.all`) e cada uma tem `.catch` próprio:
  uma falha parcial não derruba o contexto mínimo.
- Os blocos são anexados à mensagem após o separador `"\n\n---\n"` (detalhe
  operacional importante: é esse separador que a estratégia `dispatch_reduzido`
  do loop corta na segunda tentativa).
- briefing-engine (`packages/context-engine/src/briefing-engine.ts`): monta
  briefing operacional estruturado quando o escopo pede briefing.

### 2. No worker, dentro do loop (`agentic-dispatch.ts` hook `gatherContext`)

Rodando na fase GATHERING_CONTEXT, em paralelo:

- `recallMemories({ clientId, agentId, kinds: ['agent.episode'], limit: 3 })`:
  episódios de execuções passadas do mesmo agente (experience replay): objetivo,
  estratégia vencedora, tentativas, score.
- `recallMemories({ userId, kinds: ['user.preference'], limit: 5 })`:
  preferências do usuário, quando há userId. Escopo por usuário é novo na V2.

Ambas com `.catch`: memória é enriquecimento, nunca motivo para derrubar a
execução.

## Orçamento de contexto

Limites reais no código hoje (build-context.ts):

| Item | Limite |
|---|---|
| Mensagens recentes | 5 |
| Dossiê do cliente | 3000 chars |
| Arquivos do projeto | 5 arquivos, 2000 chars cada |
| Aprendizados recentes | 3 itens, 300 chars cada |
| Episódios (gatherContext) | 3 |
| Preferências de usuário (gatherContext) | 5 |

Não existe um orçamento de tokens formal por execução (contagem real contra o
limite do modelo): os tetos acima são por item, em chars, escolhidos por medição.
Orçamento tokenizado com priorização é próximo passo.

## O que falta (spec V2 vs realidade)

- Camada 2 do resolve-scope (planner com LLM quando confidence baixa): não implementada.
- Semantic search por embedding no contexto: não implementada. O recall é por
  escopo + kind + subject + ordenação por importância/recência. A busca vetorial
  de verdade vive fora do repo, no bento-qa.
- Compressão/sumário de conversas longas: não implementada (o corte é fixo em 5 mensagens).
- Orçamento de contexto tokenizado e adaptativo por classe de tarefa: não implementado.
