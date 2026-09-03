---
tags: [fase, desigual-os, enxame, tailscale, infraestrutura]
status: parcial
---

# Ligação das 4 máquinas reais ao Orchestrator (2026-09-02)

Missão: entender o `swarm-api` (o "enxame"), analisar Bento/Jarbas/Suzy/Studio, e desenhar como conectar os 4 ao Orchestrator do Desigual OS via Tailscale. Tudo abaixo é reconhecimento real (SSH nas 4 máquinas via um VPS que agora faz parte da mesma rede Tailscale), não suposição.

## VPS do Orchestrator, na rede Tailscale

VPS real (LocaWeb, Debian 12, 8GB RAM, 4 vCPUs): `vps37685.publiccloud.com.br`, IP público `191.252.203.180`, acesso root via SSH. Tailscale instalado e conectado: hostname `vps-orchestrator`, IP Tailscale `100.99.14.75`. É a partir dela que dou os próximos passos (o Orchestrator real vai rodar aqui quando formos pra produção; hoje uso ela só como ponte SSH pra alcançar as outras máquinas, já que minha sessão de trabalho não está na rede Tailscale).

## As 3 arquiteturas de agente que existem de verdade (achado crítico)

Antes de "linkar" qualquer coisa, descobri que existem **três sistemas de agente diferentes e sobrepostos** rodando de verdade:

1. **OpenClaw nativo**: configurado em Bento e Suzy (`~/.openclaw/`), cada um com seu próprio `bento-autoconfig.md`/equivalente. Não é o que atende cliente de verdade hoje.
2. **"enxame" / swarm-api**: sistema de filas distribuído, só no Bento (worker) hoje, com painel/CLI/SDKs. Ver seção própria abaixo.
3. **"Agentes Desigual"** (`~/susy-service`, nome do pacote `agentes-desigual`): plataforma Express (porta 3102) rodando na máquina da Suzy, gerenciada por PM2. **Esta é a fonte de verdade confirmada pelo usuário**: é ela que fala com WhatsApp (Evolution API), Instagram e ClickUp de clientes reais.

**Decisão confirmada com o usuário**: Bento se conecta via "enxame" (é o único dos três sistemas que ele realmente usa pra operação); Jarbas e Suzy se conectam via "Agentes Desigual".

## O "enxame" (swarm-api), protocolo SWARM v1

Código-fonte real em `~/enxame/packages/` no Bento (deployado via rsync, sem git nessa máquina; o repositório git de verdade vive num MacBook do Endrigo que não investiguei).

- **Onde roda**: só o Bento, porta 8787, bind duplo (`100.93.182.83:8787` Tailscale + `127.0.0.1:8787` loopback), nunca `0.0.0.0`. Stack: Fastify 5 + pg + ioredis.
- **5 verbos**: `POST /v1/tasks` (publica), `POST /v1/tasks/claim` (long-poll, um nó pega trabalho), `POST /v1/tasks/:id/renew` (renova lease), `POST /v1/tasks/:id/result` (reporta resultado), `POST /v1/heartbeat` (nó se anuncia, devolve kill switch).
- **Leitura**: `GET /v1/events` (SSE via LISTEN/NOTIFY do Postgres, `?since_id=N` pra backfill), `GET /v1/nodes`, `GET /v1/queue`, `GET /health`.
- **Autenticação**: token por nó (hash sha256), **dois eixos independentes**: `capabilities` (reivindicar/executar, usado por `claim`/`heartbeat`) e `publish_capabilities` (publicar, usado por `tasks`), mais um bit `is_admin` (kill switch). Token emitido OFFLINE no Bento via `scripts/issue-token.js`, nunca por HTTP (problema clássico de bootstrap). Achado de segurança real documentado no próprio projeto: até a migration 017, `POST /tasks` não conferia escopo nenhum, e qualquer token publicava `capability: shell` com comando arbitrário.
- **`node_id` é vocabulário fechado**: só existem 5, semeados em `swarm-db/scripts/seed.js`, não dá pra inventar um novo (`bento`, `jarbas`, `suzy`, `gpu` são workers/proxy; **`macbook` é o único puramente "client", sem capabilities própria, exatamente o papel de um painel/orchestrator externo**).

| node_id | node_kind | capabilities (claim) | papel real |
|---|---|---|---|
| `bento` | worker | shell, code, memory | worker real, `bento-worker-1` |
| `jarbas` | worker | notify, shell, code | worker (mas o Jarbas real de clientes é via "Agentes Desigual", não aqui) |
| `suzy` | worker | shell, code, memory | idem acima |
| `gpu` | proxy (proxied_by bento) | gpu | representa a RTX 4090 do Studio |
| `macbook` | client | (nenhuma) | "posto de comando", CLI/SDK, sem agente — **é este que uso** |

## Token real emitido pro Orchestrator (2026-09-02)

Com autorização explícita do usuário, emiti eu mesmo, escopo mínimo, pra validar a conexão:

```
node scripts/issue-token.js --node macbook --publish browser --label "Desigual OS Orchestrator - hello swarm test only"
```

Token (id 30, node_id=macbook, publish=browser, claim=nenhuma, admin=não) guardado só em `.env` (`ENXAME_TOKEN`, `ENXAME_SWARM_API_URL=http://100.93.182.83:8787`), nunca em arquivo versionado ou de vault.

**"Hello swarm" confirmado de ponta a ponta**: publiquei `POST /v1/tasks {capability: "browser", payload: {...}}` (capability sem worker de produção, seguro) e recebi o evento real via SSE em `/v1/events`: `{"tipo":"task.created","task_id":656,...}`. O mecanismo publish → evento funciona de verdade.

**Testado de verdade contra o worker real (2026-09-02)**: emiti um segundo token (`publish: memory`) e publiquei uma tarefa `{capability: "memory", payload: {op: "query", q: "...", limit: 3}}`. Via SSE, confirmei que o `bento-worker-1` reivindicou a tarefa de verdade (`task.claimed`), mas ela falhou (`task.failed`, `code: "dependency_unavailable"`, `"memory-api indisponível: fetch failed"`).

**Causa raiz encontrada (bug real de infraestrutura, não é bug meu)**: o executor `memory.js` usa `MEMORY_API_URL = process.env.ENXAME_MEMORY_API_URL || "http://127.0.0.1:8790"` como default. Só que o `memory-api` real só escuta em `100.93.182.83:8790` (a interface Tailscale), **nunca em `127.0.0.1`** (confirmei: `curl http://127.0.0.1:8790/health` não retorna nada, `lsof` mostra o LISTEN só na interface Tailscale). Se `ENXAME_MEMORY_API_URL` não estiver setado no ambiente do `enxame-agent`, ele tenta `127.0.0.1` e falha com "fetch failed" (erro de conexão, não de autenticação) — bate exatamente com o que eu vi. **Fix esperado**: setar `ENXAME_MEMORY_API_URL=http://100.93.182.83:8790` no `agent.env` do `enxame-agent` no Bento. Não apliquei essa mudança sozinho (é escrever num arquivo de config de produção no Bento, que a própria missão pediu pra confirmar antes).

**Achado importante sobre a capability `memory`**: ela não é um "chat" genérico com o Bento. Lendo `executors/memory.js`, ela só faz busca semântica no vault (`op: "query"`), reindexação (`op: "index"`) ou esquecer um contexto (`op: "forget"`) — fala com o `memory-api`, não com nenhum LLM. **Não existe hoje nenhuma capability no enxame pra "fazer uma pergunta e receber uma resposta em linguagem natural" do Bento.** Pra isso funcionar de verdade (o pedido do usuário: Bento respondendo dentro do Desigual OS e no ClickUp), seria preciso adicionar um executor novo ao `enxame-agent` (ex: `capability: "chat"` ou similar, que faz a busca semântica E depois sintetiza uma resposta via LLM) — isso é código novo em produção real, não fiz isso sem confirmar o desenho com o usuário/Endrigo primeiro.

## "Agentes Desigual" (Jarbas + Suzy)

Roda na máquina da Suzy (`100.86.237.73`), Express na porta 3102, PM2. Confirmado ao vivo via `GET /health`: `{"agents":[{"name":"suzy"}],"ollama":true,"vault":{"documents":575}}`. Só a Suzy aparece ativa nessa instância; o Jarbas real provavelmente roda como instância própria na máquina dele (não confirmado, SSH bloqueado lá, ver seção Jarbas).

Arquitetura (do próprio README):
```
WhatsApp cliente/equipe → Evolution API → webhook /whatsapp/webhook/:instance
  → agentRegistry roteia pro agente certo (jarbas ou suzy)
  → agente responde via Ollama (grátis) ou enfileira pro Claude CLI (mais caro)
  → fila processa com cooldown de 30s → resposta via Evolution API
```

**Gap real pra conectar ao Orchestrator**: hoje só existe entrada via webhook do WhatsApp, não existe uma porta HTTP tipo "pergunta e recebe resposta" que o Orchestrator possa chamar de fora. Decisão do usuário: criar um endpoint interno novo (`POST /internal/ask` ou equivalente) no código do `susy-service`, autenticado, sem mexer no fluxo de WhatsApp/Instagram que já funciona com clientes reais. **Ainda não implementado**, é o próximo passo de código (mexer em produção real, preciso ler `agents/jarbas/index.js` e `agents/suzy/index.js` primeiro pra reusar a mesma lógica de resposta em vez de duplicar).

## Jarbas (máquina física, `mac-mini-de-jarbas`, `100.118.12.97`): resolvido

**SSH resolvido (2026-09-02)**: o usuário real não é "JARBAS", é **`jarbas-desigual`**. Login confirmado.

**Arquitetura real do Jarbas, mapeada de ponta a ponta**: essa máquina roda `agentes-desigual` (PM2, porta 3102, a MESMA plataforma da Suzy, mas essa instância aqui reporta `jarbas` ativo) + `evolution-api` (WhatsApp) + `segundocerebro-api` (três instâncias: normal, `-claudewin`, `-desigual`, portas 3101/3103/3105) + n8n (porta 5678) + Redis/Postgres locais.

**Já existe um sistema real e funcionando de resposta a menção no ClickUp** (não usa "enxame", não usa LLM customizado): ClickUp → n8n (webhook) → `clickup-webhook-server.py` (listener local, porta 8765) → `clickup-webhook.sh` (dispatcher, filtra e dispara) → `respond-mention.sh`, que chama **o próprio CLI do Claude Code** (`claude -p "$(cat mention-prompt.md) ... task_id=... comment_id=..." --model sonnet --allowedTools "Bash,Read,Grep"`). O prompt manda o Claude: ler o card (`clickup-get.sh`), ler a thread de comentários (curl direto na API do ClickUp com o token de `clickup.env`), puxar dado real de Meta/Google Ads se for pergunta de performance, e responder na thread via `clickup-reply.sh`. Regras de formatação reais documentadas no prompt (ClickUp não renderiza markdown: nada de `**negrito**`, tabelas ou `#`, usar emoji/`•`/`·`).

**Isso é exatamente o padrão certo pra replicar pro Bento** (responder por menção usando o próprio Claude Code lendo o vault via `Read`/`Grep`, sem precisar de nenhuma API de busca separada) — resolve sozinho a exigência do usuário de "respostas vindas de dentro do brain". Ainda não construí a versão do Bento: falta decidir como rotear a menção do ClickUp até uma máquina que não tem esse n8n/webhook hoje (ver seção "Pendente" abaixo).

## Studio (`desktop-itra471`, Windows, `100.107.198.50`)

GPU real: **RTX 4090** (24GB VRAM), não RTX 5090 como o documento original assumia. Login: usuário `desigual`, real short name do Windows.

Rodando de verdade (confirmado, portas + processos + versão real via API):
- **ComfyUI** (porta 8188, versão 0.28.0, rodando como serviço via conta `desigual-gpu`, gerenciado pelo Pinokio: `C:\pinokio\bin\miniforge\python.exe main.py`)
- **Ollama** (porta 11434) — é o LLM local que o "Agentes Desigual" usa (`OLLAMA_URL=http://desktop-itra471:11434` no `.env` do susy-service)
- **Whisper server** próprio (porta 8000, `C:\ProgramData\desigual\whisper-server\server.py`) — transcrição de áudio, não geração de mídia
- Painel de status "desigual-status" (porta 3000, app estático servido por `serve`)
- Duas instalações do ComfyUI via Pinokio: `C:\pinokio\api\comfy.git` (a que está rodando) e `comfy1.git` (parada)

### Processo de criação real dentro do ComfyUI (`comfy.git`)

- **Foto**: **Flux.2 Dev** (fp8) de verdade instalado (`models/diffusion_models/flux2_dev_fp8mixed.safetensors`). Dois workflows salvos, e são bem diferentes um do outro (conferido node por node, não é suposição):
  - **`image_flux2.json`**: geração local de verdade, sem custo de API. O grafo tem um grupo colapsado (aparece como um `type` estranho tipo UUID na interface nova do ComfyUI) cujos widgets internos (`unet_name`, `clip_name`, `vae_name`, `lora_name`, `text`, `noise_seed`) confirmam o pipeline clássico: carrega o Flux.2 do disco, sem chamar nenhuma API paga. **Este é o caminho certo pro Studio do Desigual OS chamar.**
  - **`api_flux2.json`**: usa o nó `Flux2ProImageNode`, que é uma chamada real à **API paga da Black Forest Labs** (nuvem), montado especificamente pra combinar 4 fotos de referência num retrato de grupo (prompt de exemplo salvo fala de "quatro personagens"). Não é geração genérica, é um experimento específico, com custo real por chamada.
  - **Próximo passo pra integrar de verdade**: preciso do grafo expandido em "formato API" do `image_flux2.json` (o grupo colapsado esconde os node IDs reais dentro dele). O jeito mais confiável é alguém com acesso à interface do ComfyUI abrir esse workflow e usar "Export (API format)" no menu, me mandando o JSON resultante — reconstruir isso às cegas por SSH arriscaria montar o grafo errado.
- **Vídeo**: existem workflows salvos pra **LTX-V** (`ltxv_image_to_video.json`, Lightricks) e **Wan 2.2 5B** (`video_wan2_2_5B_fun_control.json`), mas **não confirmei se os pesos desses modelos de vídeo estão baixados de verdade** (só vi o Flux.2 como arquivo presente; não testei rodar um gerando vídeo de verdade porque isso gastaria GPU/tempo real e o usuário pediu só testes internos). Isso precisa ser confirmado antes de prometer "gerar vídeo" na UI do Studio.
- **Reels**: não existe um modelo dedicado. O recurso mais próximo é o nó customizado **Depthflow** (`ComfyUI-Depthflow-Nodes`), que cria um efeito de paralaxe/movimento numa foto parada — bom pra "foto que se move" tipo Reels, mas não é geração de vídeo do zero.
- **Upscale**: **não configurado**. `models/upscale_models` vazio nas duas instalações do ComfyUI. Não dá pra fazer upscale de verdade nessa máquina até alguém baixar um modelo (ex: Real-ESRGAN) pra essa pasta.
- Outros nós instalados: `ComfyUI-Manager`, `comfyui_controlnet_aux` (ControlNet).

### Desenho pedido pelo usuário pro Studio

Objetivo: o Studio dentro do Desigual OS vira uma "IDE" simples pro colaborador (que não sabe usar Pinokio/ComfyUI), com tutorial animado passo a passo; o processo real de criação continua rodando exatamente igual no Desktop (Flux.2/ComfyUI via `api_flux2.json`), o Desigual OS só manda o pedido e mostra o resultado de volta. Isso mapeia direto em cima do que já existe no backend (`nodes/studio-node` + `POST /studio/jobs`, construído numa fase anterior com um gerador stub): o próximo passo de código é trocar o gerador stub por uma chamada real à API do ComfyUI em `desktop-itra471:8188` usando o workflow `api_flux2.json`, sem tocar em nada na máquina do Desktop (só consumir a API HTTP que já está exposta ali). Vídeo/upscale/reels ficam documentados como limitação real até os modelos/pesos serem confirmados ou instalados.

## Pendente (próximos passos de código, nenhum feito ainda)

1. Trocar o gerador stub do `nodes/studio-node` por uma chamada real ao ComfyUI (`api_flux2.json`) pra foto — o único caminho hoje confirmado como realmente funcional.
2. Escrever o cliente do swarm-api dentro do Orchestrator (`packages/`, provavelmente um novo pacote leve, já que o SDK `@enxame/client` não está publicado em registry nenhum e vive só no monorepo do enxame) — usar o token `macbook` já emitido.
3. Descobrir o formato de payload real que `bento-worker-1` espera numa tarefa de `capability: memory` antes de tentar conversar com o Bento de verdade (não simular isso sem confirmar).
4. Adicionar `POST /internal/ask` (ou nome equivalente) no `susy-service` pra Jarbas e Suzy, lendo primeiro `agents/jarbas/index.js` e `agents/suzy/index.js` pra reusar a lógica de resposta já existente em vez de duplicar.
5. Responder menção/DM no ClickUp (Bento, Jarbas e Suzy): pedido novo do usuário, ainda não desenhado em detalhe. Bento por enquanto só precisa funcionar dentro do Desigual OS + ClickUp (sem WhatsApp/Instagram); Jarbas/Suzy mantêm WhatsApp/Instagram e ganham ClickUp como canal adicional.
6. Resolver o acesso SSH do Jarbas (Login Remoto parece não incluir o usuário "JARBAS" na lista de permitidos dessa máquina específica).
