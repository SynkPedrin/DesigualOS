# BENTO — MELHORIA ESTRUTURAL (2026-09-14)

Missão: transformar o Bento de chatbot RAG em agente operacional. Restrição respeitada: Jarbas e Suzy read-only (regressão validada no fim). O cérebro remoto (bento-qa, máquina do Bento) NÃO foi alterado — todas as melhorias são na camada do Orquestrador, que controlamos e versionamos aqui.

## 1. O que estava errado (baseline reproduzido ao vivo, com evidência)

1. **Create-em-vez-de-update (crítico):** turno 1 "crie uma task pro Pedro", turno 2 "perfeito, atribua a task a ele" → o sistema criou uma task NOVA chamada literalmente "perfeito, a ele" (id real `86bc05yjn`, vista no ClickUp com a descrição "Pedido via Bento (chat interno): perfeito, atribua a task a ele"). Causa: o serviço remoto não separa CREATE de UPDATE, não resolve referentes e cria cegamente.
2. **"De qual cliente?" em escopo de pessoa:** "quantas tarefas estão atribuídas ao Pedro Gabriel?" → o remoto respondia "De qual cliente você quer saber as tasks do ClickUp?" (probe direto, 102ms). Perguntas por responsável e globais eram tratadas como ambíguas.
3. **Briefing como template vazio:** saída com "Identificação: Solicitante / Aprovador / ..." em vez de dados reais, e uma execução chegou a anexar a própria pergunta de esclarecimento como "briefing" na task.

## 2. O que foi alterado

| Arquivo | Mudança |
|---|---|
| `packages/context-engine/src/resolve-scope.ts` | Novo ScopeKind `PERSON` + detecção determinística de perguntas sobre pessoas ("atribuídas à X", "tasks do X", "o que a X precisa entregar") com confidence; interface `PersonMention` (name/memberIds/resolvedAs) |
| `packages/context-engine/src/build-operational-context.ts` | PERSON atravessa TODAS as listas autorizadas com filtro `assigneeIds` |
| `packages/tool-gateway/src/clickup-client.ts` | `findMemberByName` (match exato → primeiro nome → prefixo → contido; sem match único = null, nunca chuta) |
| `apps/api/src/lib/operational-context.ts` | PERSON: resolve o membro real antes de consultar; sem membro = falha honesta, nunca "de qual cliente?" |
| `apps/worker/src/processors/bento-action-guard.ts` (novo) | Guard de escrita na borda: classifica create/update(assignee/due/status); resolve referentes via histórico da conversa (última task por URL do ClickUp, última pessoa citada); executa com **read-after-write**; recibo de ação; briefing validado (rejeita pergunta-de-esclarecimento) com fallback determinístico de campos reais |
| `apps/worker/src/processors/execute-job.ts` | Guard ligado antes do dispatch, só para `agent === 'bento'`; quando trata, segue para persistência normal |
| `apps/worker/src/processors/bento-action-guard.test.ts` (novo) | 5 testes travando a classificação (inclui a frase exata do bug) |

Bug encontrado e corrigido durante a implementação: o regex `\b` depois de prefixo (`atribu\b`) nunca casa "atribua" (word char seguinte) — a primeira versão do guard deixava o bug passar; o teste E2E ao vivo pegou e o teste unitário trava para sempre.

## 3. Como o Bento pensa agora (fluxo real)

```
mensagem
↓
API: escopo (GLOBAL/CLIENT/MULTI/PERSON/AMBIGUOUS/NONE) + dados vivos do ClickUp
↓
worker: ACTION GUARD (só Bento)
  ├─ escrita com alvo resolvível → executa na borda → read-after-write → recibo
  ├─ escrita sem alvo → esclarecimento honesto (NUNCA cria lixo)
  └─ não-escrita → dispatch normal (loop V2: understand→context→act→evaluate)
↓
bento-qa (remoto, inalterado) com dados operacionais reais no contexto
```

## 4. Validação real no ClickUp (tudo confirmado via API do ClickUp, não pelo texto)

| Teste | Antes | Depois |
|---|---|---|
| "quantas tasks atribuídas ao Pedro Gabriel?" | "De qual cliente?" | **"4 tarefas atribuídas ao Pedro Gabriel, vêm do ClickUp"** (21.9s) |
| "briefing de todas as tasks da Jamile" | "De qual cliente?" | **5 tasks reais com status/prazo/prioridade/responsável** (38.3s) |
| "crie task pro Pedro + briefing anexado" | "Vou criar" (não criava) | **Task real: nome, Pedro Gabriel atribuído, prazo hoje, briefing anexado como comentário — tudo confirmado na API** (8.8s) |
| "perfeito, atribua a task a ele" | task fantasma "perfeito, a ele" | **UPDATE na task certa, assignee confirmado, ZERO criação** (9.3s) |
| briefing inválido do escritor remoto | comentário "De qual cliente?" na task | rejeitado + fallback determinístico com campos reais |

Limpeza: todas as tasks QA deletadas via fluxo de aprovação (confirmado na API).

## 5. Regressão Jarbas/Suzy

- Portão Jarbas: **5/5 verde** (`scripts/qa/jarbas-nao-regressao.ts`) após todas as mudanças.
- Jarbas ao vivo: resposta correta com dados Meta Ads (6.3s).
- Suzy ao vivo: resposta natural e completa (34.5s).

## 6. Performance

- PERSON scope: ack ~11-13s (resolução de membro + consulta ClickUp) — primeira vez que a resposta EXISTE.
- Action guard: 8.8-11s no create completo (determinístico, mais rápido que um turno de LLM remoto).
- Testes unitários: worker 37/37, context-engine/api/tool-gateway verdes.

## 7. Limitações restantes (honestas)

1. O cérebro remoto (bento-qa) continua com os vícios dele (interceptor "de qual cliente?", single-flight) — o guard cobre escrita e o escopo PERSON cobre leitura por pessoa, mas perguntas fora desses caminhos ainda dependem do serviço remoto.
2. Referentes são resolvidos pelo histórico recente da conversa (8 mensagens): "a anterior" de conversas longas pode não resolver.
3. Atribuição por chat executa direto (pedido explícito do usuário), sem passar pela fila de aprovação usada pela rota PATCH — distinção intencional (a aprovação existe para ações propostas pelo agente, não para ordem direta do usuário).
4. Escopo PERSON resolve UM membro por nome; ambiguidade (2 "Pedro") vira falha honesta pedindo confirmação.

## 8. Próximas melhorias úteis (não feitas)

1. Guard cobrir "desfaz a última alteração" (tem recibo com task_id nos metadados — a base já existe).
2. Attach do briefing como ARQUIVO além de comentário (uploadTaskAttachment já existe na API).
3. Sonda de ambiguidade de pessoas devolver os candidatos nomeados ("achei 2 Pedros: X e Y, qual deles?").
