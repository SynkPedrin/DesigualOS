# Otto Motion Engine — decisões de arquitetura

24/09/2026. Feature nova e isolada, atrás de `OTTO_MOTION_ENABLED`. Nenhuma
mudança de comportamento no Otto, nos outros agentes ou no Studio.

O manual de uso está em [`packages/otto-motion/README.md`](../../packages/otto-motion/README.md).
Aqui ficam só as decisões e o que foi medido pra tomá-las.

---

## 1. O que a auditoria achou de diferente da spec

A spec desenhava uma pasta de cliente com `brand/`, `logos/`, `images/`,
`videos/`, `fonts/`, e mandava descobrir a estrutura real antes de presumir.
A estrutura real é outra:

| A spec supunha | O que existe |
|---|---|
| pasta do cliente com mídia | `arquivos clientes/` tem 123 arquivos, todos `.md`, zero imagem |
| assets em disco | `studio_assets` no Postgres + Supabase Storage |
| brandbook por cliente | `client_brand_kits` preenchido para **1** dos 58 clientes |
| identidade visual documentada | dos 33 BRAIN.md, **um** tem cor e fonte confirmadas (D. Carvalho) |

Consequência direta: o `ClientContextResolver` lê banco, não filesystem, e foi
escrito para degradar com dignidade. Um cliente sem paleta não ganha uma cor
"que combine" — ele ganha um `[FALTA]` que atravessa até o prompt, e o motion
se resolve com neutros e a cor dominante das fotos do próprio cliente.

Isso não é preciosismo: é a regra 3 do `CLAUDE.md` deste repositório aplicada a
um lugar novo onde ela é fácil de violar sem ninguém perceber.

## 2. Claude Opus 5.5: o que estava errado nesta máquina

`claude-opus-5-5` existe. O que faltava era CLI:

```
$ claude --version                    # 2.1.263
$ claude -p --model claude-opus-5-5 …
API Error: 400 Claude Code 2.1.263 does not support this model;
version 2.1.280 or newer is required.
```

Depois do `claude update` (2.1.281) a mesma chamada voltou normal, com
`modelUsage: { "claude-opus-5-5": … }`.

Por isso o estado `OPUS_UNAVAILABLE` manda **atualizar/reconectar**, não trocar
de modelo — e por isso `checkClaudeConnection` confere versão antes de abrir
qualquer sessão. Sem essa checagem, a tela diria "Conectado" e o motion
falharia no meio do job, sem ninguém entender por quê.

**Três barreiras, não uma:** id recusado antes de gastar, provider conferido
antes de abrir sessão, e `modelUsage` lido depois. Passar `--model` é intenção;
`modelUsage` é fato. É o que fecha a porta do fallback silencioso.

## 3. Por que Claude Code e não a API

O §6 do pedido: cada geração pela API Anthropic viraria conta de token
direta. O worker usa o binário oficial em `--print`, autenticado pela conta
`claude.ai` da agência (plano team). Custo medido de um motion completo de 10s,
com storyboard + código + build + 2 passadas de QA visual: **US$ 2,44**.

Nada de automação visual de terminal: é `spawn` de processo, `--output-format
json` no stdout, prompt por stdin.

Duas pegadinhas reais da CLI, achadas na marra:

1. `--tools`, `--add-dir` e `--mcp-config` são **variádicos**. Prompt como
   argumento posicional depois deles é engolido como mais um valor da flag
   (`Input must be provided either through stdin or as a prompt argument`).
   Daí o prompt ir por stdin — o que também resolve limite de tamanho de
   argumento, e os prompts daqui são longos.
2. `--mcp-config '{}'` é rejeitado; precisa de `{"mcpServers":{}}`.

## 4. A fronteira de segurança

O agente **escreve**; quem **executa** é o pipeline. A sessão roda sem Bash,
sem MCP, sem settings do usuário e confinada ao diretório do job.

Verificado ao vivo contra a CLI real: pedindo pra ler o `.env` do repositório e
escrever fora do workspace, as três tentativas voltaram em
`permission_denials` e nenhum arquivo foi criado.

O ambiente do processo filho é uma **allowlist** (`childEnv`), não o
`process.env` do worker — que carrega `DATABASE_URL`, `SUPABASE_SECRET_KEY` e
tokens do ClickUp. Herdar isso daria de graça exatamente o que o §13 manda não
dar.

## 5. Onde o workspace mora, e por quê

`packages/otto-motion/runtime/motions/motion_<id>/` — dentro do pacote, não em
`runtime/` na raiz.

Razão técnica, não estética: o bundler do Remotion resolve `react` e `remotion`
subindo a árvore de `node_modules` a partir do arquivo de entrada. Com pnpm não
existe `node_modules` hoisted na raiz — só o link farm de cada pacote. Workspace
dentro do pacote significa que o projeto gerado enxerga
`packages/otto-motion/node_modules` **sem `npm install` por job**: sem rede, sem
minutos de instalação, e sem o agente puxar dependência arbitrária.

Configurável por `OTTO_MOTION_RUNTIME_DIR`. Ignorado pelo git (tem cópia de
material de cliente e este repositório é público).

## 6. Arquivos protegidos

`src/index.ts`, `src/Root.tsx` e `src/config.ts` são do pipeline e restaurados
depois de cada passada do agente. Duração, fps e resolução vêm do pedido.

Se o modelo pudesse reescrevê-los, o QA técnico estaria conferindo o vídeo
contra o que o próprio modelo decidiu — o que não prova nada. `src/Motion.tsx` é
do agente, e numa iteração nunca é sobrescrito (§43).

## 7. Detecção de intenção: onde foi conservador de propósito

O §15 lista "cria um reels" como `MOTION_REQUEST`. Mas `reels` é um
`STUDIO_JOB_TYPES` que já funciona em produção: o caminho
Otto → `production_spec` → `studio-jobs` → GPU. Interceptar o pedido puro
quebraria comportamento existente.

Com a ordem de prioridade do §51 ("1. não quebrar o sistema atual"), o
desempate foi ficar de fora: `cria um reels` segue o caminho de hoje,
`cria um reels animado` entra no Motion Engine. Está testado nos dois sentidos.

Na dúvida, o detector devolve `null` — e `null` significa "o turno segue
exatamente como seguia antes".

## 8. QA: medição e inspeção não se misturam

**Técnico** é medição, com piso duro de 95/100. Abaixo disso o motion não é
entregue, porque o arquivo não é o que foi pedido — e isso não é gosto.

**Visual** é inspeção: o agente lê os PNGs dos frames com a ferramenta Read
(imagem de verdade, não o próprio código) e procura texto cortado, contraste,
safe area, logo distorcido, CTA sem tempo de leitura. Veredito ilegível conta
como `REQUIRES_FIX`: aprovar às cegas publicaria peça sem revisão.

Os quatro scores visuais são checklist de revisor, não número de relatório.
Eles decidem se vale mais uma passada, e nada além disso.

Um defeito real que o QA técnico pegou durante o desenvolvimento: H.264 exige
dimensão par, e o preview de um 1080×1920 a scale 0,375 sai **404×720**, não
405×720. A conta virou `encodedDimension()` em vez de o teste ser afrouxado —
QA que acusa defeito onde não há ensina a ser ignorado.

## 9. Concorrência

Fila própria (`otto-motion`), não a `queue-otto`. A fila do Otto é
conversacional e roda com concurrency 1: um motion de 19 minutos deixaria a
equipe inteira esperando pra fazer uma pergunta.

Lock por `motionId` em Redis, com compare-and-delete no release — sem isso, um
worker cujo TTL expirou apagaria o lock de quem assumiu depois. `lockDuration`
do BullMQ em 30min: render longo com o padrão de 30s faria o job ser
considerado abandonado no meio, e dois processos entrariam no mesmo workspace.

## 10. Integração com o Otto: quatro pontos, só

| Arquivo | Mudança |
|---|---|
| `apps/worker/src/processors/execute-job.ts` | 1 import + 1 bloco `if (!guardedResult)`, depois dos guards que já existiam |
| `apps/worker/src/index.ts` | registra o worker da fila só com a flag ligada |
| `apps/api/src/server.ts` | 1 import + 1 `register` |
| `apps/api/src/conversations/routes.ts` | expõe `metadata.motion` na listagem de mensagens |

O guard devolve `null` na primeira linha com a flag desligada, e erro dele
nunca derruba o turno: o `catch` volta pro caminho normal do Otto.

## 11. Prova

```
pnpm test        16/16 tarefas · worker 699 · otto-motion 131 · sem regressão
pnpm typecheck   limpo
pnpm lint        0 erros
```

E2E real (`apps/worker/scripts/motion-e2e.mts`), cliente D. Carvalho:
MP4 1080×1920, 30fps, 10s, 4,2MB, QA técnico 100/100, modelo gravado
`claude-opus-5-5`, US$ 2,44, 19 minutos.

## 12. O que ficou fora, de propósito

- **Áudio** (§37): arquitetura não impede, V1 não implementa.
- **Biblioteca de componentes** (§21): a estrutura existe; promover componente
  bom pra lá é trabalho de uso, não de scaffold. Forçar o agente a usar só a
  biblioteca seria prisão criativa, que o próprio §21 proíbe.
- **Botão "Conectar Claude" com OAuth**: não existe mecanismo oficial pra um
  worker de servidor fazer login de conta a partir de um clique na web. O card
  mostra o estado real (`claude auth status`) e a instrução exata que resolve.
  Inventar um endpoint seria autenticação falsa.
- **ChatGPT**: adapter e UI prontos, reconhecendo a credencial oficial que a
  plataforma aceita (`OPENAI_API_KEY`, hoje vazia no `.env`). `motionCapable`
  é `false` por construção, não por configuração.
