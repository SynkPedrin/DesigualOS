# DESIGUAL OS — FORENSIC AUDIT REPORT

Data: 25/09/2026  
Escopo: Bento, Otto, execução operacional, ClickUp, contexto, memória, modelos e infraestrutura. Jarbas não foi alterado.

## Executive Summary

O sistema possui uma fundação real de segurança e um caminho real de escrita no ClickUp, mas ainda não possui comportamento certificado de agente operacional. A execução QA provou que Bento alcança o ClickUp, resolve um usuário real, persiste briefing e faz read-back. Também provou um defeito P0: um pedido singular gerou quatro tasks, embora a resposta declarasse sucesso. A continuidade multi-turn não está confiável: update, comentário e leitura da task criada não recuperaram o alvo conversacional. A resposta usa `sources: []` mesmo quando afirma ter consultado o ClickUp, reduzindo auditabilidade. Otto possui pipeline criativo e modelo local, mas não foi certificado ponta a ponta com campanha real, melhoria após feedback e task criativa verificada. Não há `OPENAI_API_KEY`, portanto nenhum A/B OpenAI foi medido. O serviço está saudável, mas não expõe `/ready`; o health global fica 80% porque Studio está offline, fora do escopo desta liberação. Conclusão: `NOT READY FOR TAMMY`.

## Evidência e limites

### Comprovado

- ClickUp real: Bento criou quatro tasks QA, com usuário Pedro Gabriel, briefing e verificação de cada task.
- RBAC/tenant: o runtime carregou organização, ator e permissão antes da escrita.
- Negação explícita: pedidos “apenas analise” não mutaram ClickUp.
- Responsável inexistente: não houve confirmação positiva nem assignment inválido.
- Typecheck/test/build anteriores da base: verdes conforme estado entregue; targeted worker tests passaram após a integração.

### Não comprovado ou bloqueado

- Idempotência real após timeout pós-criação: não medida.
- Otto E2E real, handoff, campanha recuperada e task criativa: não medida.
- A/B com OpenAI: bloqueado por ausência de `OPENAI_API_KEY`.
- Comparação estatística de qualidade/latência entre modelos: não medida.
- Segurança negativa de Jarbas/Suzy contra API real: não medida; a matriz de seed, porém, contém `clickup:write` para ambos.

## Arquitetura atual observada

O caminho efetivamente observado é:

`API chat → execution/queue → worker execute-job → bento-action-guard → write-target/multi-create-executor → createVerifiedSeniorTask → ClickUp → getTask/read-back → resposta`.

O Tool Gateway registra e autoriza operações, mas a execução ClickUp observada está concentrada no worker. O dispatch agêntico genérico registra `clickup.write` como “não executada por este caminho”; portanto não existe ainda um executor universal de tools para todo loop. `AGENT_LOOP_BENTO_V2` e `AGENT_LOOP_OTTO_V2` permanecem desligadas.

## Benchmark QA executado

Arquivo bruto: [`runtime-benchmark.json`](/Users/pedro/DesigualOS/artifacts/forensic-2026-09-25/runtime-benchmark.json)

| Caso | Resultado | Evidência |
|---|---|---|
| B01 create singular | FAIL | 1 pedido → 4 tasks reais; `action_plan_count: 4` |
| B02 análise sem mutação | PASS | `negated_no_dispatch`, zero mutações |
| B03 update briefing | FAIL/BLOCKED | execução sem step/output verificável |
| B04 comentário | FAIL | não reconheceu task conversacional |
| B05 prazo | FAIL | não resolveu alvo recém-criado |
| B06 leitura responsável/prazo | FAIL | tratou como escrita não autorizada |
| B07 responsável inválido | PASS parcial | não confirmou criação; informou membro inexistente |
| B08 cliente inválido | PASS | bloqueou sem cliente/lista resolvida |
| B09 briefing sem task | PASS | zero mutação |
| B10 task aprovada | NOT MEASURED | execução terminou sem output persistido no trace |
| B11 análise operacional | PASS de não-mutação בלבד | qualidade semântica não certificada |
| B12 leitura existente | PASS de não-mutação בלבד | resposta não demonstrou leitura de fonte |

## Top 10 problemas

### P0-01 — Decomposição indevida de task

Componente: Bento action guard / multi-create. Arquivos: `apps/worker/src/processors/bento-action-guard.ts`, `multi-create-executor.ts`. Sintoma: B01 criou quatro tasks para um pedido singular. Evidência: quatro IDs reais, `split_requested: false`, `action_plan_count: 4`. Causa: parser transforma cada cláusula do briefing em ação. Impacto: duplicação operacional e perda de confiança. Correção: uma intenção singular deve produzir exatamente uma mutation; checklist/atributos ficam no briefing. Teste: B01 deve retornar um único `resourceId`.

### P0-02 — Continuidade não resolve o alvo recém-criado

Componente: memória conversacional e resolução de referência. B04–B06 não encontraram a task criada na mesma conversa. Causa: artifact/último resultado não é uma memória operacional persistente nem é usado por todos os intents de update/read. Impacto: Tammy precisa repetir nome/link. Correção: guardar `resourceId`, lista, cliente, assignee e dueDate como estado estruturado por conversa; resolver “essa task” primeiro por esse estado. Teste: create → comment → due → read.

### P0-03 — Confirmação de sucesso não está uniforme

Componente: runtime response. B01 declarou sucesso corretamente para as quatro tasks, mas o pedido original não foi preservado como cardinalidade. B03 terminou sem resultado estruturado. Causa: paths de execução diferentes retornam formatos diferentes. Correção: todo write deve retornar `success`, `verified`, `resourceId(s)`, `error`, `retryable`; ausência de resultado deve ser falha explícita.

### P1-01 — Fontes não aparecem na resposta estruturada

O B01 afirmou read-back real, mas `sources: []`. Causa: grounding não é propagado do executor para o response envelope. Impacto: auditoria impossível. Correção: emitir `CLICKUP_TASK` e IDs consultados sem expor detalhes internos ao usuário.

### P1-02 — Update/comment ainda não estão no mesmo write path

B04 não reconheceu comentário; B05 não resolveu prazo. O create está mais maduro que update/comment/read contextual. Correção: unificar operações em executor verificado por recurso, com read-after-write por operação.

### P1-03 — Otto não certificado como agente operacional

Há pipeline criativo e prompt de diretor, mas não há evidência desta etapa de campanha real → output específico → feedback → task criativa real. A integração experimental passa por guard nomeado Bento e pode produzir task operacional sem preservar artefato criativo. Correção: pipeline Otto próprio, com `approvedArtifact` estruturado e executor compartilhado somente na mutation.

### P1-04 — Permissões seed concedem ClickUp write a Jarbas e Suzy

`packages/database/src/seed.ts` contém `clickup:write` para ambos. Mesmo que seus runtimes não escrevam hoje, a matriz contradiz o escopo declarado. Correção: migration/RBAC deny explícito e teste negativo; não executado nesta auditoria por instrução de não alterar Jarbas.

### P1-05 — Idempotência pós-timeout não provada

Existe chave de idempotência no executor, porém não houve teste que perdesse a resposta após criação e repetisse a requisição. Correção: fault injection depois do POST e assert de exatamente um task.

### P1-06 — Readiness operacional ausente

`GET /health` responde OK; `GET /ready` retorna route not found. Correção: readiness separado de liveness, incluindo DB, fila, ClickUp credential e worker heartbeat.

### P2-01 — Markdown literal em descrição ClickUp

O read-back confirmou marcadores `#`/`##` armazenados literalmente na descrição. Isso pode ser aceitável como texto, mas não é briefing visualmente formatado no ClickUp. Correção: converter para formato suportado ou usar campos/checklist/documento.

### P2-02 — Observabilidade de modelo insuficiente

Execuções registram custo estimado, mas benchmark mostrou `tokens_input/output: 0` em vários casos e não há fonte/modelo/latência de tool no envelope final. Correção: métricas por provider, modelo, prompt version, tool call, retry e source.

## Bento — diagnóstico profundo

Bento tem boas proteções determinísticas: contexto tenant, RBAC, resolução de usuário, escopo de lista, mutation budget, create/read-back/verify e bloqueio de nomes inválidos. O problema principal não é “falta de inteligência” isolada. É a combinação: intenção singular mal normalizada, memória conversacional incompleta, múltiplos paths de execução e grounding não propagado.

Ponderação causal do comportamento “burro” observado: 35% contexto/memória, 25% planner/parser de ação, 20% integração/tool runtime, 10% contrato de resposta/observabilidade, 10% modelo/prompt. A pontuação de modelo é uma estimativa de causa, não uma medição A/B; OpenAI não estava disponível.

## Otto

O código contém prompt criativo, provider Ollama e `otto-motion`, mas a certificação exigida — campanha correta, copy específica, crítica “ficou genérico”, continuidade e task com artefato aprovado — não foi executada nesta rodada. A evidência anterior disponível mostra output criativo genérico e uso de números não comprovados. Portanto Otto é `NOT CERTIFIED`, não “falho” por uma execução que não foi medida.

## Ollama e infraestrutura

O runtime usa caminhos diferentes: worker usa gateway na porta 11500 e `qwen2.5:14b` como default de texto; Bento remoto inicia `qwen3.6:35b-a3b` via gateway GPU; Otto possui default local `http://localhost:11434`; router usa `ministral-3:3b`. Essa fragmentação torna resultados não reprodutíveis sem registrar provider/modelo/context window.

Bento remoto tem 8 GB RAM e depende do gateway GPU; o gateway local possui controle de admissão e timeout. A infraestrutura respondeu, mas o modelo efetivamente carregado no gateway usado por Bento não foi demonstrado por uma consulta única e auditável. Health global: 80%, Studio offline; Studio está fora do escopo desta RC. Worker estava online. Não há `/ready`.

## OpenAI — substituir o modelo resolve?

Resposta: `MELHORA`, mas `NÃO RESOLVE` os P0. Um modelo melhor pode melhorar classificação, briefing e crítica; não corrige cardinalidade, memória de recurso, executor fragmentado, permissões ou idempotência. Pode piorar custo, latência, vazamento de contexto e comportamento de tool se o contrato não for estruturado.

Recomendação de avaliação, não migração imediata: modelo econômico para classificação/triagem; modelo intermediário para Bento normal; modelo mais capaz para Otto criativo difícil, falhas/retries e planejamento. A API Responses é apropriada para tool calling e turnos multi-turn; Function Calling deve executar tools e Structured Outputs deve validar envelopes, conforme documentação oficial [model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6), [function calling](https://developers.openai.com/api/docs/guides/function-calling) e [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Sem credencial, custo, latência e qualidade não foram medidos.

## Prompt, contexto e memória

Prompts têm regras úteis de não inventar e fechamento, mas regras textuais não substituem estado estruturado. O contexto operacional é carregado por cliente/org em alguns paths; o estado da conversa preserva apenas parte do último artefato. Falta uma camada única que diferencie `CONVERSATION`, `CLICKUP_TASK`, `CLIENT_PROFILE`, `CLICKUP_COMMENT` e `MEMORY` e vincule cada afirmação a uma fonte.

## Agent loop e tools

O loop observe/plan/act existe no código, mas as flags V2 estão desligadas e o dispatch genérico não executa `clickup.write`. Bento usa guard determinístico. A primitive `createVerifiedSeniorTask` está conectada ao caminho Bento observado e passou no create real QA. Otto não tem prova equivalente. O Tool Gateway autoriza/telemetra, mas não é ainda o único executor físico.

## Scores

| Categoria | Score | Estado |
|---|---:|---|
| Segurança/tenant | 78/100 | boa fundação; negative matrix incompleta |
| ClickUp create real | 70/100 | real e verificado, mas cardinalidade falha |
| Update/comment/read | 25/100 | continuidade não comprovada |
| Briefing Bento | 55/100 | um caso anterior fraco, B01 estruturado mas dividido |
| Qualidade operacional Bento | 35/100 | respostas não demonstram fontes/contexto |
| Otto creative | 25/100 | não certificado nesta rodada |
| Memória/contexto | 30/100 | referência “essa task” falha |
| Idempotência | 20/100 | não medida |
| Observabilidade | 35/100 | envelope sem fontes/modelo consistente |
| Infra/runtime | 65/100 | worker/API online; readiness e Studio pendentes |

Readiness operacional ponderada: **42/100 — NOT READY FOR TAMMY**.

## P0 blockers

1. Corrigir cardinalidade: pedido singular = uma task.
2. Persistir e resolver recurso conversacional entre create/update/comment/read.
3. Provar idempotência com timeout pós-criação.
4. Certificar Otto E2E com campanha, feedback e task real.
5. Fechar a matriz de permissões negativa para agentes não autorizados.

## P1 essenciais

Unificar create/update/comment/read em executor verificado; propagar sources e modelo; adicionar `/ready`; tornar Otto executor separado; armazenar artifact aprovado; garantir que falha parcial nunca produza “tudo pronto”.

## P2 melhorias

Renderização estruturada de briefing no ClickUp, benchmark automatizado com critérios semânticos, warm-up/telemetria do gateway, comparação de modelos com mesma suíte e dashboard de regressão.

## Plano de implementação

1. Corrigir B01 e criar teste de cardinalidade.
2. Introduzir `ConversationResourceState` por conversa, com resource IDs e última operação verificada.
3. Implementar update/comment/due/read usando o mesmo estado e read-back.
4. Executar fault injection de retry e validar uma task.
5. Separar Otto creative artifact do write executor e executar T08–T13.
6. Corrigir/denegar permissões não autorizadas, sem modificar comportamento de Jarbas fora da mudança RBAC aprovada.
7. Adicionar readiness, sources e métricas de provider/modelo.
8. Reexecutar todos os gates; somente então habilitar flags para Tammy.

## Go / No-Go mensurável

Go somente com 100% dos casos críticos: B01 uma task, create/update/comment/due/read verificados, zero mutation em negativas, retry com exatamente uma task, Otto T08–T13 aprovados, `sources` presentes, tenant preservado, health/readiness verde e regressão typecheck/test/build verde. O estado atual não satisfaz esses critérios.

## Gate final

**NOT READY FOR TAMMY**

Motivo objetivo: o primeiro create real comprovado ainda duplica uma solicitação singular e a conversa não consegue operar sobre a task recém-criada por referência natural. Isso viola os critérios centrais de qualidade, contexto correto e confiança operacional.
