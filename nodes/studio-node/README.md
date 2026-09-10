# Studio Node Agent

Node Agent que roda no PC com a GPU (RTX) e processa a fila de jobs do Studio via BullMQ,
usando o ComfyUI já instalado na mesma máquina. Este README cobre só a instalação/infraestrutura
deste node (como colocar a máquina no ar); a lógica de geração em si (prompts, ComfyUI, custo de
GPU) é tratada em outro lugar e não faz parte deste documento.

## O que ele faz

- Consome a fila BullMQ de jobs do Studio (mesmo Redis do Orchestrator) e, para cada job, chama
  o ComfyUI local para gerar a peça pedida.
- Sobe um servidor HTTP mínimo próprio na porta `METRICS_PORT` (4100 por padrão) com
  `GET /metrics`, protegido pelo mesmo `NODE_SECRET` compartilhado: é dali que a sonda do
  Orchestrator lê CPU, disco, uso de GPU e temperatura reais desta máquina
  (`nodes/studio-node/src/metrics-server.ts`).
- **Diferente do `desigual-node` e do `otto-node`, este node não se autorregistra nem manda
  heartbeat** (não há `POST /nodes/register` no seu código). Ele é puramente um worker BullMQ
  mais este servidor de métricas; a saúde dele é sempre lida por sondagem direta do Orchestrator
  (ComfyUI + `/metrics`), não por um cadastro ativo.

## Pré-requisitos

- Node.js 20 ou superior e pnpm 9.9.0 (mesmas versões do resto do monorepo).
- **ComfyUI já instalado e rodando localmente nesta máquina**, com um checkpoint Flux disponível
  (o node só chama a API HTTP do ComfyUI, não instala nem gerencia o ComfyUI).
- **GPU NVIDIA com drivers instalados** (a leitura de uso de GPU/temperatura usa `nvidia-smi` via
  linha de comando; sem ele, `/metrics` simplesmente devolve `gpu: null` e `temperature: null`,
  não quebra, mas a tela de Monitoramento fica sem esses dois números).
- Tailscale conectado na mesma tailnet do Orchestrator e dos demais nodes (regra de ouro 3).
- Acesso de rede ao mesmo Redis do Orchestrator (fila BullMQ) e às mesmas credenciais Supabase
  (Storage, para subir os assets gerados).
- Chrome ou Chromium instalado localmente, com `CHROME_PATH` apontando para o executável (usado
  pelo renderer de carrossel em HTML via `puppeteer-core`).
- O `NODE_SECRET` desta máquina precisa ser igual ao do `.env` do Orchestrator.

## Instalação

1. Assim como os outros nodes, este pacote depende de `workspace:*` de outros pacotes do
   monorepo (`@desigual-os/database`, `@desigual-os/logging`, `@desigual-os/orchestrator`,
   `@desigual-os/types`), então clone/copie o **monorepo inteiro** para esta máquina, não só
   `nodes/studio-node`:

   ```bash
   git clone <url-do-repositorio> desigual-os
   cd desigual-os
   pnpm install
   ```

2. Copie o exemplo de variáveis de ambiente e preencha para esta máquina:

   ```bash
   cd nodes/studio-node
   cp .env.example .env
   ```

   Preencha pelo menos `NODE_ID`, `PRIVATE_HOST` (host desta máquina na tailnet), `REDIS_URL`
   (apontando para o Redis do Orchestrator), `SUPABASE_URL`/`SUPABASE_SECRET_KEY`,
   `COMFYUI_URL` (endereço local do ComfyUI, normalmente `http://localhost:8188` se rodar na
   própria máquina, ou o IP Tailscale dela se o Orchestrator sondar de fora), `CHROME_PATH` e
   `NODE_SECRET`. Veja os comentários de cada variável no `.env.example`.

3. Build de produção:

   ```bash
   pnpm build
   ```

## Rodar em produção

**Atualizado em 08/09/2026:** este node ganhou o mesmo bundler esbuild que já resolvia o problema
em `apps/api`/`apps/worker` ([ADR 0002](../../docs/architecture/decisions/0002-module-resolution-bundler.md),
ver `nodes/studio-node/build.mjs`) - com uma diferença importante em relação ao `desigual-node`:
aqui `sharp` (addon nativo compilado por plataforma) e `puppeteer-core` (referencia um binário de
browser real) ficam de fora do bundle (`external`), só os pacotes `@desigual-os/*` são empacotados.
Empacotar os dois quebraria em runtime. `pnpm build && pnpm start` funciona hoje (boot real
validado localmente):

```bash
pnpm build
NODE_ENV=production node dist/index.js
```

Não confirmamos com o usuário, neste momento, se o PC do Studio roda Windows ou Linux (um
documento de contexto anterior do projeto, `DESIGUAL_OS_CONTEXT_RECOVERY.md`, menciona "PC
Windows com RTX 4090", mas trate isso como indício, não certeza: outro documento do vault cita
"RTX 5090" para a mesma máquina, ou seja, os dois registros já divergem entre si). As duas
opções abaixo cobrem macOS (caso a máquina mude) e Linux; **confirme o sistema operacional real
dessa máquina com o usuário antes de aplicar qualquer uma das duas**. Se for Windows, o
equivalente é registrar como Serviço do Windows (NSSM ou similar) chamando o mesmo comando
`tsx src/index.ts`, fora do escopo deste documento.

### macOS (launchd)

Rode `pnpm build` uma vez antes de configurar o launchd/systemd (o `dist/index.js` precisa
existir). Mesmo padrão do `desigual-node`, trocando o `Label` e o caminho - confirme o caminho
real do `node` nesta máquina com `which node` antes de aplicar:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.desigualos.studio-node</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/caminho/completo/desigual-os/nodes/studio-node</string>
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
  <string>/tmp/studio-node.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/studio-node.error.log</string>
</dict>
</plist>
```

`launchctl load ~/Library/LaunchAgents/com.desigualos.studio-node.plist && launchctl start com.desigualos.studio-node`

### Linux (systemd, exemplo genérico)

Crie `/etc/systemd/system/desigual-os-studio-node.service` (ajuste usuário e caminhos):

```ini
[Unit]
Description=Desigual OS - Studio Node Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=studio
WorkingDirectory=/caminho/completo/desigual-os/nodes/studio-node
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /caminho/completo/desigual-os/nodes/studio-node/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now desigual-os-studio-node
```

## Como confirmar que o Orchestrator está enxergando este node

Como este node não se registra ativamente, a confirmação é indireta: a sonda do Orchestrator
(`packages/orchestrator/src/agent-probe.ts`) tenta alcançar, a cada 10 segundos, o ComfyUI
(`PROBE_STUDIO_HOST:8188`) e o `/metrics` deste próprio node (`PROBE_STUDIO_HOST:4100/metrics`,
autenticado com `NODE_SECRET`). Se os dois responderem, o agente `studio` aparece `online` na
tela de Monitoramento e em `GET /health/infrastructure`, com métricas reais de RAM/VRAM/fila
(do ComfyUI) e CPU/disco/GPU/temperatura (deste node). Não é preciso reiniciar nada do lado do
Orchestrator: a próxima rodada da sonda já pega a máquina assim que ela responder.

Para checar manualmente antes disso, direto na máquina:

```bash
curl http://localhost:8188/system_stats            # ComfyUI respondendo
curl -H "Authorization: Bearer $NODE_SECRET" http://localhost:4100/metrics   # este node
```

## Troubleshooting

- **Studio aparece offline no Monitoramento:** confirme que o ComfyUI está rodando
  (`curl http://localhost:8188/system_stats` local) e que a porta 8188 está alcançável a partir
  do Orchestrator pela Tailscale (`PROBE_STUDIO_HOST` no `.env` do Orchestrator precisa apontar
  para o host certo desta máquina).
- **Studio aparece "degraded" (não offline):** o worker BullMQ e o ComfyUI podem estar de pé,
  mas o `/metrics` deste node está falhando. Confira `NODE_SECRET` (precisa bater com o do
  Orchestrator) e se a porta `METRICS_PORT` (4100) está aberta na Tailscale.
- **Jobs não são processados (fila acumulando):** confirme que `REDIS_URL` neste `.env` aponta
  para o mesmo Redis do Orchestrator e que a máquina alcança essa porta pela rede. Veja também
  `docs/runbook.md`, seção sobre fila do BullMQ travada.
- **`nvidia-smi: command not found` nos logs:** normal em máquina sem GPU NVIDIA ou sem os
  drivers instalados; `/metrics` continua respondendo, só sem `gpu`/`temperature`.
