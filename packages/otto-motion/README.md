# Otto Motion Engine

Motion designer agêntico dentro do chat do Otto. Conversa vira direção
criativa, direção vira código JavaScript, código vira vídeo, e o vídeo volta
pro chat revisado.

Não é um botão "gerar vídeo". O que faz o resultado ser publicitário em vez de
genérico é o Claude Opus 5.5 escrevendo composições Remotion de verdade, com o
brain do cliente na mão, e depois OLHANDO os próprios frames pra consertar o
que ficou errado.

```
conversa → direção criativa → código → motion → QA visual → iteração → MP4
```

## Como ligar

```bash
OTTO_MOTION_ENABLED=true
```

Desligado (o default), este módulo não existe para o resto do sistema: o guard
do worker devolve `null` na primeira linha, o worker da fila não é registrado e
as rotas `/motion` respondem 404. O comportamento do Otto volta a ser o de
antes, byte a byte.

## Claude Opus 5.5 é obrigatório

O único modelo aceito é `claude-opus-5-5`, e **não existe fallback**. Nem para
Sonnet, nem para o alias `opus` (que resolve pro Opus 5, não pro 5.5).

Três barreiras, porque só a primeira seria promessa e não garantia:

1. `assertMotionModel` recusa qualquer id diferente antes de gastar nada.
2. `checkClaudeConnection` confere versão da CLI e login **antes** de abrir a
   sessão — o pior desfecho seria a pessoa esperar dois minutos pra descobrir
   que o modelo nunca esteve disponível.
3. `assertModelActuallyUsed` lê o `modelUsage` que a CLI devolve e reprova a
   execução se o Opus 5.5 não estiver lá. Passar `--model` é intenção;
   `modelUsage` é fato.

Medido em 24/09/2026: com o Claude Code 2.1.263 a API respondia
`400 — version 2.1.280 or newer is required`. O modelo existia; faltava CLI.
Por isso a mensagem de `OPUS_UNAVAILABLE` manda atualizar/reconectar em vez de
sugerir outro modelo.

**Limite de uso é indisponibilidade.** Quando uma sessão falha por limite
(semanal/diário/crédito), o provider grava `claude-quota-state.json` na raiz do
runtime (`OTTO_MOTION_RUNTIME_DIR` ou `runtime/` do pacote) antes de lançar.
Dali em diante `checkClaudeConnection` devolve `OPUS_UNAVAILABLE` com "O
Claude Opus 5.5 está indisponível — limite de uso atingido." **sem gastar
chamada nenhuma** — o guard do chat falha fechado em vez de enfileirar jobs
pra bater na mesma parede. Quem reabilita é o "Testar conexão" das settings:
o `probeOpusModel` ignora o estado gravado, roda um turno real e, no sucesso,
apaga o arquivo. Não há TTL: a data de reset viaja no `detail`, e parsear
texto de erro pra expirar sozinho seria frágil por definição.

## Segurança

O agente escreve e o sistema executa — nunca o contrário. A sessão do Claude
Code roda com:

| Flag | O que fecha |
|---|---|
| `--restricted` | Read/Write/Edit confinados ao diretório do job; ignora settings de user/project/local |
| `--tools Read Write Edit Glob Grep` | **sem Bash**: o agente não executa código nenhum |
| `--strict-mcp-config --mcp-config {"mcpServers":{}}` | nenhum servidor MCP, nenhuma credencial do ambiente |
| `--permission-prompts none` | sessão headless não trava esperando alguém responder |
| `childEnv()` | allowlist de variáveis: `DATABASE_URL`, `SUPABASE_SECRET_KEY` e tokens do ClickUp não entram |

Verificado ao vivo contra a CLI real: pedir pra ler o `.env` do repositório e
escrever fora do workspace volta negado, e nenhum arquivo é criado.

Quem compila, renderiza, extrai frames e mede é este pacote, em processo
separado. O agente nunca roda o que escreveu.

## Contexto do cliente

A spec original imaginava uma pasta `CLIENTE/{brand,logos,images,videos}`. A
auditoria achou outra coisa: `arquivos clientes/` só tem markdown, e o material
visual mora no Postgres + Supabase Storage. Então o resolver lê quatro fontes
reais:

| Fonte | O que dá |
|---|---|
| `memories` kind `client.profile` | brain criativo: posicionamento, voz, cores, CTAs, restrições |
| `client_brand_kits` | logo, paleta, tipografia, tom |
| `studio_brand_kits` | referências visuais da marca |
| `studio_assets` + `project_files` | fotos, vídeos, documentos |

Todas **read-only**. O que o agente enxerga é uma cópia dentro do workspace do
job; o original nunca é tocado.

`[FALTA]` e `[CONFIRMAR]` dos BRAIN.md atravessam intactos até o prompt. Sem
paleta registrada, o motion compõe com neutros e a cor dominante das fotos do
próprio cliente — nunca com uma cor "que combine". Essa regra vem do CLAUDE.md
do projeto e é testada contra os brains reais da Envu e da D. Carvalho.

## Pipeline

```
RESOLVING_CONTEXT → PREPARING_ASSETS → PLANNING → CODING → BUILDING
→ RENDERING_PREVIEW → REVIEWING → FIXING → RENDERING_FINAL → COMPLETED
```

O que a pessoa lê no chat é "Montando o storyboard", "Renderizando preview".
`spawn`, `webpack` e PID de worker ficam no log.

**Arquivos protegidos.** `src/index.ts`, `src/Root.tsx` e `src/config.ts` são
nossos e são restaurados depois de cada passada do agente. Duração, fps e
resolução vêm do pedido; se o modelo pudesse reescrevê-los, o QA estaria
conferindo o vídeo contra o que o próprio modelo decidiu — o que não prova
nada. O `src/Motion.tsx` é do agente e nunca é sobrescrito numa iteração.

## QA

**Técnico** (§25) é medição, com piso duro: abaixo de 95/100 o motion não é
entregue. Confere arquivo, resolução, fps, duração, codec, frames pretos no
miolo, `staticFile()` apontando pro vazio e erro de runtime no browser.

**Visual** (§24) é inspeção: o agente lê os PNGs dos frames com a ferramenta
Read — imagem de verdade, não o próprio código — e procura texto cortado,
contraste ruim, safe area, logo distorcido, CTA sem tempo de leitura. Veredito
ilegível conta como `REQUIRES_FIX`: aprovar às cegas publicaria peça sem
revisão.

Os quatro scores visuais são heurística de revisor, não número de relatório.
Servem pra decidir se vale mais uma passada.

## Concorrência

Motions diferentes rodam em paralelo (`OTTO_MOTION_CONCURRENCY`, default 2).
Duas passadas no **mesmo** motion, nunca: lock em Redis por `motionId`, com
compare-and-delete no release — senão um worker cujo TTL expirou apagaria o
lock de quem assumiu depois.

## Iteração

"o CTA precisa entrar antes" não recria nada. A `MotionSession` guarda o
caminho do workspace, o projeto continua lá, e o agente recebe o código atual
com instrução de mudar a menor superfície possível. Cada render final
incrementa `render_version` e a versão anterior não é destruída.

## Mapa

```
src/
  flag.ts            fronteira do §2
  model.ts           as três barreiras do Opus 5.5
  errors.ts          erro com código estável + texto que vai pro chat
  intent/            MOTION_DESIGN vs generative video / edição / imagem
  client-context/    resolver, parser de brain, seleção de assets, cópia
  providers/         Claude Code como worker, estados de conexão, estado de quota
  prompts/           direção criativa, patch, QA visual
  render/            scaffold, bundle, render, frames
  qa/                técnico (medição) e visual (inspeção)
  store/             MotionSession, MotionRender, upload
  pipeline.ts        a orquestração
  queue.ts           fila própria (BullMQ)
  service.ts         createMotion/updateMotion/render/status — o que o Otto vê
```

## Rodar

```bash
# unitários + integração com Remotion real
pnpm --filter @desigual-os/otto-motion test

# só o caminho Remotion, à mão
pnpm --filter @desigual-os/otto-motion exec tsx src/render/render.smoke.mts

# ponta a ponta com cliente real (gasta Opus 5.5 e renderiza de verdade)
OTTO_MOTION_ENABLED=true pnpm --filter @desigual-os/worker exec \
  tsx scripts/motion-e2e.mts --cliente d-carvalho
```
