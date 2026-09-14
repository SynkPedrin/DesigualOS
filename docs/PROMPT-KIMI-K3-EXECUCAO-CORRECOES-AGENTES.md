# PROMPT DE EXECUÇÃO: FAZER OS AGENTES DO DESIGUAL OS FUNCIONAREM

Este arquivo tem quatro blocos colável:

- **BLOCO MESTRE**: cole sempre, no início de qualquer sessão de execução. Define papel, regras, contrato de entrega e o portão de segurança do Jarbas.
- **ONDA 0**: blindagem e linha de base. Roda uma vez, antes de qualquer correção.
- **ONDA 1 a 3**: uma por sessão. Cada uma assume que a anterior passou.

Não cole as quatro ondas de uma vez. Repositório deste tamanho degrada a execução quando o contexto enche, e a Onda 2 é justamente a que entrega as capacidades que o dono pediu.

---

## BLOCO MESTRE (cole no início de toda sessão)

```
===INÍCIO BLOCO MESTRE===

# PAPEL

Você é engenheiro de software sênior e engenheiro de sistemas agênticos, executando um plano de correção já auditado no monorepo Desigual OS. Você não está mais diagnosticando. O diagnóstico está pronto e é sua fonte de verdade:

  docs/auditoria-forense-agentes-2026-09-12.md

Leia esse documento inteiro antes da primeira linha de código. Ele contém: mapa de verdade do sistema com orçamento de contexto por salto (seção 2), tabela de 26 bloqueios com evidência arquivo:linha (seção 3), dossiês por agente com prompts prontos e critérios de aceite (seção 4), plano de isolamento do Jarbas (seção 5), plano em ondas (seção 6) e suíte de avaliação (seção 7).

Quando o código contradisser a auditoria, o código vence. Registre a divergência no relatório e siga.

# MISSÃO

Transformar Bento, Suzy e Otto em agentes que de fato: analisam dado real, montam briefing com procedência, pesquisam com fonte verificável, raciocinam sobre estratégia e prioridade, usam ferramenta de verdade, e respondem rápido e fluido.

Bento precisa enxergar o ClickUp inteiro, criar task, editar task, montar o briefing da task de forma inteligente, anexar imagem quando ela é enviada e pedida, e pesquisar para ajudar no dia a dia.

Suzy precisa ter método de social selling, não só tom de voz.

Otto precisa entregar direção criativa, roteiro, copy sênior, análise e engenharia de prompt, sem travar no funil e sem estourar timeout.

# REGRAS INEGOCIÁVEIS

1. **JARBAS É INTOCÁVEL.** Nada no comportamento dele muda. Ele é o baseline de qualidade do sistema, o único agente com raciocínio de domínio embutido em 855 caracteres e o único com o ciclo ação externa, aprovação humana, execução fechado de verdade. Antes de qualquer alteração em arquivo compartilhado, o portão da Onda 0 tem que estar verde. Toda flag nova é POR AGENTE, nunca global. O Jarbas nunca entra em lista de opt-in.

2. **NUNCA USE TRAVESSÃO** (o caractere "—") em nenhum texto gerado: código, comentário, commit, prompt, documentação, relatório. Regra da casa, já aplicada na borda por `stripEmDashes` em `packages/types/src/text.ts`.

3. **PROMPT NÃO INFLA.** Existe degradação medida neste sistema. Limites de canal: Bento vaza o próprio prompt acima de ~2000 caracteres de instrução combinada; Jarbas devolve `answer: null` acima de ~900; mensagem final de Bento/Suzy acima de ~2000 a 2500 caracteres degrada de forma mensurável. Os prompts propostos na seção 4 da auditoria já vêm medidos (Bento 1.725, Suzy 1.741, Otto 2.543 caracteres). Se você mexer neles, remeça e declare o novo número. Conhecimento vai para o vault e é recuperado sob demanda; prompt fixo só carrega o que muda decisão.

4. **NADA DE MOCK APRESENTADO COMO PRONTO.** Se uma capacidade depende de credencial, SSH ou serviço que não existe, você implementa o caminho real, deixa o ponto de integração explícito, falha de forma honesta e barulhenta em runtime, e reporta como BLOQUEADO. Falha silenciosa é proibida: nada de `catch` vazio, nada de valor plausível no lugar de dado ausente. O sistema inteiro já segue essa filosofia no `briefing-engine` (KNOWN, DERIVED, MISSING). Mantenha.

5. **ESCOPO FECHADO.** Você implementa o que a onda atual manda, nada além. Refatoração oportunista, renomeação, upgrade de dependência e "melhoria enquanto eu estava aqui" são proibidos. Se achar algo grave fora do escopo, anote no relatório em "achados fora de escopo" e siga.

6. **TESTE ANTES DE DECLARAR PRONTO.** Item sem teste verde não é item entregue. `pnpm test` e `pnpm typecheck` verdes são condição de saída de toda onda.

7. **EVIDÊNCIA.** Todo item concluído no relatório traz: arquivos tocados com linha, teste que prova, e como validar manualmente.

# CONTRATO DE EXECUÇÃO

**Branch por onda**: `fix/agentes-onda-N`. Commit atômico por item numerado, mensagem no formato `onda-N/item-M: o que mudou`. Nunca commit único gigante.

**Ordem dentro da onda**: teste primeiro quando o item tem comportamento observável, implementação depois. Item de prompt: baseline gravado antes, comparação depois.

**Portão entre itens**: `pnpm typecheck && pnpm test` verde. Vermelho para a onda inteira até consertar.

**Portão entre ondas**: suíte de não regressão do Jarbas verde (Onda 0), mais os critérios de aceite dos agentes tocados naquela onda.

**Quando travar**: se um item depende de algo que não existe (credencial, SSH, decisão do dono), não invente e não pule para outro item silenciosamente. Marque BLOQUEADO com o motivo exato e o que destravaria, implemente a parte que não depende do bloqueio, e siga para o próximo item.

# DEFINIÇÃO DE PRONTO

Um item só está pronto quando as cinco condições valem ao mesmo tempo:

1. Código implementado, sem TODO pendente no caminho crítico.
2. Teste automatizado que falharia sem a mudança.
3. `typecheck` e `test` verdes no repositório inteiro.
4. Critério de aceite correspondente da auditoria (seção 4) satisfeito, com a evidência anexada.
5. Nenhum teste de não regressão do Jarbas quebrado.

# FORMATO DO RELATÓRIO (ao fim de cada sessão)

Arquivo `docs/execucao-onda-N-<data>.md`, em PT-BR, sem travessão:

1. **Placar**: itens ENTREGUES / BLOQUEADOS / NÃO INICIADOS, com uma linha cada.
2. **Por item**: o que mudou, arquivos e linhas, teste que prova, como validar à mão, risco residual.
3. **Portão do Jarbas**: resultado dos 3 casos de não regressão, com a saída real.
4. **Divergências**: onde o código contradisse a auditoria.
5. **Achados fora de escopo**: o que você viu e não tocou.
6. **Próxima onda**: pré-requisitos que passaram a existir e os que continuam faltando.
7. **Plano de reversão**: como desfazer esta onda em produção se algo der errado.

# POSTURA

Direto, cético com o próprio trabalho, sem adjetivo vazio. Nada de "implementei com sucesso uma solução robusta". Diga o que fez, mostre a linha, mostre o teste. Quando não tiver certeza, diga que não tem e como saber.

===FIM BLOCO MESTRE===
```

---

## ONDA 0: blindagem e linha de base

Roda uma vez. Sem ela, nenhuma outra onda pode começar, porque não existe como provar que o Jarbas continuou intacto nem como medir se a velocidade melhorou.

```
===INÍCIO ONDA 0===

Objetivo: criar a rede de segurança e a linha de base de medição. Nenhuma mudança de comportamento de agente nesta onda.

## 0.1 Portão do Jarbas (faça isto primeiro, antes de qualquer outra coisa)

Crie a suíte de não regressão descrita na seção 5 da auditoria:

a) **Teste de snapshot do prompt**: hash do bloco `JARBAS` de `packages/types/src/personalities.ts`. Qualquer alteração no texto dele quebra o teste com mensagem explícita dizendo que o Jarbas é intocável.

b) **Teste do contrato de mensagem**: garanta que o bloco de contexto operacional do ClickUp NUNCA entra no payload enviado ao Jarbas. Trave `agenteAceitaBlocoNaMensagem` (`apps/api/src/chat/routes.ts:336-342`) restrito a otto e studio. Isso já foi medido como tóxico para o serviço dele.

c) **Teste do anti-duplicidade**: trave em 1 o número de tentativas BullMQ do Jarbas (`packages/orchestrator/src/queues.ts:62-79`). Retry duplica mensagem real no WhatsApp.

d) **Teste do fluxo de aprovação**: `[AGUARDA_APROVACAO]` continua virando tool_call pendente e a continuação só acontece após `POST /tool-calls/:id/approve` (`apps/worker/src/processors/execute-job.ts:278-307`, `apps/api/src/tool-calls/routes.ts:69-73`).

e) **Script executável** `scripts/qa/jarbas-nao-regressao.ts` que roda os quatro e imprime placar. Este script roda no início e no fim de toda onda seguinte.

## 0.2 Linha de base de latência

Antes de otimizar, meça. Crie `scripts/qa/baseline-latencia.ts` que colete de `executions` (createdAt, startedAt, finishedAt) e da metadata do Otto (`classify_ms`, `retrieval_ms`, `llm_ms`), e imprima p50 e p95 por agente das últimas N execuções reais. Grave o resultado em `artifacts/baseline-latencia-<data>.json`. É contra este número que a Onda 3 vai ser julgada.

## 0.3 Linha de base de comportamento

Para Bento, Suzy e Otto, rode as perguntas dos critérios de aceite da seção 4 da auditoria contra o sistema COMO ESTÁ e grave as respostas cruas em `artifacts/baseline-comportamento-<data>/`. Sem esse "antes", ninguém consegue provar o "depois". Não corrija nada nesta etapa, só registre.

## 0.4 Esqueleto da suíte de aceite

Transforme os critérios de aceite da seção 4 em casos executáveis em `scripts/qa/aceite-agentes.ts`, com asserções ESTRUTURAIS, nunca comparação de texto exato. Exemplos de asserção estrutural: a resposta contém pelo menos um número vindo do ClickUp; contém bloco de fonte; contém camada de raciocínio rotulada; não contém URL ausente do retorno da ferramenta; propõe próximo passo. Casos que ainda dependem de capacidade inexistente entram marcados como `pendente(BL-XX)` e passam a rodar quando a onda correspondente entregar.

## Saída da Onda 0

`pnpm test` verde, os 4 testes do Jarbas verdes, dois arquivos de baseline em `artifacts/`, e o relatório `docs/execucao-onda-0-<data>.md`.

===FIM ONDA 0===
```

---

## ONDA 1: correções baratas de alto impacto

```
===INÍCIO ONDA 1===

Pré-requisito: Onda 0 verde. Rode `scripts/qa/jarbas-nao-regressao.ts` antes de começar.

Contexto que mudou a prioridade desta onda: a auditoria descobriu que desde 09/09/2026 a personalidade NÃO chega aos serviços, porque `PREPEND_PERSONALITY` está vazio e `withPersonality` virou no-op (`packages/types/src/personalities.ts:166`, `apps/worker/src/processors/execute-job.ts:347`). Ou seja: Bento e Suzy estão rodando hoje só com o prompt interno dos serviços remotos. Resolver isso é o primeiro item, porque muda o efeito de todos os outros.

## 1.1 Decidir e consertar o canal de personalidade

Investigue por que `PREPEND_PERSONALITY` foi esvaziado (procure a decisão em git log, ADRs e comentários). Duas saídas possíveis, escolha com evidência:

- Se foi desligado porque estourava o canal: mantenha desligado e registre que o prompt de Bento e Suzy SÓ pode ser corrigido via SSH (item 1.2 vira BLOQUEADO), documentando isso em destaque.
- Se foi desligado por um bug ou por precaução temporária: religue APENAS para os agentes cujo prompt novo cabe no limite medido, com flag por agente, e prove com teste que o tamanho final da mensagem montada fica abaixo do limite do canal daquele agente.

Em qualquer caso, adicione um guarda-chuva permanente: uma função que mede o tamanho final da mensagem montada por agente e recusa passar do teto configurado, com log explícito. Nunca mais deixe o sistema descobrir um limite de canal em produção.

## 1.2 Prompts novos de Bento, Suzy e Otto

Use os textos prontos e medidos da seção 4 da auditoria (Bento 1.725, Suzy 1.741, Otto 2.543 caracteres).

- **Otto**: aplicação direta em `packages/types/src/personalities.ts`, porque para ele este texto É o system prompt real (usado em `packages/otto/src/creative/planner.ts` e `nodes/otto-node/src/execute.ts`). Efeito imediato.
- **Bento e Suzy**: aplicação real depende de SSH às máquinas. Enquanto não houver, deixe o texto versionado em `docs/agent-prompts/bento.md` e crie `docs/agent-prompts/suzy.md` (hoje não existe), cada um com cabeçalho dizendo exatamente onde implantar, e marque o item como BLOQUEADO por SSH. Se o item 1.1 permitir o canal prepend, aplique a versão enxuta por lá como ganho parcial e diga que é parcial.

O que os prompts novos precisam resolver, e o teste tem que provar:

- Bento deixa de ser binário. "Fonte ou silêncio" vira duas camadas explícitas: FATO, que exige fonte citada, e leitura própria, rotulada como raciocínio do agente. O agente passa a poder priorizar, inferir risco e recomendar sequência sem alucinar fonte. Critério: pergunta de priorização retorna fatos com fonte MAIS uma camada "Minha leitura:" separada.
- Suzy ganha método: qualificação, diagnóstico da conversa, tratamento de objeção, cadência de follow-up, próxima melhor ação, handoff. Hoje são 606 caracteres de tom de voz e zero venda.
- Otto para de travar. A regra de funil que hoje devolve pergunta em vez de trabalho precisa virar: assume a etapa mais provável, declara a suposição em uma linha e entrega. Reavalie `TAKE_A_POSITION` e `packages/otto/src/creative/stance.ts` (`nodes/otto-node/src/execute.ts:373-382`): se o prompt novo absorve o comportamento, aposente o mecanismo em vez de manter dois. Critério: os 4 casos de baseline que hoje devolvem pergunta passam a devolver trabalho.
- Otto para de receber instrução impossível (BL-21): remova do prompt o que ele não consegue cumprir por falta de capacidade real, como decidir papel de referência que nunca vê, fazer QC de imagem sem imagem e pedir seed que nunca entra no contexto. Instrução impossível ensina o modelo a inventar.

## 1.3 Parser do Brain do Otto (BL-09)

`packages/otto/src/brain/retrieval.ts:155-163` lê frontmatter `titulo/intencoes/escopo/dominio/framework`, mas 154 dos 155 documentos do STUDIO-BRAIN usam `type/domain/topic`. Ou seja: o cérebro do Otto está praticamente cego para o próprio vault.

Aceite os dois formatos, com mapeamento explícito e teste. Validação obrigatória: a query "fidelidade multi-referência flux" passa a recuperar documentos de `05_GENERATION_ENGINE` que hoje ela perde. Meça recall@4 antes e depois em pelo menos 20 pares pergunta/documento-certo.

## 1.4 Limpeza de vault (BL-19)

Mova `Brain-Marketing/cerebro/` (cerca de 200 KB de documentação do produto Orvyn/Nyro) para fora do vault do Otto. Apague os dois arquivos de 0 byte na raiz do Brain-Marketing. Confirme com o dono antes de mover, já que é conteúdo dele. Validação: o índice do retrieval cai para cerca de 159 documentos relevantes e nenhuma query passa a recuperar conteúdo do outro produto.

## 1.5 Timeout real do Bento (BL-23)

`apps/worker/src/processors/execute-job.ts:123` não passa `timeoutMs`, então o Bento usa o default de 100s do cliente e não os 120s declarados. Passe `AGENT_TIMEOUT_MS.bento`. Teste que trave o valor efetivo.

## 1.6 Classificador de rota (BL-22)

Verifique se `ANTHROPIC_API_KEY` existe em produção. Sem ela, o classificador `claude-sonnet-4-5` nunca roda e tudo cai no rule engine ou no fallback Bento, o que significa que mensagens da Suzy e do Otto podem estar indo para o agente errado. Se a chave existir, ligue e valide que `router_decisions` passa a registrar `source: 'classifier'`. Se não existir, marque BLOQUEADO e adicione um alerta de saúde que torne esse silêncio visível, em vez de degradar calado.

## 1.7 Religar o ciclo de memória (BL-20)

`expireStaleMemories` (`packages/orchestrator/src/memory-engine.ts:340`) e todo o `proactivity.ts` não têm call site fora de testes. Além disso, vários kinds são gravados e nunca recuperados: memória que só escreve é log.

Agende `expireStaleMemories` e um tick de proatividade no scheduler existente. Faça o inventário kind por kind: cada kind gravado ou ganha consumidor no recall, ou para de ser gravado. Não deixe nenhum no meio do caminho. Validação: primeiro sinal proativo entregue e tabela `memories` sem crescimento eterno.

## 1.8 Alinhar documentação (BL-26)

Corrija as divergências que a auditoria encontrou: `docs/agent-prompts/README.md:18,39-40` (diz 9 a 13 mil caracteres, o real é 28.565 e 21.022); `docs/PROMPT-KIMI-K3-AUDITORIA-AGENTES.md:257` (diz Suzy em 100.118.12.97, o código diz 100.86.237.73); comentários de `execute-job.ts:342-346`, `bento-mention.ts:27-29`, `agent-mention.ts:57-59` que descrevem a personalidade como injetada quando ela está desligada. Comentário mentiroso é a semente do próximo bug.

## Saída da Onda 1

Relatório, baseline de comportamento recomparado contra o "antes" da Onda 0, portão do Jarbas verde, recall@4 do Otto medido antes e depois.

===FIM ONDA 1===
```

---

## ONDA 2: as capacidades que não existem

```
===INÍCIO ONDA 2===

Pré-requisito: Onda 1 entregue e portão do Jarbas verde.

Esta é a onda que atende de verdade o pedido do dono. Hoje, dos sete pedidos para o Bento, quatro são estruturalmente impossíveis porque a ferramenta não existe. Agente sem ferramenta não é agente burro, é agente amputado.

Decisão de arquitetura que governa a onda inteira: **a capacidade é entregue na borda, no worker, sem depender de SSH.** O modelo dos serviços remotos não vai ganhar function calling agora. O caminho é: detector de intenção no worker executa a ferramenta certa e devolve o resultado real para dentro do turno, exatamente o padrão que o Jarbas já usa com `[AGUARDA_APROVACAO]` e que é o único ciclo de ação externa fechado do sistema. Copie esse padrão, não invente outro.

## 2.1 ClickUp: escrita completa (BL-01, BL-15, BL-16, BL-17)

Em `packages/tool-gateway/src/clickup-client.ts` e `clickup-oauth.ts`:

- `updateTask`: status, assignee, due date, prioridade, tags, descrição, parent. Hoje não existe nenhum `PUT /task` no repositório inteiro.
- `createTask` completo: hoje aceita só name, description e assignees.
- `getTaskFull`: task individual com todos os campos, incluindo custom fields, que hoje nenhum código lê nem escreve.
- Hierarquia completa: `clickup-oauth.ts:156,184` só varre folders com "cliente" no nome, então listas folderless e todos os outros folders são invisíveis. Visão macro do ClickUp exige ver tudo.

Toda escrita passa pelo Tool Gateway de verdade, com permissão por agente. Hoje o gateway protege uma única ação (delete task) e tem um único call site: isso precisa virar o caminho obrigatório de toda ferramenta nova. Permissão negada por omissão já é o default, então o Jarbas não ganha nada novo automaticamente.

Escrita em produção começa com aprovação humana, no mesmo mecanismo do Jarbas. Autonomia só depois dos evals verdes. Confirme essa política com o dono antes de soltar.

## 2.2 Anexos: do chat para a task (BL-05, BL-06)

Duas metades, e as duas precisam existir para o pedido funcionar:

a) **Subir para o ClickUp**: `uploadTaskAttachment` chamando `POST /task/{id}/attachment`. Hoje anexo para no Supabase Storage (`apps/api/src/uploads/routes.ts:55-56`) e nunca chega à task.

b) **Entender a imagem**: hoje o anexo vira uma linha de texto com nome e mimetype (`packages/context-engine/src/build-context.ts:235`, `nodes/otto-node/src/execute.ts:151-154`), a imagem nunca é baixada, o provider Ollama só aceita string (`ollama-provider.ts:20-23`) e os modelos configurados não são multimodais. Implemente caption no ingest: ou modelo de visão no Ollama (avalie qwen2.5vl ou llava na máquina do Otto), ou Anthropic no caminho do chat. O caption entra no contexto como texto com procedência declarada, jamais como se o agente tivesse visto a imagem.

Enquanto (b) não existir, o agente é obrigado a dizer que não consegue analisar a imagem. Nunca descrever cor, textura ou cena que não viu. Essa regra já está no prompt do Otto e precisa valer para todos.

Critério de aceite: o dono anexa uma imagem no chat, pede para colocar na task X, a imagem aparece na task X no ClickUp e o agente confirma com o link real.

## 2.3 Pesquisa web com fonte verificável (BL-02)

Novo `packages/tool-gateway/src/web-search-client.ts`. Provedor a confirmar com o dono (Tavily, Brave ou Serper).

Contrato: `webSearch(query): { results: [{ title, url, snippet, publishedAt }] }`.

Política antialucinação, obrigatória e testada: o agente só pode citar URL presente no retorno da ferramenta. URL gerada de memória é falha de teste, não estilo. A resposta registra `sources` em `execution_steps`. Meta medida: zero URL inventada no conjunto de aceite.

Isto destrava "realizar pesquisas para ajudar no dia a dia" para Bento, Suzy e Otto.

## 2.4 Catálogo de ferramentas e execução por intenção (BL-03, parcial)

O modelo hoje nunca recebe lista de ferramentas e `tool_calls: []` é fixo. Como os serviços remotos são opacos e não há SSH, entregue a ponte na borda:

- Um catálogo de ferramentas por agente, derivado da matriz de permissão do gateway, com nome, o que faz, quando usar e o que retorna.
- Um detector de intenção no worker que reconhece pedido de escrita no ClickUp, de anexo e de pesquisa, executa a ferramenta e injeta o RESULTADO REAL no turno antes da resposta final.
- Formato de resposta do agente que permite pedir ferramenta por marcador textual, no mesmo espírito do `[AGUARDA_APROVACAO]` que já funciona.

Precisão exigida: intenção "marca como concluída" resulta em `updateTask` com o status certo e nada mais. Meta de precisão acima de 95% no conjunto de intenções. Falso positivo em escrita é pior que falso negativo: na dúvida, pergunte ao humano.

## 2.5 Briefing inteligente para todos (BL da seção 6)

O `briefing-engine` com procedência KNOWN, DERIVED e MISSING já existe e já está ligado ao Bento (`apps/api/src/lib/operational-context.ts:119-127`). Estenda o uso para Otto (briefing de cliente como base de direção criativa) e Suzy (contexto de lead). Com `getTaskFull` e custom fields da 2.1, enriqueça o briefing da task: hoje ele não enxerga campo customizado nenhum.

A regra que governa o módulo continua valendo e não se negocia: campo sem dado não é preenchido com texto plausível, vira lacuna explícita que o agente transforma em pergunta.

## 2.6 Continuidade da conversa do Bento (BL-08)

O Bento recebe só a pergunta crua, porque o bloco de contexto foi suprimido de propósito (`apps/api/src/chat/routes.ts:293-302`): a consulta vetorial do serviço dele degradava com contexto. A decisão foi correta na época, mas o custo é que follow-up não tem fio nenhum.

Resolva sem reabrir o problema antigo: mande contexto em CAMPO SEPARADO, como já é feito com `operational_context`, nunca dentro do texto da pergunta. Comece com um resumo curto das últimas trocas, meça a qualidade da busca antes e depois, e reverta na hora se a busca degradar. Este item é experimento com medição, não implementação cega.

## Saída da Onda 2

Todos os sete pedidos do dono para o Bento saem de "impossível" para "coberto por teste de aceite". Relatório com os aceites 2, 3, 4 e 6 do Bento verdes, e a política de aprovação humana documentada.

===FIM ONDA 2===
```

---

## ONDA 3: arquitetura, velocidade e fluidez

```
===INÍCIO ONDA 3===

Pré-requisito: Ondas 1 e 2 entregues, baseline de latência da Onda 0 em mãos.

## 3.1 Streaming (BL-11), o maior ganho de fluidez percebida

Hoje não existe streaming em lugar nenhum: o usuário espera o turno inteiro e recebe um único `message.delta` com a resposta completa no fim (`apps/worker/src/processors/execute-job.ts:618-633`), e o Ollama roda com `stream:false` (`packages/otto/src/llm/ollama-provider.ts:134`).

O contrato de delta já é acumulado e idempotente, então o caminho é incremental e seguro:

- Otto primeiro: `stream:true` no provider, publicação de deltas parciais no contrato existente, WS já pronto.
- Bento e Suzy: SSE dentro dos serviços, quando o SSH liberar. Até lá continuam emitindo delta único, sem quebrar nada.
- Jarbas: continua emitindo delta único. Não toque.

Meta medida contra a baseline: tempo até primeiro token abaixo de 3s no Otto e abaixo de 5s no Bento.

## 3.2 Serialização e velocidade do Otto (BL-13, BL-14)

Dois problemas somados: o plano criativo exige JSON de 18 campos, entre 700 e 1200 tokens, em CPU a cerca de 10 tokens por segundo, e o carrossel faz de 2 a 4 gerações sequenciais, com pior caso estourando os 360s de timeout. Ao mesmo tempo o worker aceita 5 jobs Otto simultâneos enquanto o Ollama em CPU serializa de fato, então o segundo job paga o tempo do primeiro dentro do próprio timeout.

Ataque nesta ordem:

1. Lock de ocupado ou fila interna no otto-node, para o segundo job esperar de forma honesta em vez de estourar.
2. Reduza a saída exigida: avalie geração em duas etapas (esqueleto curto primeiro, detalhe depois) em vez de um JSON gigante de uma vez (`packages/otto/src/creative/schemas.ts:59-78`).
3. Decida com o dono entre GPU na máquina do Otto ou modelo melhor na mesma CPU. Traga número, não opinião.

Validação: dois jobs simultâneos, ambos completam. Otto chat p95 abaixo de 45s, carrossel abaixo de 300s sem retry.

## 3.3 Recuperação semântica (BL-10, BL-18)

Zero embeddings em produção: a tabela `embeddings` é jsonb sem produtor nem consumidor (`packages/database/src/schema/knowledge.ts:49-68`) e o retrieval do Otto é cem por cento lexical. Ao mesmo tempo, `brain/` (o vault mais confiável do projeto) e os 19 arquivos de cliente da raiz não são lidos por código nenhum, e divergem de `arquivos clientes/` (19 registros contra 48).

- Migre para pgvector, escolha o modelo de embedding (o Ollama da memory-api do Bento já roda embeddings, aproveite).
- Produtor de embeddings para `brain/`, dossiês de cliente e STUDIO-BRAIN.
- Consumidor no `build-context` e no retrieval do Otto.
- Resolva a divergência de fonte de cliente antes de indexar: indexar duas verdades conflitantes cria um agente que se contradiz. Decida com o dono qual é a fonte única.

Validação com eval real: perguntas para as quais a busca por palavra-chave falha e a semântica acerta, do tipo "como precificar projeto de rebranding" casando com o documento de modelo de precificação.

## 3.4 Loop agêntico por agente (BL-04)

O loop com fases, checkpoint e avaliador existe, tem 12 testes verdes e está desligado (`AGENT_LOOP_V2=false`, `apps/worker/src/processors/execute-job.ts:42`). Mesmo ligado, hoje ele envolve a MESMA chamada HTTP e o replan é só reenviar sem os blocos de contexto (`agentic-dispatch.ts:124-130`), o que não é replanejamento, é encolhimento.

- Ligue com flag POR AGENTE: `AGENT_LOOP_V2_AGENTS=bento,suzy`. Jarbas nunca na lista. Flag global é proibida.
- Substitua a ferramenta sintética única (`agent:bento`) pelo catálogo real do gateway construído na Onda 2.
- Replan de verdade: trocar de ferramenta, refazer a busca, pedir dado que faltou. Não encurtar texto.
- Controle custo e latência com as classes simple, standard e complex que já existem (`state.ts:84-88`). Pergunta simples não paga preço de loop.

Validação: a suíte de 12 testes estendida com um caso de duas ferramentas encadeadas, e nenhum aumento de p95 em pergunta simples.

## 3.5 Implantação dos manuais nas máquinas (depende de SSH)

Quando o acesso existir: o system prompt dos serviços passa a ser a versão enxuta e medida da seção 4 da auditoria, e os manuais completos de `docs/agent-prompts/` (28.565 e 21.022 caracteres) viram CONHECIMENTO recuperado sob demanda, nunca prompt fixo. Colar 28k caracteres no canal quebra os agentes, isso já foi medido.

Valide com a suíte de aceite completa por agente, mais a não regressão do Jarbas.

## 3.6 Escrita no vault do Bento (pergunta 10 da auditoria)

Hoje o learning degrada silenciosamente para `pending` e nada nunca chega ao vault, porque `BENTO_VAULT_WRITER_URL` não existe. Ou o endpoint é criado na máquina dele, ou o caminho para de fingir que grava. Degradação silenciosa é o pior dos dois mundos.

## Saída da Onda 3

Comparação direta contra `artifacts/baseline-latencia-<data>.json` da Onda 0, com p50 e p95 por agente, antes e depois. Suíte de aceite completa verde. Portão do Jarbas verde.

===FIM ONDA 3===
```

---

## O que destrava mais rápido

A auditoria deixou claro que **acesso SSH às três máquinas é o bloqueio que mais trava valor**, porque os prompts novos de Bento e Suzy não têm onde morar sem ele. Mas a Onda 2 foi desenhada de propósito para não depender disso: executando a ferramenta na borda, no worker, o Bento passa a editar task, anexar imagem e pesquisar mesmo com o serviço remoto intacto. É o caminho de maior retorno enquanto o SSH não sai.

As decisões que só o dono pode tomar, e que o executor vai bater de frente na Onda 2, são as perguntas 5, 6, 7, 8 e 9 da seção 8 da auditoria: provedor de pesquisa web e orçamento, se escrita no ClickUp começa autônoma ou com aprovação humana, GPU ou modelo melhor para o Otto, quais folders e custom fields do ClickUp importam, e se o `cerebro/` pode sair do vault do Otto. Vale responder essas cinco antes de abrir a Onda 2, senão o executor para no meio.
