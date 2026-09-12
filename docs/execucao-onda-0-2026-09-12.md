# Execução da Onda 0: blindagem e linha de base

Data: 2026-09-12. Branch: `fix/agentes-onda-0`. Auditoria de referência: `docs/auditoria-forense-agentes-2026-09-12.md`.

## 1. Placar

- 0.1 Portão do Jarbas: ENTREGUE (5 portões verdes, script executável).
- 0.2 Linha de base de latência: ENTREGUE (380 execuções reais, 30 dias).
- 0.3 Linha de base de comportamento: ENTREGUE (19 casos executados contra produção local, 2 não executados com motivo registrado).
- 0.4 Esqueleto da suíte de aceite: ENTREGUE (23 casos, 18 ativos, 5 pendentes de capacidade com BL referenciado).

BLOQUEADOS: nenhum. NÃO INICIADOS: nenhum.

## 2. Por item

### 0.1a: snapshot do prompt do Jarbas

- Arquivo: `packages/types/src/personalities.test.ts`. Hash sha256 congelado do bloco `JARBAS` (`862433c0...ebfa86`), com mensagem de falha que nomeia a regra "Jarbas é intocável" e exige autorização do dono para mudar.
- Teste extra: tamanho do bloco <= 900 caracteres (limite medido do canal dele, `docs/agent-prompts/README.md:15-16`).
- Prova: `pnpm --filter @desigual-os/types test`, 22/22 verdes.
- Validar à mão: editar uma letra do bloco JARBAS e rodar o teste; ele quebra com a mensagem do portão.
- Commit: `781345e`.

### 0.1b: contrato de mensagem (bloco operacional nunca no Jarbas)

- Os dois predicados que estavam inline em `apps/api/src/chat/routes.ts` foram extraídos sem mudança de lógica para `apps/api/src/chat/message-assembly.ts` (`contextoEnvenenaBusca`, `agenteAceitaBlocoNaMensagem`), e a rota passa a usá-los.
- Teste: `apps/api/src/chat/message-assembly.test.ts`, 5 casos: jarbas/suzy/bento nunca recebem bloco operacional na mensagem; só otto/studio recebem; bloco de contexto geral continua fora do Bento.
- Prova: vitest da api, 5/5 verdes; typecheck da api verde.
- Commits: `330a7de` (módulo + teste), `af12f35` (rota usa os predicados).
- Nota de processo: `routes.ts` tinha mudanças pré-existentes do dono não commitadas (idempotência, paralelização). O primeiro commit meu puxou esse trabalho junto por engano; desfiz (`git reset --soft`), separei os hunks com `git apply --cached` de um patch filtrado, e commitei só as 7 linhas desta onda. O trabalho do dono permanece intacto e não commitado no working tree.

### 0.1c/d/e: anti-duplicidade, aprovação e script do portão

- 0.1c e 0.1d já tinham cobertura real no repo: `packages/orchestrator/src/queues.test.ts` trava `AGENT_MAX_ATTEMPTS.jarbas = 1`; `apps/worker/src/processors/execute-job.test.ts:197,221` prova que `[AGUARDA_APROVACAO]` vira tool_call pendente e que permissão negada vira explicação; `packages/types/src/text.test.ts:72-87` cobre `extractApprovalProposal`. Não dupliquei teste: o script roda os existentes.
- Script: `scripts/qa/jarbas-nao-regressao.ts`, roda os 5 portões e imprime placar. Saída real desta sessão:

```
[PASS] a) snapshot sha256 do prompt do Jarbas (personalities.ts congelado)
[PASS] b) bloco operacional do ClickUp NUNCA entra na mensagem do Jarbas
[PASS] c) anti-duplicidade: Jarbas tem exatamente 1 tentativa no BullMQ
[PASS] d1) [AGUARDA_APROVACAO] vira tool_call pendente (interceptação no worker)
[PASS] d2) extractApprovalProposal extrai o bloco de aprovação (contrato do marcador)
PLACAR: 5/5 verdes. Jarbas intacto, a onda pode seguir.
```

- Uso: `pnpm --filter @desigual-os/api exec tsx ../../scripts/qa/jarbas-nao-regressao.ts`. Commit: `609bc1e`.

### 0.2: baseline de latência

- Script: `scripts/qa/baseline-latencia.ts`. Lê `executions` (createdAt, startedAt, completedAt) via driver postgres, calcula p50/p95 de fila, execução e total por agente, grava `artifacts/baseline-latencia-2026-09-12.json`.
- Resultado real (30 dias, 380 execuções):

| Agente | n | ok | fail | fila p50/p95 | execução p50/p95 | total p50/p95 |
|---|---|---|---|---|---|---|
| bento | 120 | 106 | 14 | 1,1s / 22,6s | 9,1s / 39,4s | 10,7s / 44,0s |
| jarbas | 177 | 139 | 35 | 0,6s / 15,4s | 4,7s / 74,4s | 6,8s / 78,2s |
| suzy | 45 | 45 | 0 | 0,6s / 3,3s | 12,9s / 69,8s | 13,5s / 70,3s |
| otto | 37 | 30 | 6 | 1,0s / 322,8s | 66,8s / 273,5s | 74,1s / 608,0s |
| studio | 1 | 0 | 1 | amostra mínima | | |

- Leituras que a Onda 3 terá que responder: o p95 total do Otto (608s) passa do watchdog de 6min da UI; a fila p95 do Otto (322s) confirma na prática o risco de concorrência BL-14; o Jarbas falha 20% das execuções (35/177), número que ninguém estava olhando (baseline é dele, não se mexe, mas vale o dono saber).
- Limitação honesta: `classify_ms/retrieval_ms/llm_ms` do Otto não são persistidos pelo worker (`apps/worker/src/processors/execute-job.ts:908` grava só answer/sources/error), então o baseline mede tempo de parede, não fases internas. Persistir a metadata do node fica como achado fora de escopo.
- Commits: `01cc44f` (script), `d974117` (artifact).

### 0.3: baseline de comportamento

- Script: `scripts/qa/baseline-comportamento.ts`. Roda os casos de aceite contra a API viva (localhost:3001) com agent_hint explícito por caso (o que se mede é o agente, não o router), polling até completed/failed com timeout por agente, e grava um JSON por caso em `artifacts/baseline-comportamento-2026-09-12/` mais `index.json`.
- Decisões registradas no cabeçalho do script: `b4` e `o5` NÃO executados (upload de anexo inexistente; carrossel dispararia studio_jobs reais com custo de GPU na máquina do Studio). Isso é recusa deliberada de efeito colateral, não fuga de medição.
- Placar da rodada: 13 completos, 6 falhas, 2 não executados.
- **Achado grave do baseline: 6 das 7 perguntas do Bento falharam ao vivo** com a mensagem "Não consegui responder agora: a ação reportou falha técnica; a observação veio vazia". Essa frase só existe em `packages/agent-runtime/src/evaluator.ts:46,53`, ou seja, o Bento está falhando ATRAVÉS do loop V2. Ver seção 4 (divergências).
- Falhas comportamentais reais registradas (respostas cruas nos artifacts): Suzy não trabalha objeção de preço (deflete pro Bento); Suzy publicaria sem exigir confirmação no texto e vazou uma diretiva interna em backticks (`cria uma task no clickup: ...`, formato não coberto por `stripInternalHandoffDirectives`); Otto respondeu "quais os melhores criativos" com um template genérico de estrutura em vez de admitir que não tem material (exatamente o modo de falha que o prompt dele tenta proibir); a revisão de peça do Otto saiu sem veredito.
- Commit: `9588444`.

### 0.4: suíte de aceite estrutural

- Script: `scripts/qa/aceite-agentes.ts`. 23 casos mapeados dos critérios da auditoria seção 4, com asserções estruturais (tem número, tem fonte, admite lacuna, sem URL inventada, uma pergunta só, veredito com direção, fio de conversa etc.). Casos que dependem de capacidade inexistente entram como `pendente(BL-XX)`: b1-prompt (BL-07), b3 (BL-01), b4 (BL-05/BL-06), o5 (BL-13), o6 (BL-14).
- Modo medição (default) sai 0 com placar; `--strict` sai 1 com qualquer ativo vermelho (modo portão de onda).
- Placar sobre o baseline: 6/18 ativos verdes, 12 vermelhos, 5 pendentes. Este é o "antes" oficial contra o qual as Ondas 1 a 3 serão medidas.
- Commit: `02d2441` (junto com o script do item 0.3).

## 3. Portão do Jarbas

5/5 verdes no início e no fim da onda (saída real na seção 0.1c/d/e acima). Nenhum comportamento dele foi tocado: a única mudança em código de produção desta onda é a extração dos predicados de montagem de mensagem, com lógica idêntica e coberta por teste.

## 4. Divergências (código contradisse a auditoria)

1. **O loop V2 está LIGADO no worker em execução.** A auditoria registrou `AGENT_LOOP_V2=false` (`.env.example:37`, default em `execute-job.ts:42`). Mas o worker vivo (pid 17811) tem `AGENT_LOOP_V2` no ambiente do processo, o `.env` da raiz NÃO contém a variável, e as falhas do Bento no baseline vieram com texto do evaluator do loop. Ou seja: alguém subiu o worker com a flag exportada à mão. Implicação direta para a Onda 3: a flag por agente não é só boa prática, é correção de um estado atual em que o loop envolve TODOS os agentes, Jarbas incluso. Isso precisa ser saneado já na Onda 1 (item fora do plano original, recomendo incluir).
2. **As falhas do Bento no baseline passaram pelo loop e não pelo caminho one-shot**, então o "modo de falha" medido hoje não é o mesmo que a auditoria descreveu (one-shot). Causa raiz da falha do bento-qa nesses 6 casos não foi investigada (fora do escopo da Onda 0); o artifact guarda a evidência.
3. **Contagem de caracteres do bloco Jarbas**: a auditoria registrou 855; a extração do template literal mede 859. Irrelevante para o portão (teto 900), registrado para precisão.

## 5. Achados fora de escopo (vistos, não tocados)

1. Bento falhou 6 de 7 perguntas ao vivo (seção 0.3). Prioridade de investigação na Onda 1.
2. Suzy vaza diretiva interna em backticks num formato não coberto pelo filtro atual (`stripInternalHandoffDirectives` só remove `` `pergunta pro bento: ...` ``, `execute-job.ts:199-203`). Novo formato observado: `` `cria uma task no clickup: ...` ``.
3. Jarbas: 35/177 execuções failed nos últimos 30 dias (baseline 0.2). Fora de escopo por definição (intocável), mas o dono deveria saber do número.
4. Metadata de fases do Otto (`classify_ms/retrieval_ms/llm_ms`) descartada pelo worker; persistir em `execution_steps.output` custaria pouco e destravaria análise fina de latência na Onda 3.
5. Token QA expirado derrubou a primeira rodada do baseline com 19 falhas de 401; o script agora reautentica sempre (corrigido dentro do próprio item).

## 6. Próxima onda

Pré-requisitos da Onda 1 que passam a existir: portão do Jarbas executável, baseline de latência, baseline de comportamento com placar 6/18, suíte de aceite com pendentes mapeados por BL.

O que continua faltando e trava itens da Onda 1: acesso SSH (prompts de Bento/Suzy só vivem nos serviços), confirmação de `ANTHROPIC_API_KEY` em produção (item 1.6), autorização para mover `Brain-Marketing/cerebro/` (item 1.4), e a decisão sobre o estado real de `AGENT_LOOP_V2` no worker em produção (divergência 1 acima, nova).

## 7. Plano de reversão

Toda a onda vive na branch `fix/agentes-onda-0`, em 7 commits atômicos (`781345e` a `9588444`). Reversão total: não fazer merge, ou `git revert` dos commits da onda. A única mudança em código executável é `message-assembly.ts` + dois call sites em `chat/routes.ts`, com comportamento provadamente idêntico (teste trava as duas regras); reverter `af12f35` e `330a7de` restaura o inline original. Os demais commits são aditivos (testes, scripts, artifacts) e não mudam runtime. Nada nesta onda toca banco, fila, nodes ou serviços externos.
