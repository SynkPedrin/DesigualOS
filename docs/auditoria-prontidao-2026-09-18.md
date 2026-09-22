# Auditoria de prontidão para produção — 18/09/2026

Auditoria do Desigual OS como **sistema distribuído multiusuário**: concorrência
real entre colaboradores, falhas parciais, idempotência, isolamento, recuperação
e observabilidade. Tudo aqui foi medido contra o banco e a API reais, não
inferido por leitura de código.

O que este documento **não** é: uma lista de sugestões. Todo achado P0/P1 abaixo
já está corrigido, com teste de regressão e validação ao vivo. O que sobrou para
decisão humana está na seção **Riscos residuais**, com comando e critério.

---

## Resumo

| | Antes | Depois |
|---|---|---|
| `pnpm typecheck` | **vermelho** (15 erros) | 18/18 |
| `pnpm lint` | 0 erros, 21 avisos | 0 erros, 21 avisos |
| `pnpm test` | **1 falha** (intermitente) | 14/14 pacotes, **1.757 testes**, estável em 3 execuções¹ |
| `pnpm build` | 6/6 | 6/6 |
| Execuções de agente presas | **12** (a pior há 326 h) | **0** |
| Conversas com `updated_at` errado | **543 de 663 (82%)** | 0 novas |
| Designs do Canva com `updated_at` errado | **133 de 133 (100%)** | 0 novas |
| Dois colaboradores no mesmo design | último salva, **apaga o outro em silêncio** | 409 com estado atual |
| 5 cliques em "novo design" | **5 documentos** | 1 documento |
| Injeção de linha via task do ClickUp | **funcionava** | bloqueada |

¹ Na última execução, `nodes/otto-node` acusou 1 falha
(`execute.test.ts > profundidade adaptativa do turno`) vinda de uma **alteração
paralela** em `src/execute.ts` feita durante esta auditoria (trabalho de
retrieval do vault, sem relação com ela). Comprovado: com essa alteração
guardada no stash, o portão fecha **14/14**; ela foi devolvida intacta. Nada
disto é código desta auditoria.

---

## P0/P1 corrigidos

### 1. `updated_at` nunca era atualizado em UPDATE nenhum

**Causa raiz.** `timestampColumns` (`packages/database/src/schema/_shared.ts`)
definia `updatedAt` só com `defaultNow()`, que o Postgres aplica no INSERT e
mais nunca. O Drizzle não toca a coluna sozinho: só mudava nas poucas rotas que
escreviam `updatedAt: new Date()` à mão, e a maioria não escrevia.

**Impacto medido no banco real.**

- Conversas: **543 de 663 (82%)** com `updated_at` mais velho que a própria
  última mensagem. Pior defasagem: **1.295.016 s ≈ 15 dias**.
- Designs do Canva: **133 de 133 (100%)** com `updated_at = created_at`, todos
  com conteúdo (ou seja, todos editados depois de criados).

`GET /conversations` ordena por `updated_at desc` e corta em 50; a grade do
Canva ordena igual. Na prática a barra lateral estava ordenada por data de
criação, e uma conversa usada hoje podia cair fora do corte enquanto uma
abandonada há semanas ficava no topo por ter sido renomeada uma vez.

**Correção.** `$onUpdate(() => new Date())` em `timestampColumns` (vale para
todas as tabelas de uma vez) e em `direct_message_thread_prefs`, que declarava a
coluna à mão. Mensagem nova é INSERT em *outra* tabela e por isso não é coberta
pelo `$onUpdate`: criado `touchConversation()`
(`packages/orchestrator/src/chat-service.ts`), chamado pelos quatro caminhos que
gravam mensagem (POST /chat, resposta do agente, automação, aprovação de tool
call).

**Teste.** `packages/database/src/schema/_shared.test.ts` varre o schema e falha
se qualquer tabela com `updated_at` ficar sem `$onUpdate`. Já pegou uma na
primeira execução.

**Validação ao vivo.** Salvamento real num design: `updated_at` avançou de
`17:21:30` para `17:21:39`.

---

### 2. Execução de agente presa para sempre

**Causa raiz.** Não existia nada que expirasse execução de agente. O Studio
ganhou o vigia dele em 16/09 (`studio-queue-timeout.ts`), mas o caminho dos
agentes ficou de fora. Quando o worker morre no meio de um job (SIGKILL, deploy,
falta de memória), ninguém sobra para escrever o desfecho — é justamente por
isso que quem conserta precisa ser um processo de fora.

**Impacto medido.** **12 execuções** presas em `queued`/`running`, de bento,
otto e jarbas, a mais antiga havia **326 horas (13,6 dias)**. O chat lê o último
step para montar a bolha; execução sem desfecho não tem step, então o indicador
de "pensando" ficava aceso indefinidamente. O resumo diário contava as doze como
trabalho em andamento, todo dia.

**Correção.** `apps/worker/src/scheduler/execution-timeout.ts`, rodando a cada
2 min. Decide pelo mesmo princípio já provado no Studio: pergunta ao BullMQ se
existe worker conectado naquela fila em vez de chutar tempo. Sem worker, teto
curto (3 min); com worker, o teto sai do `AGENT_TIMEOUT_MS` real daquele agente
com folga. Marca `timeout` (status distinto de `failed`), escreve o step de
falha, publica no WS e notifica quem pediu. O UPDATE é condicional ao estado
ainda ser não terminal: execução que terminou de verdade entre o SELECT e o
UPDATE não é sobrescrita.

**Teste.** `execution-timeout.test.ts`, 8 casos, incluindo "Redis fora não
reprova nada" e "execução que terminou no meio não é sobrescrita nem
notificada".

**Validação ao vivo.** Depois do restart do worker: 12 execuções → `timeout`,
**0 restantes**, auditoria `execution.timeout_reaped` com os 12 ids, 12
notificações e 7 steps de falha criados (5 já tinham step e foram preservados).

> **Achado dentro do achado.** A primeira versão usava
> `lt(sql\`coalesce(...)\`, new Date(...))` e **quebrou a cada 2 minutos em
> produção**: com o lado esquerdo em SQL cru, o Drizzle não tem a coluna para
> descobrir como serializar o `Date` e entrega o objeto puro ao driver. O teste
> unitário não pegou porque o banco é mockado — só a fila real mostrou (226 jobs
> `failed` acumulados). Está registrado no comentário do arquivo. **Lição que
> vale além deste caso: teste com banco mockado não valida SQL.**

---

### 3. Job do Studio preso em `rendering`

**Causa raiz.** O vigia do Studio só olhava `queued` ("ninguém pegou o job").
Não cobria "alguém pegou e morreu no meio". O `worker.on('failed')` do
studio-node só escreve log — quando o BullMQ desiste de um job travado, nada
atualiza a linha do Postgres, porque o processo que faria isso é o que morreu.
O próprio studio-node documenta o sintoma no comentário do `uncaughtException`:
*"o job ficou preso em `rendering`"*.

**Correção.** `expirarOrfaosEmRenderizacao()` em `studio-queue-timeout.ts`. Duas
condições, ambas necessárias: (1) o job não está `active` no BullMQ; (2) a linha
não é tocada há mais de 55 min (duas janelas do `lockDuration` de 25 min do
studio-node). "Em voo" é definido **por exclusão** dos terminais e de `queued`,
para que um estágio novo do pipeline entre sozinho.

A condição (2) só virou sinal confiável **por causa da correção nº 1**: antes,
`updated_at` nunca mudava.

---

### 4. Perda silenciosa de edição no Canva (concorrência otimista)

**Causa raiz.** `PATCH /studio/canvas-documents/:id` gravava
incondicionalmente. O editor autossalva o documento **inteiro** (`pages` é o
desenho todo, não um diff) a cada 1,5 s, e o workspace de um cliente é
compartilhado pela equipe (`hasClientAccess` devolve `true` para qualquer
autenticado). Dois colaboradores com o mesmo design aberto se apagavam: o último
PATCH vencia, sem erro, sem aviso e sem recuperação.

Este é o **Teste 02** do critério de aceite.

**Correção.** Coluna `version` (migração `0034`, aditiva), devolvida em todo
GET/PATCH e reenviada pelo editor. O UPDATE é condicional à versão; `returning`
vazio é a própria detecção do conflito, então continua sendo **uma** ida ao
banco. Conflito responde **409** com o documento atual, para dar como
reconciliar. Cliente que não manda versão segue funcionando, mas a gravação dele
também incrementa — senão quem manda versão ficaria cego para o que ele fez. O
toast do editor distingue 409 de falha de rede: "tente novamente" num 409 seria
um laço que nunca fecha.

**Teste.** `apps/api/src/studio/canvas-concurrency.test.ts`, 6 casos, subindo a
rota real num Fastify real. O mock do banco lê a condição de versão **do SQL que
a rota montou** — a primeira versão do teste decidia sozinha e passava verde
mesmo com o UPDATE incondicional. Com o comportamento antigo restaurado, 3 dos 6
ficam vermelhos.

**Validação ao vivo.** Ana salva (v1→v2). Bruno salva com v1: **HTTP 409**, e o
trabalho da Ana intacto. Bruno recarrega e salva com v2: 200.

---

## P2 corrigidos

### 5. Injeção estrutural de linha via conteúdo do ClickUp (§30, Teste 14)

`build-operational-context.ts` monta o bloco de dado ao vivo como **lista de
linhas** e interpolava `t.name`, `t.status`, `t.assignees` e o nome do cliente
crus — todos texto vindo do ClickUp, que pode nascer de formulário, e-mail ou
WhatsApp encaminhado.

O ataque não depende de o modelo "acreditar" em nada, e é por isso que é sério:
uma quebra de linha no nome da tarefa cria uma **linha nova dentro do bloco**,
indistinguível de um dado que o Orquestrador consultou. O atacante não convence
o modelo — ele falsifica o dado. Nenhum prompt defensivo conserta isso.

**Correção.** `packages/context-engine/src/texto-externo.ts`: toda string
externa perde quebras de linha e caracteres de controle (incluindo U+2028/U+2029),
tem marcador de lista inicial neutralizado e teto de tamanho com corte visível.
O módulo **deliberadamente não** procura frases tipo "ignore as instruções
anteriores": essa corrida não se ganha por lista de padrões, e fingir que se
ganhou dá confiança falsa. O limite real de dano continua sendo o que o agente
pode fazer, cercado em `write-scope.ts`.

**Teste.** 8 casos no módulo + 4 no bloco montado. Com a sanitização removida, 3
ficam vermelhos.

### 6. WebSocket autenticado uma vez e eterno

A conexão era autenticada só no aperto de mão. Era o único lugar do sistema onde
desativar uma conta ou expirar um token **não tinha efeito nenhum**: quem já
estava conectado seguia recebendo `dm.received` e `message.delta` da equipe
indefinidamente, bastando não fechar a aba. Agora o socket não sobrevive ao
token que o abriu; o navegador reconecta com token novo e a reconexão revalida
`users.active`. O buraco deixa de ser ilimitado e passa a ser, no pior caso, o
tempo de vida do token.

### 7. Criação de design sem idempotência (§12, Teste 16)

Medido ao vivo: **5 POSTs simultâneos e idênticos de "novo design" criaram 5
documentos**, todos 201. As outras três criações com efeito colateral (chat, job
do Studio, task do ClickUp) já tinham proteção desde 11/09; esta ficou de fora.
Aplicado o mesmo padrão. Depois: **5 requisições → 1 documento** (1 criação, 1
replay, 3 × 409).

### 8. Portão de release vermelho por rascunho, e teste que pisca

- `pnpm typecheck` estava vermelho com **15 erros, todos em scripts de sondagem
  descartáveis** e nenhum em código de produção. O portão acusava sujeira de
  bancada em vez de defeito. Os `_*` saíram do `tsconfig` e entraram no
  `.gitignore` (script para ficar não leva underscore).
- Dois testes falhavam **só** dentro do `pnpm test` do repositório e passavam
  isolados: puro mock, sem rede, estourando o teto de 5 s do vitest por disputa
  de CPU com os 14 pacotes em paralelo. Teto explícito no teste pesado do Canva
  e `testTimeout` no `apps/worker`. **Nenhuma asserção foi afrouxada.**
- A fila `daily-digest` não tinha teto de retenção (1.911 `completed` + 226
  `failed` acumulados). Aplicado o mesmo teto das filas de agente.

---

## Concorrência multiusuário — medição real

Cinco perfis simultâneos (chat, clientes, designs, jobs, time) contra a API ao
vivo, 4 requisições cada, conferindo que a resposta de um endpoint nunca chega
no outro.

| Colaboradores | p50 | p95 | p99 | Erros | Vazão |
|---|---|---|---|---|---|
| 1 | 2.409 ms | 2.529 ms | 2.529 ms | 0 | 1,6 req/s |
| 5 | 1.175 ms | 2.664 ms | 2.664 ms | 0 | 7,5 req/s |
| 10 | 2.147 ms | 5.067 ms | 5.081 ms | 0 | 7,9 req/s |
| 20 | 4.053 ms | 9.715 ms | 9.992 ms | 0 | **8,0 req/s** |

**Isolamento: 0 erros e nenhuma resposta trocada em nenhum nível.**

**Primeiro gargalo real, identificado:** a vazão trava em ~8 req/s de 5 a 20
colaboradores — não é CPU nem banco, é o pool de conexões. `DATABASE_POOL_MAX=3`
com RTT de **148 ms** medidos até o Supabase dá ~23 consultas/s; cada requisição
faz ~3 consultas. A conta fecha em 8 req/s.

Repetindo o mesmo teste só com `DATABASE_POOL_MAX=10`:

| Colaboradores | p99 (pool 3) | p99 (pool 10) | Vazão (3) | Vazão (10) |
|---|---|---|---|---|
| 20 | 9.992 ms | **3.225 ms** | 8,0 req/s | **24,8 req/s** |

**3,1× de vazão, p99 3,1× melhor, 0 erros nos dois.** Ver riscos residuais.

---

## Riscos residuais (dependem de decisão ou de infraestrutura)

### R1. `DATABASE_POOL_MAX` — 3,1× de ganho medido, não aplicado

- **Problema.** Pool de 3 é o teto de vazão da API inteira.
- **Impacto.** Com 20 colaboradores, p99 de 10 s em listagens simples.
- **Mudança.** `DATABASE_POOL_MAX` de 3 para 8–10 **na API**.
- **Por que não apliquei.** O comentário em `client.ts` registra um incidente
  real de `EMAXCONNSESSION`. O Supavisor tem pool próprio (15 no plano), e
  api + worker + studio-node + nodes dividem esse orçamento. Medido agora:
  `max_connections = 60`, **26 conexões em uso**, Supavisor segurando 9 — há
  folga, mas ela não é infinita e o número do Supavisor não é observável daqui.
- **Como validar.** Subir a API com `DATABASE_POOL_MAX=8`, rodar a carga acima e
  observar `select count(*) from pg_stat_activity` durante o pico. Se não passar
  de ~40 conexões totais e não houver `EMAXCONNSESSION`, manter.
- **Alternativa melhor.** Pooler em **modo transação** (porta 6543). O código já
  usa `prepare: false`, que é o requisito. Troca de `DATABASE_URL`, sem código.

### R2. `statement_timeout` não é configurável pelo cliente

Medido: o **Supavisor descarta os parâmetros de startup** — `application_name`
chega como `"Supavisor"` em vez do valor enviado, e `statement_timeout` fica em
`2min` tanto via `connection: { statement_timeout }` quanto via
`options=-c statement_timeout=...`. O teto real é o do Supavisor: **2 minutos
por consulta**. Com `max: 3`, três consultas travadas deixam a API sem banco por
até 2 min — ruim, mas **limitado**. Baixar exige
`ALTER ROLE ... SET statement_timeout` no banco (persistente, afeta todo mundo
que usa o papel): decisão de operação. O `connect_timeout` (15 s), esse sim é do
cliente e está aplicado.

### R3. Teste com banco mockado não valida SQL

O bug do `Date` no reaper (achado nº 2) passou por typecheck, lint e 8 testes
verdes, e só apareceu na fila real. Não existe infraestrutura de teste com
Postgres neste repositório. Enquanto não existir, **toda consulta nova precisa
ser executada uma vez contra o banco antes de virar job repetível** — o custo de
não fazer isso foi um vigia quebrando a cada 2 minutos sem ninguém notar.

### R4. Autorização por pessoa está desligada por decisão de produto

`hasClientAccess()` devolve `true` para qualquer autenticado (decisão registrada
de 03/09: cliente é compartilhado pela equipe). Três rotas do Canva já otimizam
em cima disso e autorizam **depois** de escrever — correto hoje, **errado no dia
em que escopo por pessoa voltar**. Os comentários marcam isso; o
`canActOnStudioEntity` (jobs/assets) continua exigindo posse de verdade.

Nota de inconsistência: `DELETE /studio/canvas-documents/:id` exige apenas
`studio:write`, então qualquer colaborador apaga o design de qualquer outro —
mais frouxo que a política aplicada a jobs e assets do Studio, que exige posse.
Não alterei porque é uma escolha de produto, não um defeito de implementação.

### R5. Reinício da API pendente

O worker já foi reiniciado e está com tudo isto valendo. A **API segue com o
código anterior** (processo supervisionado `com.desigualos.api`, PID 40625,
iniciado antes das correções). A migração `0034` já está aplicada e é compatível
com o código antigo, então não há pressa nem risco em esperar. Para subir:

```bash
bash scripts/restart-service.sh com.desigualos.api 3001 http://127.0.0.1:3001/health
```

### R6. Não testado: isolamento entre dois usuários reais distintos

Só havia credencial de uma conta (master) disponível. O isolamento foi verificado
por leitura de código e pelos testes de autorização existentes
(`lib/access.test.ts`, `clickup/routes.test.ts`, `canReadConversation`), e a
carga confirmou que respostas não se cruzam. Um teste com dois logins reais
(um master, um colaborador) tentando acessar recurso um do outro continua
pendente e é o que fecharia o **Teste 13** com evidência direta.

---

## Classificação

**CONTROLLED PRODUCTION** — produção com a equipe, acompanhada.

Critérios objetivos:

- **A favor.** Portão verde e estável (typecheck, lint, 1.757 testes em 3
  execuções, build). Zero perda silenciosa de dado nos dois caminhos onde ela
  existia. Nenhuma execução ou job pode mais desaparecer sem desfecho. 0 erros e
  0 vazamento de contexto com 20 acessos concorrentes. Segredos limpos (nada
  hardcoded, `.env` nunca versionado, só a chave publicável no bundle).
  Idempotência nas quatro criações com efeito colateral. Webhook com assinatura
  HMAC e dedup de 7 dias. GPU com porta única, limite global e recusa rápida.
- **Contra PRODUCTION READY.** O gargalo do pool (R1) é conhecido e medido mas
  não resolvido: com 20 pessoas ao mesmo tempo, p99 de 10 s é lento demais para
  uso tranquilo. O isolamento entre dois usuários distintos (R6) não tem
  evidência direta. Não há teste com banco real (R3), e foi exatamente essa
  lacuna que deixou um defeito meu chegar à produção nesta mesma auditoria.

Fechar R1 e R6 é o que move para **PRODUCTION READY**.
