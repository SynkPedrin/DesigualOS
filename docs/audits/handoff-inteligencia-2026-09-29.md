# Handoff — o que falta para o Bento entender a agência

29/09/2026. Escrito para quem está implementando (o outro chat). Diagnóstico completo em `docs/audits/inteligencia-2026-09-29.md`.

Tudo aqui foi **medido na stack viva**, não inferido. Os harnesses ficaram no repositório:

```bash
# barato, sem LLM: mede o que chega ao modelo por pergunta
pnpm --filter @desigual-os/worker exec tsx scripts/intelligence-benchmark-context.mts
# caro, ao vivo: 25 perguntas com golden set
node scripts/benchmark/intelligence-benchmark.mjs [IDs]
node scripts/benchmark/rescore.mjs      # SEMPRE depois: o /executions/:id devolve
                                        # `completed` antes de os steps existirem
```

**A stack foi reiniciada às 10:24** (supervisor repôs API e worker). O supervisor roda `tsx` **sem watch** de propósito (`infra/supervisor.sh:92`): mudança em `packages/` só vale depois de `kill` nos PIDs de `${TMPDIR}/desigualos-supervisor/{api,worker}.pid`. Sem isso você testa o Bento antigo.

---

## Já feito (não refazer)

Commitado em `d312007` e anteriores, ou no working tree:

| O quê | Onde | Prova |
|---|---|---|
| Briefing contava tarefa concluída como aberta (1222 vs 411) | `build-operational-context.ts` (`openTasks`) + `operational-context.ts:338` | GOLD agora diz "411 abertas, 146 atrasadas, 130 sem responsável" |
| "Faça um briefing" era recusado como escrita | `packages/bento-core/src/access-level.ts` (novo) + guard + core | Q20 era 51 chars `failed`, agora 2.667 chars, cobertura 3/3 |
| Portão de leitura era allowlist de palavras | `resolve-scope.ts` (`pedeCompreensaoDaOperacao`) | **9/21 → 21/21** perguntas consultam a operação |
| Briefing DESCARTAVA a listagem (75% do dado) | `chat/routes.ts` (briefing **+** listagem) | 29.920 chars voltaram ao prompt |
| Event store nunca era lido | `build-change-context.ts` (novo) + `operational-context.ts` | Q05 agora diz "138 tarefas: 105 novas e 33 alteradas" |

Testes: `bento-core` 102/102, `context-engine` 270/270, `api` 116/116, `worker` 1350/1350.

---

## FECHADO no fim do dia 29/09

| # | O quê | Commit | Prova |
|---|---|---|---|
| — | Briefing contava concluída como aberta | `7194802` | 1222 → 411, os dois blocos concordam |
| — | "Faça um briefing" recusado como escrita | `7194802` | Q20: 51 chars `failed` → 2.667, cobertura 3/3 |
| — | Portão léxico de leitura | `7194802` | **9/21 → 21/21** perguntas consultam a operação |
| — | Briefing descartava a listagem | `7194802` | 29.920 chars voltaram ao prompt |
| — | Event store nunca lido | `7194802` | "138 tarefas: 105 novas e 33 alteradas" |
| P0-1 | Latência / prazo de ack | (sessão paralela) | era N+1 (58 queries em série, 21.982ms), não o ClickUp. Turno caiu de 24-30s para 1,6-9,8s |
| P1-5 | Fixture de QA na carteira | `e4fa45d` | carteira 49 · internos 6 · fixtures 3 |
| P1-7 | Projetos internos como cliente | `e4fa45d` | "15 clientes da carteira mais 2 frentes internas" |
| P1-6 | Pessoa resolvida como cliente | `4d942a4` | "dependem do Endrigo" → PERSON; era o último com 0 tarefas |
| F-08 | Read-back reprovando escrita boa | `4d942a4` | início/seguidor/checklist, 13 casos novos |
| — | Roteamento sem `agent_hint` | `4d5f54f` + `fafb29a` | 32/32 |

## AINDA ABERTO, e por quê

| # | O quê | Por que não fiz |
|---|---|---|
| P0-2 | `AGENT_LOOP_V2` desligado — ContextPack, grounding e memória não chegam ao Bento | Mudança de arquitetura em caminho quente. Precisa de janela de release própria e de medição antes/depois, não de um commit no fim do dia |
| P0-3 | `retrieveHandler` não recupera nada (`agentic-dispatch.ts:896`) | Depende do P0-2: ligar o loop primeiro, medir, e só então fazer o passo buscar de verdade |
| P0-4 | Pessoa sem função; relação só `TASK_ASSIGNEE`; `last_seen_at` 13 dias atrasado | Falta decidir a FONTE. Derivar função de padrão de tarefa é inferência, e inferência virando fato é o defeito que C-15/C-16 documentam |
| — | Espelho local do ClickUp (`clickup_tasks` = 0 linhas) | O trabalho grande. Resolve latência, histórico, estrutura do workspace e os 6 clientes sem lista, de uma vez |
| — | Evento sem autor nem campo alterado | O webhook não grava. Sem isso, "quem mexeu?" continua sem resposta honesta |
| — | `updatesState` retornado e ignorado → zero sinal proativo | Consequência do anterior |
| — | Memória por `ILIKE` com teto de 6 a 12, sem embeddings | Precisa de decisão de infra (pgvector) |
| — | Cadastro duplicado: `Case #0` ×2, `Biofit`/`BIO FIT`, `Colpar`/`Colpar Brasil` | Limpeza de dado, não código. É decisão de quem é dono da carteira |
| — | `apps/mcp` sem teste; token inválido devolve 500 | O MCP inteiro está fora do deploy, declarado no commit `5b45152` |

---

## P0 — o que está quebrado AGORA

### 1. O prazo de ack de 25s derruba a consulta GLOBAL · REGRESSÃO INTRODUZIDA POR MIM

`apps/api/src/chat/routes.ts:113` — `CHAT_ACK_DEADLINE_MS ?? 25_000`.

A consulta GLOBAL (52 listas, 1.222 tarefas) leva **~40s medidos**. Ao abrir o portão de leitura, muito mais perguntas viram GLOBAL — e agora estouram o prazo.

Medido ao vivo, depois da mudança:

> **"Quem está sobrecarregado?"** → *"Não tenho como dizer quem está sobrecarregado. Não consegui consultar o ClickUp a tempo neste turno."*

Trocamos "sem dado, e mente" por "sem dado, e é honesto". Melhor, mas não é a resposta. **Abrir o portão sem resolver a latência entrega meia correção.**

Saídas, em ordem de preferência:
1. espelho local do ClickUp (resolve de vez: a consulta vira query local em ms);
2. prazo por escopo — GLOBAL merece 60s, CLIENT continua em 25s;
3. consulta em duas ondas: responde com o agregado e completa o detalhe.

### 2. `AGENT_LOOP_V2` continua ausente do `.env` — ContextPack e grounding não chegam ao Bento

`apps/worker/src/processors/execute-job.ts:109-131`. `parseAgentLoopFlag(undefined)` devolve `Set` vazio. Está morto em produção: plano, ContextPack (ordem por autoridade, piso por bloco), `groundClaims`, `checkCountConsistency`, bloco de cliente, campanha, pessoas, episódios, preferências, contexto cruzado.

Detalhe que muda a implementação: mesmo com a flag ligada, o Bento **não** recebe o ContextPack pela mensagem — `NODES_QUE_LEEM_CONTEXTO_NA_MENSAGEM` (`agentic-dispatch.ts:92`) tem `otto, jarbas, suzy, studio` e **não tem `bento`**, de propósito (contexto na mensagem sequestra a detecção de intenção dele). O caminho é o campo `operational_context`, via `limitarContexto([operationalContext, contextoApartado])` (`execute-job.ts:1701`). Confira que o pack chega por ali antes de declarar vitória.

### 3. `retrieveHandler` não recupera nada

`apps/worker/src/processors/agentic-dispatch.ts:896`:

```js
const retrieveHandler: StepHandler = async () => ({
  ok: true,
  observation: `contexto e memória prontos: ${state.evidence.length} evidência(s), ...`,
});
```

O passo descrito como *"recuperar estado operacional ao vivo (ClickUp) no escopo certo"* devolve uma string sobre o que a API já tinha buscado. Enquanto for assim, ligar o loop adiciona verificação, não investigação. Um `retrieve` de verdade olha a lacuna (`plan.knowledgeGaps`) e **busca de novo**.

### 4. Pessoa não tem função, e a relação só sabe "apareceu como responsável"

`packages/database/src/schema/knowledge-plane.ts`. `people` = 23 linhas, **sem campo de cargo**. `person_client_relations` = 289 linhas, **um único `relation_type`: `TASK_ASSIGNEE`** — `ACCOUNT_MANAGER`, `CLIENT_OWNER`, `CREATIVE_CONTRIBUTOR` estão no schema e nunca foram escritos.

Consequência medida: "Quem trabalha aqui e qual é a função de cada pessoa?" foi respondida certo **por acidente**, de fonte única `clientes/da-mata/cerebro.md` — o organograma estava escrito dentro do arquivo de um cliente. Não é reproduzível.

E `last_seen_at` mais recente de qualquer pessoa é **16/09** (13 dias). `knowledge-consolidation.ts` reconcilia campanhas e episódios; **não reconcilia pessoas**.

---

## P1 — erros concretos, correção pequena

### 5. Fixtures de QA entram no briefing executivo da agência

Dentro do escopo GLOBAL: **`teste` (28 tarefas), `Cliente Teste 7` (18), `Clinica Teste Fase 7` (6)** = 52 tarefas de teste. Medido ao vivo: a resposta a "o que mudou?" listou `QA CAMPOS 1790624559995` e `[QA FORENSE 2509] Reel aprovado` como entregas da agência.

Corrigir em `listAuthorizedClients` (`apps/api/src/lib/operational-context.ts:~62`), que já filtra `deletedAt`.

### 6. Pessoa é resolvida como cliente

"Quais tarefas dependem do Endrigo?" → escopo `CLIENT` = **"Endrigo Almada"** (linha na tabela `clients`), consulta a lista dele, vazia → *"Não tenho a lista de tarefas que dependem do Endrigo nos dados."* (63 chars)

Pessoa precisa ganhar precedência sobre cliente quando o nome bate nos dois. `detectPersonMention` já existe em `resolve-scope.ts`; hoje roda **depois** do match de cliente.

### 7. A agência, as pessoas e os projetos internos são linhas em `clients`

`Agência Desigual` (170 tarefas), `Endrigo Almada`, `André Almada`, `🔥 CITÁVEL™ — Enterprise`, `🧪 Case #0 — Endrigo Almada / CITÁVEL™` (**duas vezes**, variando só a caixa).

Efeito: os projetos internos que o Claude enumerou (Desigual OS, Citável, Cérebro da Agência, projetos do Endrigo) existem no ClickUp, são alcançáveis, e chegam ao modelo achatados como "um cliente chamado Agência Desigual".

### 8. Duplicatas no próprio registro, nunca reportadas

`Biofit` / `BIO FIT` · `Colpar` / `Colpar Brasil` · `Cosentino` / `🔥 Construtora e Imobiliária Cosentino Ltda. — Enterprise` · `Case #0` ×2.

O item 22 do baseline do Claude era "duplicações". O Desigual OS tem duplicatas **na tabela que ele mesmo envia ao modelo** e nunca as apontou — ninguém trata `clients` como objeto de análise.

### 9. `classifyActionIntentV2` lê uma ordem de escrita como análise

Medido: **"Reatribua todas para a Tammy."** → `intent=ANALYZE`, `writeAuthorized=false`, confiança 0.9.

Direção segura (a escrita não acontece), mas é o mesmo defeito de superfície: o verbo decide. O `access-level.ts` novo classifica essa frase como `WRITE` corretamente — vale reusar em vez de manter duas regras.

### 10. Escopo é lista, não entidade — 6 clientes são invisíveis

`FESTARA, Botini, Gelateria Fratelli, Home Center Tecaut, Sonhar Painéis, **John Deere**` não têm `clickup_list_id` e não existem para o sistema. John Deere é o exemplo de risco citado no próprio briefing da missão.

`clickup_tasks`, `clickup_spaces`, `clickup_lists`, `clickup_workspaces` estão no schema e têm **0 linhas**. Preenchê-las resolve isto, o P0-1 (latência) e o histórico, de uma vez.

---

## P2 — depois

11. **Evento não guarda autor nem campo alterado.** O payload do webhook tem só `entity_id`, `list_id`, tipo e hora (`operational_events`, 633 linhas, 0 com `actor`). Por isso o bloco de mudança declara que não sabe quem mexeu. Gravar o autor destrava "o que a Tammy mexeu hoje?".
12. **`updatesState` é retornado e ignorado.** `event-intelligence.ts` devolve `{updatesState: true, signal: null}` e `operational-events.ts` só olha `signal`. Resultado: 2.332 notificações, **2.195 são "o Bento respondeu"**, zero sinal proativo de risco. Nunca nasceu um.
13. **Memória é `ILIKE` com teto de 6 a 12.** Sem embeddings (`memory-engine.ts:27` declara). `agent_episodes` = 31 linhas para toda a história da agência, 15 delas em `qa`.
14. **A2A morreu.** `agent_messages` = 6 linhas, todas de 16-17/09.

---

## Como saber se melhorou

Não pergunte "ficou melhor". Rode:

```bash
pnpm --filter @desigual-os/worker exec tsx scripts/intelligence-benchmark-context.mts
```

**Linha de base de hoje, depois das correções já feitas: 21/21 perguntas operacionais** (eram 9/21). Se cair, houve regressão.

E ao vivo, os quatro que ainda falham:

| ID | Pergunta | Estado agora |
|---|---|---|
| Q08 | Quem está sobrecarregado? | "não consegui consultar a tempo" (P0-1) |
| Q09 | Quais tarefas dependem do Endrigo? | 63 chars, Endrigo virou cliente (P1-6) |
| Q02 | Quem trabalha aqui e qual a função? | certo por acidente, de `da-mata/cerebro.md` (P0-4) |
| Q05 | O que mudou nos últimos 7 dias? | **evento chega**, mas a lista traz fixture de QA (P1-5) |
