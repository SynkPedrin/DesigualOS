# Jarbas Senior Intelligence — handoff e limite externo

Auditoria de 24/09/2026, branch `jarbas-senior-v1` (baseada em
`jarbas-senior-intelligence`, que por sua vez é baseada em
`worktree-bento-jarbas-senior-hardening` — hardening de autorização do
Bento ainda não mergeado em `main`).

**Atualização desta rodada (mesma data):** a missão anterior tinha só o
contrato de tipos e o verificador numérico. Esta rodada constrói o
MECANISMO de handoff Bento↔Jarbas de verdade — dispatch idempotente,
máquina de estado, árvore de diagnóstico determinística, detecção de
intenção de handoff/status/mutação-proibida — tudo 100% offline, testado,
e deliberadamente NÃO conectado ao caminho de produção. A seção 8
(nova) explica exatamente por quê.

Este documento existe porque a missão que motivou esta branch pediu uma
arquitetura de "inteligência sênior" pro Jarbas — visão macro da agência,
fatos de métrica rastreáveis, árvore de hipóteses, memória de decisão,
tarefas atribuídas pelo Bento — e explicitamente proibiu fingir que ela
existe quando não existe. Ela não existe. Este documento é o mapa exato do
que é real hoje, o que foi construído nesta branch (contrato + verificador,
sem dado real pra alimentar), e o que falta pra fechar a distância.

## 1. O que o Jarbas é, de verdade, hoje

O prompt de sistema do Jarbas (`docs/agent-prompts/jarbas.md`, escrito por
Endrigo) já descreve a ambição inteira: gestor de tráfego sênior, media
buyer, growth strategist. Esse texto não vive neste repositório — vive no
código-fonte do serviço externo `agentes-desigual` (a mesma máquina que
serve `JARBAS_ASK_URL`). O que ESTE repositório controla é só o envelope em
volta dessa conversa:

```
apps/worker/src/processors/execute-job.ts (callAgentesDesigual)
        ↓
packages/tool-gateway/src/agent-ask-client.ts (askAgent)
        ↓
POST {JARBAS_ASK_URL}/internal/ask
  body: { agent: 'jarbas', text: string, sessionId: string }
        ↓
resposta: { ok?: boolean, agent?: string, answer?: string, error?: string }
```

Três campos na ida, quatro na volta. `answer` é a única coisa que carrega
informação — texto livre, sem número estruturado, sem trace de ferramenta,
sem proveniência. `askAgent()` devolve só `Promise<string>` (o `answer`
já validado e aparado). Timeout de 180s (`AGENT_TIMEOUT_MS.jarbas`),
1 tentativa só — de propósito, porque um retry automático pode reenviar
efeito colateral já causado do outro lado (comentário em `queues.ts`).

Duas camadas de defesa já existem em cima disso, construídas por incidentes
reais, não por este esforço:

- `looksLikeInternalLeak` — descarta resposta que é na verdade um erro
  interno do susy-service disfarçado de `ok:true` (achado 05/09/2026).
- `stripInternalHandoffDirectives` — remove diretivas internas que às
  vezes vazam na resposta (achado 11-13/09/2026).

Nenhuma das duas adiciona estrutura — as duas só limpam ruído de um texto
livre que continua sendo, depois de limpo, só texto livre.

**`jarbas-date-guard.ts`** (`apps/worker/src/processors/`) é a única
verificação numérica real que existe hoje, e verifica só UMA coisa: se o
período que a resposta se autodeclara ("CARTEIRA, 2026-09-01 a 2026-09-30,
fonte: Meta Ads") bate com o período que o usuário pediu. Não verifica os
valores. Continua intacto — não foi expandido nesta branch, porque não
havia nada novo e justificado pra guardar.

## 2. O que NÃO existe, verificado por busca exaustiva

- **Nenhum mecanismo de Bento atribuir trabalho ao Jarbas.** Nenhuma
  tabela, coluna, fila ou rota carrega um "AgentTask" — a única forma de
  Jarbas ser acionado é um turno de chat humano roteado pela API. O único
  handoff agente-a-agente real do sistema é Otto → Studio
  (`handoffOttoProductionSpec`), não Bento → Jarbas.
- **Nenhuma memória gravada pelo Jarbas.** `memory-engine.ts`
  (`packages/orchestrator`) é agnóstico de agente — aceita `agentId`
  qualquer, sem branch nenhum pro Jarbas — mas nenhum call site no caminho
  de resposta do Jarbas (`callAgentesDesigual`) jamais chama
  `rememberFact()`. O lado de LEITURA existe (o contexto é buscado
  filtrado por agente antes do turno), o lado de ESCRITA não.
- **Nenhum campo de métrica estruturada no protocolo interno.** O tipo
  `ExecuteResponse` (`@desigual-os/node-protocol`) já tem `sources`,
  `tool_calls` e `metadata: Record<string, unknown>` como campos opcionais
  — cabe estrutura nova sem quebrar compatibilidade — mas
  `callAgentesDesigual` sempre preenche `sources: []`, `tool_calls: []`, e só
  usa `metadata` pro caso de aprovação pendente (`[AGUARDA_APROVACAO]`),
  nunca pra métrica.

## 3. O que esta branch construiu (contrato + verificador, sem dado real)

Dado que popular qualquer uma dessas estruturas com dado FALSO seria
exatamente o "no fake success" que a missão inteira existe pra evitar, esta
branch construiu só o que é honesto construir sem dado real:

- **`packages/types/src/jarbas-analysis.ts`** — os tipos `MetricFact`,
  `MetricComparison`, `JarbasAnalysisResult`, `AgentTask` (e os enums de
  apoio: `MetaEntityType`, `MetricAvailability`, `ClaimKind`,
  `AgentTaskStatus`). Compilam, são exportados, `JarbasAnalysisResult` tem
  `provenanceAvailable: boolean` explícito — nenhum código deste
  repositório pode popular `metricFacts`/`comparisons` sem que esse campo
  seja `true` de verdade. `AgentTask` é só o FORMATO de uma tarefa
  atribuída; construir o mecanismo que persiste/despacha isso (tabela,
  fila, lifecycle) é trabalho de produto novo — não está nesta branch, por
  ser expansão de escopo, não hardening.
- **`packages/agent-runtime/src/metric-verifier.ts`** — aritmética de
  métrica em código puro, testável hoje mesmo sem dado real: variação
  percentual relativa vs pontos percentuais (nunca confundir 10%→12% como
  "+20%" com "+2pp" — os dois são respostas corretas pra perguntas
  diferentes), verificação de taxa (CTR/conversão) contra numerador e
  denominador, denominador inválido sempre falha fechado (nunca inventa um
  número), classificação de disponibilidade (`available`/`null`/`missing`/
  `not_tracked`/`delayed` — nunca vira 0 por omissão), e um sinalizador de
  amostra pequena (heurístico, não calibrado contra dado de produção real
  porque nenhum existe localmente). 19 testes, fixtures sintéticas (CPL
  40→52, CTR 10%→12%, zero impressões, atribuição atrasada, 3 leads/R$20).
- **`packages/agent-runtime/src/grounding.ts` (`groundClaims`) — já
  existia, reutilizável, não modificado.** Mecanismo de bloqueio de
  alegação-sem-evidência já é agnóstico de agente/domínio (recebe texto
  livre + `EvidenceRef[]` arbitrário). Pronto pra métrica de Meta Ads no
  dia em que existir `EvidenceRef[]` real pra passar — hoje só é chamado no
  caminho operacional do Bento/Otto (contagem de tasks), nunca no caminho
  do Jarbas, porque o caminho do Jarbas não tem evidência estruturada
  nenhuma pra passar.

## 4. Exatamente o que falta — o bloqueio externo, sem eufemismo

Pra qualquer parte do pipeline analítico prometido (visão macro, resolução
de conta/campanha/adset real, detecção de anomalia sobre dado real,
comparação de período sobre dado real) virar verdade, é preciso UMA das
duas:

1. **O serviço externo `agentes-desigual` passa a devolver estrutura**, não
   só `answer: string` — no mínimo um `metricFacts[]` (ou equivalente) no
   corpo da resposta de `/internal/ask`, com proveniência (fonte, período,
   entidade, timestamp de coleta) por valor. Sem isso, este repositório
   nunca terá como provar um número do Jarbas — só pode provar que o
   PERÍODO citado bate (o que o date-guard já faz).
2. **Uma camada de acesso a dado Meta Ads é construída NESTE lado** —
   integração direta com a Graph API do Meta, um adaptador que popula
   `MetricFact` de verdade, e o Jarbas (LLM) passa a receber esses fatos já
   calculados em vez de decidir sozinho o que aconteceu. Isso é um projeto
   de integração novo, não uma correção de robustez — está fora do escopo
   desta missão de hardening.

Sem uma das duas, qualquer "visão macro da agência", "detecção de
anomalia", "árvore de hipótese sobre dado real" seria necessariamente ou
(a) o LLM externo inventando estrutura que este repositório não pode
verificar, ou (b) este repositório fabricando `MetricFact`s falsos só pra
preencher o contrato — as duas coisas são exatamente o "no fake success"
que a missão pediu pra nunca fazer.

## 5. O que JÁ é possível, hoje, sem essas duas coisas

- Jarbas continuar operando como está: texto livre, `READ-FIRST`,
  `HUMAN-VERIFIED`, com o date-guard como única rede de segurança numérica.
- O contrato de tipos (`jarbas-analysis.ts`) fica pronto pra ser preenchido
  no dia em que a integração de dado existir — não precisa ser reescrito.
- O verificador de métrica (`metric-verifier.ts`) fica pronto pra validar
  qualquer `MetricFact` que aparecer — não precisa ser reescrito.
- `groundClaims` continua disponível pra qualquer bloco de evidência
  estruturada que o caminho do Jarbas vier a montar.

## 6. Arquitetura futura de aprovação de mutação (não implementada, só descrita)

Quando/se o Jarbas ganhar acesso real a dado Meta Ads, o modelo de
segurança correto (pedido explicitamente pela missão, nunca implementado
aqui) é:

```
Jarbas detecta problema
  → recomenda mudança (texto + MetricFact de evidência)
  → cria uma proposta de ação (mesmo padrão do [AGUARDA_APROVACAO] que já
    existe pra Jarbas/Suzy em execute-job.ts — extractApprovalProposal +
    requestToolCall, que JÁ cria um tool_call pendente e exige aprovação de
    master via POST /tool-calls/:id/approve)
  → humano aprova
  → só então um caminho de execução autorizado (que não existe hoje) pode
    rodar
```

O mecanismo de aprovação genérico (`requestToolCall`, tool_calls
pendentes, aprovação por master) já existe e já é usado por Jarbas/Suzy
pra outras ações sensíveis — é a peça mais reaproveitável de toda essa
arquitetura futura. O que falta é só o EXECUTOR do lado autorizado (que
chamaria a Graph API de verdade) — que esta missão explicitamente proíbe
construir agora.

## 7. O que esta rodada construiu — mecanismo real, offline, não conectado

- **`packages/agent-runtime/src/agent-task.ts`** — `AgentTaskStore`
  (interface) + `InMemoryAgentTaskStore` (única implementação fornecida).
  Dispatch idempotente por `dispatchKey` (mesma chave duas vezes = mesma
  tarefa, nunca duplica — §33), máquina de estado completa (§23) que
  recusa transição inválida e nunca sai de um estado terminal, isolamento
  de organização em toda leitura/escrita (`cross_org` explícito, nunca
  lança exceção nem vaza dado de outra org).
- **`packages/agent-runtime/src/jarbas-diagnosis.ts`** — árvore de
  diagnóstico determinística (§18), não-LLM: dado um snapshot de métricas
  JÁ CALCULADO, decide entre saudável / hipótese de fadiga de criativo /
  hipótese de problema pós-clique / problema de tracking / amostra
  insuficiente. Limiares por escala de métrica (CTR em pontos percentuais
  pequenos, CPM em variação relativa, frequência em unidades) — a primeira
  versão usava um limiar único e não detectava quedas reais de CTR: achado
  e corrigido nesta mesma rodada, com teste de regressão.
- **`packages/agent-runtime/src/jarbas-fixtures.ts`** — 10 cenários
  sintéticos (subconjunto deliberado dos ~28 pedidos na missão — ver §4
  acima pelo porquê do corte: os que faltam dependem de resolução de
  entidade Meta real).
- **`packages/agent-runtime/src/bento-jarbas-handoff.ts`** — detecção
  determinística (regex, sem LLM) de três intenções: pedido de handoff
  ("Bento, manda o Jarbas analisar..."), pergunta de status ("o Jarbas
  terminou?"), e pedido de mutação proibida ("aumenta orçamento 20%") —
  esta última existe só pra o CALLER decidir nunca executar, nunca pra
  autorizar.
- **28 testes de fluxo** (`bento-jarbas-handoff.test.ts`) cobrindo
  literalmente os 8 cenários exigidos em §65 da missão, ponta a ponta com
  os componentes acima.

## 7.1 Por que nada disto está ligado ao Bento de produção

`InMemoryAgentTaskStore` é só em memória — perde todo estado a cada
restart do worker. Ligar isto ao `bento-action-guard.ts` real faria o
sistema PARECER capaz de rastrear tarefas entre turnos quando na verdade
perderia tudo silenciosamente a cada deploy/restart — exatamente o "fake
success" que a missão inteira existe pra impedir. Persistir de verdade
exige uma migração de schema Postgres real (`agent_tasks` + resultado
associado), que é uma mudança de produção que esta missão explicitamente
proíbe ("do not deploy", "do not restart production"). A interface
`AgentTaskStore` já está no formato certo pra uma implementação Postgres
assumir o lugar da implementação em memória sem que nenhum código
chamador precise mudar — esse é o próximo passo concreto, não construído
aqui.

## 8. Limitações conhecidas (resumo)

- Sem trace de ferramenta do serviço externo → nenhum número do Jarbas é
  verificável hoje, só o período.
- Sem mecanismo de tarefa Bento→Jarbas → "Bento, manda o Jarbas analisar a
  Cosentino" não tem onde pousar estruturalmente; hoje seria só mais um
  turno de chat de texto livre, sem lifecycle, sem idempotência formal,
  sem devolução estruturada pro Bento reportar depois.
- Sem escrita de memória no caminho do Jarbas → nenhuma "decisão aprovada"
  ou "hipótese rejeitada" sobrevive entre conversas hoje, mesmo que o
  motor de memória já soubesse guardar.
- `groundClaims` funciona mecanicamente pra métrica de Ads mas não foi
  testado/ajustado pro vocabulário do domínio (CPA, ROAS, impressões) nem
  pra escopo de campanha/adset (só distingue global vs cliente hoje).
