# Desigual Node Agent

Node Agent genérico que roda em cada Mac Mini de agente (Bento, Jarbas ou Suzy). É a camada
que o Orchestrator central chama para despachar um turno real de chat para o OpenClaw que já
roda naquela máquina (regra de ouro 2: "não substituir os agentes existentes, OpenClaw e os
agentes já existem nas máquinas, o Orchestrator é camada de coordenação por cima, não
reescrita", ver `brain/01 - Regras de Ouro.md`).

Em produção existem três cópias deste mesmo código rodando, uma por máquina, cada uma com seu
próprio `.env` (`AGENT_NAME=bento`, `AGENT_NAME=jarbas` ou `AGENT_NAME=suzy`).

## O que ele faz

- Expõe um servidor Fastify local (porta 4001 por padrão) com:
  - `GET /health`: liveness simples.
  - `GET /status`: status do agente e uptime.
  - `GET /capabilities`: lista as capabilities declaradas em `CAPABILITIES`.
  - `POST /execute`: recebe uma tarefa do Orchestrator e chama o OpenClaw local via CLI
    (`nodes/desigual-node/src/openclaw/client.ts`), protegido por `NODE_SECRET` compartilhado.
- No boot, se registra no Orchestrator (`POST /nodes/register`) e depois manda heartbeat
  periódico (`POST /nodes/:node_id/heartbeat`, a cada `HEARTBEAT_INTERVAL_MS`) com CPU/RAM/disco
  reais da máquina e o status do agente.
- Se `OBSIDIAN_VAULT_PATH` estiver configurado, injeta contexto local do vault Obsidian do
  agente (regra de ouro 1: o vault nunca é sincronizado para o servidor central, só lido
  localmente por este processo).

## Pré-requisitos

- Node.js 20 ou superior (`node -v`), mesma versão do `engines` do monorepo.
- pnpm 9.9.0 (`packageManager` no `package.json` raiz). Instale com `corepack enable` ou
  `npm install -g pnpm@9.9.0`.
- **OpenClaw já configurado e funcionando nesta máquina**, com um agente cadastrado (via
  `openclaw agents add`) para o `AGENT_NAME` que este node vai representar. Este node não
  instala nem substitui o OpenClaw, só chama o binário já existente via CLI local (regra de
  ouro 2, acima). Sem isso, `POST /execute` falha em toda chamada.
- Tailscale instalado e conectado na mesma tailnet do Orchestrator e dos outros nodes (regra de
  ouro 3: nenhuma máquina exposta publicamente, toda comunicação passa por Tailscale).
- O `NODE_SECRET` desta máquina precisa ser exatamente o mesmo configurado no `.env` do
  Orchestrator (`apps/api`), e o nome do agente (`bento`, `jarbas` ou `suzy`) precisa já existir
  na tabela `agents` do banco (populada por `pnpm db:seed`, rodado uma vez do lado do
  Orchestrator).
- Opcional: caminho local de um vault Obsidian, se este agente tiver um (`OBSIDIAN_VAULT_PATH`).

## Instalação

1. Leve o código desta pasta (`nodes/desigual-node`) para a máquina. Como o projeto é um
   monorepo pnpm (`workspace:*` entre pacotes), o jeito confiável é clonar/copiar o **monorepo
   inteiro** para a máquina e rodar os comandos abaixo dentro de `nodes/desigual-node`, não
   copiar só esta pasta isolada (os imports `@desigual-os/logging`, `@desigual-os/node-protocol`
   e `@desigual-os/types` são resolvidos via symlink do workspace, não existem como pacotes
   publicados).

   ```bash
   git clone <url-do-repositorio> desigual-os
   cd desigual-os
   pnpm install
   ```

2. Copie o exemplo de variáveis de ambiente e preencha para esta máquina específica:

   ```bash
   cd nodes/desigual-node
   cp .env.example .env
   ```

   Preencha pelo menos: `NODE_ID` (ex: `NODE_BENTO_01`, `NODE_JARBAS_01` ou `NODE_SUZY_01`),
   `AGENT_NAME` (`bento`, `jarbas` ou `suzy`, precisa bater com o nome já seedado no banco),
   `PRIVATE_HOST` (hostname MagicDNS desta máquina na tailnet, nunca IP público),
   `ORCHESTRATOR_URL` (endereço do Orchestrator na rede privada) e `NODE_SECRET` (igual ao do
   Orchestrator). Veja os comentários de cada variável no próprio `.env.example`.

3. Build de produção:

   ```bash
   pnpm build
   ```

## Rodar em produção

**Atualizado em 08/09/2026:** este node ganhou o mesmo bundler esbuild que já resolvia o problema
em `apps/api`/`apps/worker` ([ADR 0002](../../docs/architecture/decisions/0002-module-resolution-bundler.md),
ver `nodes/desigual-node/build.mjs`). Antes disso, `pnpm build` (`tsc` puro) gerava um
`dist/index.js` com imports sem extensão de arquivo que o Node não resolvia
(`ERR_MODULE_NOT_FOUND` na inicialização) - confirmado e corrigido nesta sessão, com um boot real
validado localmente. `pnpm build && pnpm start` funciona hoje:

```bash
pnpm build
NODE_ENV=production node dist/index.js
```

### macOS (launchd), Mac Minis do Bento/Jarbas/Suzy

Rode `pnpm build` uma vez antes de configurar o launchd (o `dist/index.js` precisa existir).
Confirme o caminho real do `node` nesta máquina com `which node` (varia com nvm/Homebrew/instalador
oficial - `/usr/local/bin/node` abaixo é só o default mais comum, ajuste se for diferente) e ajuste
`WorkingDirectory` para o caminho real do clone nesta máquina:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.desigualos.desigual-node</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/caminho/completo/desigual-os/nodes/desigual-node</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/desigual-node.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/desigual-node.error.log</string>
</dict>
</plist>
```

As demais variáveis (`NODE_ID`, `AGENT_NAME`, `NODE_SECRET` etc.) não precisam entrar no plist:
o `config.ts` já carrega `nodes/desigual-node/.env` sozinho via `dotenv`, independente de quem
chamou o processo.

Carregar e iniciar:

```bash
launchctl load ~/Library/LaunchAgents/com.desigualos.desigual-node.plist
launchctl start com.desigualos.desigual-node
```

Para parar/desativar: `launchctl unload ~/Library/LaunchAgents/com.desigualos.desigual-node.plist`.

## Como confirmar que o Orchestrator está enxergando este node

Depois de subir, o processo se registra sozinho no Orchestrator e começa a mandar heartbeat a
cada `HEARTBEAT_INTERVAL_MS` (10s por padrão). Em poucos segundos ele aparece:

- Na tela de Monitoramento do app, com o `node_id` configurado (ex: `NODE_BENTO_01`), status
  `online` e métricas reais de CPU/RAM/disco desta máquina.
- Via API: `GET /health/infrastructure` (autenticado, permissão `nodes:read`) lista este node
  dentro do array `nodes`.

Atenção: isso é uma entrada **separada** da que a sonda automática do Orchestrator já mantém
para `bento-qa`/`agentes-desigual` (o serviço de Q&A legado que já roda nessas máquinas,
sondado independentemente a cada 10s por `packages/orchestrator/src/agent-probe.ts`, sem
depender deste node). As duas aparecem lado a lado no Monitoramento; este README cobre só a
entrada deste Node Agent (a que atende `POST /execute` para o despacho de chat).

## Troubleshooting

- **Node não aparece no Monitoramento / heartbeat rejeitado com 401:** `NODE_SECRET` desta
  máquina não bate com o do `.env` do Orchestrator. Confirme os dois valores exatamente iguais.
- **Registro falha com "Unknown agent":** o nome em `AGENT_NAME` não existe na tabela `agents`
  do banco. Rode `pnpm db:seed` do lado do Orchestrator (uma vez só, já popula bento/jarbas/
  suzy/studio/otto).
- **Heartbeat nunca chega / node fica offline:** confirme que o Tailscale está conectado nesta
  máquina (`tailscale status`) e que `ORCHESTRATOR_URL` aponta para um host alcançável dentro da
  tailnet, não `localhost` (a menos que o Orchestrator realmente rode nesta mesma máquina).
- **`POST /execute` falha sempre:** confirme que o OpenClaw está instalado e respondendo
  localmente (`openclaw agents list` ou equivalente) e que `OPENCLAW_AGENT_ID` (se preenchido)
  bate com o id cadastrado lá.
- **Porta 4001 já em uso:** outro processo (ou uma segunda cópia deste node) já está rodando
  nela. Ajuste `PORT` no `.env` se precisar rodar mais de uma instância na mesma máquina (não é
  o caso normal em produção).
