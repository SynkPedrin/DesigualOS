# Memory Engine

Status: PRÉ-EXISTENTE (packages/orchestrator/src/memory-engine.ts), ativado de fato na V2.
Antes da V2 o engine existia testado mas quase sem chamadores; `recordLearning`
gravava com INSERT cru, sem dedup nem supersessão.

Código: `packages/orchestrator/src/memory-engine.ts` (rememberFact, recallMemories,
expireStaleMemories), tabela `memories` (packages/database/src/schema/knowledge.ts).

## Modelo de dados real (tabela memories)

Campos: `kind` (string livre, namespace por prefixo), `content`, `clientId`,
`agentId`, `userId`, `sourceType`, `sourceId`, `confidence` (0..1),
`importance` (0..1), `status` (`active` / `superseded` / `expired` / `rejected`),
`supersededBy`, `supersededAt`, `lastVerifiedAt`, `expiresAt`, `dedupeKey`,
`metadata` (jsonb; o `subject` mora aqui dentro).

## Camadas M0-M10: mapeamento do que existe

| Camada | Significado na spec | Existe? | Como |
|---|---|---|---|
| M0 | Identidade do agente (quem ele é) | Parcial | System prompts nos agentes remotos (fora do repo) + `goalFor`/`successCriteriaFor` por agente em agentic-profiles.ts |
| M1 | Dados operacionais (tasks, prazos) | Sim | Tabelas sincronizadas do ClickUp; contexto via buildContext |
| M2 | User memory (preferências do usuário) | Sim (novo na V2) | `memories.userId` + kinds `user.preference`; escopo adicionado ao `recallMemories` |
| M3 | Memória de cliente (dossiê) | Sim | kind `client.profile`, lido pelo buildContext (até 3000 chars) |
| M4 | Episódios de execução | Sim (novo na V2) | kind `agent.episode`, gravado ao completar (subject `episode:<agente>:<goal>`), lido no gatherContext |
| M5 | Aprendizados de evento | Sim | kinds `studio.*`, `clickup.*`, `client.*`, `execution.completed` via recordLearning |
| M6 | Funil de confiança (Otto) | Sim | kinds `otto.*` com estágio observation→core em metadata (pipeline.ts) |
| M7 | Memória semântica (embedding) | Não implementado | Recall é por escopo + importância + recência; vetorial só no bento-qa (fora do repo) |
| M8 | Consolidação automática (resumo de memórias) | Não implementado | Próximo passo |
| M9 | Esquecimento / expiração | Sim | `expiresAt` + `expireStaleMemories()` (status vira `expired`, não apaga) |
| M10 | Proveniência e auditoria | Sim | `sourceType`, `sourceId`, `confidence`, cadeia `supersededBy` preserva histórico |

## Escrita: rememberFact (pipeline de 4 passos)

`rememberFact` (memory-engine.ts:156). NUNCA lança: memória é efeito colateral,
não pode derrubar o turno do usuário. Retorna um `RememberOutcome`
(`written` / `reconfirmed` / `superseded` / `skipped` com motivo).

1. Relevância (`relevanceRejection`): descarta conteúdo vazio, confirmação
   social ("beleza, obrigado", "ok", saudações) e texto com menos de 25 chars.
   Confirmação social não carrega fato operacional.
2. Dedup (`computeDedupeKey`): sha256 de `kind | clientId | agentId |
   conteúdo normalizado` (sem acento, minúsculo, sem pontuação).
   Deliberadamente SEM o subject na chave: dedup olha conteúdo idêntico;
   supersessão olha mesmo subject com conteúdo diferente. Fato idêntico já
   existente é reconfirmado: `lastVerifiedAt` atualizado e confiança +0.02
   (teto 0.99) apenas quando a fonte é OUTRA (mesma pessoa repetindo a mesma
   frase não é evidência nova).
3. Supersessão por subject: fato novo sobre o MESMO `subject` (ex:
   `cliente:3net:responsavel`) aposenta o anterior: o antigo vira
   `status='superseded'` com `supersededBy` apontando para o novo. Histórico
   auditável preservado; nada é apagado. Sem subject, o fato é aditivo (nunca
   aposenta ninguém), que é o caso correto para eventos que devem se acumular
   (cada asset gerado, cada feedback).
4. Gravação: confidence default por origem (`DEFAULT_CONFIDENCE`): manual 0.95,
   clickup_comment 0.9, chat_message/whatsapp 0.85, clickup_task/vault 0.8,
   system 0.7, agent 0.5. Evidência humana direta vale mais que inferência de
   agente.

Limite declarado no código: não detecta contradição SEMÂNTICA entre textos
livres (exigiria LLM por escrita). A supersessão é determinística por subject
declarado por quem escreve.

## Leitura: recallMemories

`recallMemories` (memory-engine.ts:285). Retorna SÓ fato `active` e não expirado
(`expires_at > now()` ou nulo). Filtros opcionais: clientId, agentId, userId
(novo na V2), kinds, minImportance, limit (default 10). Ordenação:
`importance DESC`, depois `updated_at DESC`. Não há busca por similaridade.

O filtro de status/expiração é o que garante que fato aposentado nunca mais
volta para o prompt, que era o defeito original: memória velha ganhando de dado
novo por ordenação aleatória.

## Escopo e isolamento

Três escopos independentes e cumulativos, testados ao vivo
(`apps/worker/scripts/qa-memory-test.mts`):

- clientId: memória do cliente A não aparece no recall do cliente B (CRÍTICO).
- userId: preferência do user A não aparece no recall do user B (novo na V2).
- agentId: memórias de um agente não poluem o recall de outro (o dispatch
  resolve o uuid do agente na tabela `agents`, não usa o nome).

## Manutenção

`expireStaleMemories()`: marca `expired` o que passou de `expires_at`. Não
apaga: fato expirado continua auditável, só sai da recuperação.

## O que falta

- Semantic search por embedding: não implementada (sem pgvector no repo).
- Consolidação automática (fundir memórias redundantes em resumos): não implementada.
- Detecção de contradição semântica: não implementada (por decisão de custo, ver nota no topo de memory-engine.ts).
- Decaimento de importância por idade: não implementado (hoje importância é fixa na escrita).
