# Otto Node Agent

Node Agent especializado do Otto (direção criativa). Hoje roda como um Node Agent genérico
local (mesma máquina de dev), preparado para migrar para uma máquina dedicada mais tarde sem
mudar de código, só de configuração.

## O que ele faz

- Expõe um servidor Fastify local (porta 4002 por padrão) com `GET /health`, `GET /status`,
  `GET /capabilities` e `POST /execute`, mesmo protocolo dos demais Node Agents (protegido por
  `NODE_SECRET` compartilhado).
- No boot, se registra no Orchestrator (`POST /nodes/register`) e depois manda heartbeat
  periódico, igual ao `desigual-node`.
- Ao receber uma tarefa em `POST /execute`, chama um LLM local via Ollama (não usa OpenClaw:
  o Otto não tem um agente OpenClaw próprio, é raciocínio direto contra um modelo local) para
  gerar plano criativo, carrossel, plano de vídeo, prompt de imagem, spec de produção ou revisão
  de qualidade (`OTTO_CAPABILITIES` em `src/config.ts`).
- Lê localmente o vault de conhecimento criativo/estratégico (`Brain-Marketing/`) apontado por
  `OTTO_BRAIN_PATH`, sem nunca sincronizá-lo para o servidor central (mesmo princípio da regra
  de ouro 1 aplicado ao vault do Otto).

## Pré-requisitos

- Node.js 20 ou superior e pnpm 9.9.0 (mesmas versões do resto do monorepo).
- **Ollama instalado e rodando localmente**, com o modelo configurado em `OTTO_MODEL` (padrão
  `mistral`) já baixado (`ollama pull mistral` ou o modelo escolhido).
- A pasta `Brain-Marketing/` acessível no caminho apontado por `OTTO_BRAIN_PATH` (por padrão,
  relativo ao diretório de onde o processo é iniciado: veja a nota abaixo sobre `cwd`).
- Tailscale conectado na mesma tailnet do Orchestrator, se este node rodar fora da máquina de
  dev (regra de ouro 3).
- O `NODE_SECRET` desta máquina precisa ser igual ao do `.env` do Orchestrator, e o agente
  `otto` precisa já existir na tabela `agents` do banco (populada por `pnpm db:seed`).

## Instalação

1. Como os demais nodes, este pacote depende de `workspace:*` de outros pacotes do monorepo
   (`@desigual-os/logging`, `@desigual-os/node-protocol`, `@desigual-os/otto`,
   `@desigual-os/types`), então clone/copie o **monorepo inteiro**, não só `nodes/otto-node`:

   ```bash
   git clone <url-do-repositorio> desigual-os
   cd desigual-os
   pnpm install
   ```

2. Copie o exemplo de variáveis de ambiente e preencha:

   ```bash
   cd nodes/otto-node
   cp .env.example .env
   ```

   Preencha pelo menos `ORCHESTRATOR_URL`, `NODE_SECRET` e, se este node migrar para uma máquina
   dedicada, `PRIVATE_HOST` (host real na tailnet em vez do `localhost` padrão). Veja os
   comentários de cada variável no `.env.example`.

   **Nota sobre `OTTO_BRAIN_PATH`:** o caminho é resolvido relativo ao `cwd` do processo no
   momento em que ele inicia (`resolve(data.OTTO_BRAIN_PATH)` em
   `packages/otto/src/llm/config.ts`), não relativo à pasta deste node. Rode o processo sempre a
   partir de um diretório onde `./Brain-Marketing` (ou o caminho que você configurar) exista de
   verdade, ou use um caminho absoluto.

3. Build de produção:

   ```bash
   pnpm build
   ```

## Rodar em produção

**Atualizado em 08/09/2026:** este node ganhou o mesmo bundler esbuild dos demais
([ADR 0002](../../docs/architecture/decisions/0002-module-resolution-bundler.md), ver
`nodes/otto-node/build.mjs`). `pnpm build && pnpm start` funciona hoje (boot real validado
localmente). O `OTTO_BRAIN_PATH` relativo (nota acima) continua resolvido a partir do `cwd` do
processo em runtime - isso não muda com o bundle, então siga rodando a partir da raiz do
monorepo, ou use um caminho absoluto no `.env`:

```bash
cd desigual-os
NODE_ENV=production node nodes/otto-node/dist/index.js
```

### macOS (launchd)

Rode `pnpm build` uma vez antes de configurar o launchd/systemd (o `dist/index.js` precisa
existir). Mesmo padrão dos outros nodes. Repare que `WorkingDirectory` aqui é a **raiz do
monorepo**, não a pasta do node, por causa do `OTTO_BRAIN_PATH` relativo (ajuste se preferir usar
um caminho absoluto no `.env` em vez disso); confirme o caminho real do `node` com `which node`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.desigualos.otto-node</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>nodes/otto-node/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/caminho/completo/desigual-os</string>
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
  <string>/tmp/otto-node.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/otto-node.error.log</string>
</dict>
</plist>
```

`launchctl load ~/Library/LaunchAgents/com.desigualos.otto-node.plist && launchctl start com.desigualos.otto-node`

### Linux (systemd, exemplo genérico, caso o Otto também migre para uma máquina Linux)

```ini
[Unit]
Description=Desigual OS - Otto Node Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=otto
WorkingDirectory=/caminho/completo/desigual-os
Environment=NODE_ENV=production
ExecStart=/usr/bin/node nodes/otto-node/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Como confirmar que o Orchestrator está enxergando este node

Igual ao `desigual-node`: depois de subir, o processo se registra sozinho e manda heartbeat a
cada `HEARTBEAT_INTERVAL_MS` (10s por padrão). Em poucos segundos ele aparece:

- Na tela de Monitoramento, com o `node_id` configurado (`NODE_OTTO_01` por padrão), status
  `online`.
- Via API: `GET /health/infrastructure` lista este node dentro do array `nodes`, agente `otto`.

A sonda do Orchestrator também faz uma checagem independente e complementar em
`PROBE_OTTO_HOST/health` (por padrão `http://localhost:4002/health`, ver `.env.example` raiz do
Orchestrator), então mesmo antes do primeiro heartbeat chegar o node já pode aparecer como
alcançável se `GET /health` responder.

## Troubleshooting

- **Node não aparece / heartbeat com 401:** `NODE_SECRET` desta máquina não bate com o do
  `.env` do Orchestrator.
- **Registro falha com "Unknown agent":** rode `pnpm db:seed` do lado do Orchestrator (já popula
  o agente `otto`, entre os demais).
- **`POST /execute` falha ou trava:** confirme que o Ollama está rodando
  (`curl http://localhost:11434/api/tags`) e que `OTTO_MODEL` está baixado localmente. Chamadas
  de plano criativo são longas (JSON grande); `OTTO_LLM_TIMEOUT_MS` (120s por padrão) pode
  precisar subir em máquinas mais lentas.
- **Não acha `Brain-Marketing/`:** veja a nota sobre `OTTO_BRAIN_PATH` ser relativo ao `cwd` do
  processo, na seção de instalação acima. Use caminho absoluto se preferir não depender de onde
  o processo é iniciado.
- **Heartbeat nunca chega:** confirme Tailscale conectado (se este node já tiver migrado para
  fora da máquina de dev) e `ORCHESTRATOR_URL` alcançável.
