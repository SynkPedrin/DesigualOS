# Runbook de operação - Desigual OS

Guia prático para quem está de plantão. Objetivo: dado um problema real (sistema fora do ar,
agente offline, fila travada), saber o próximo passo sem precisar ler o código primeiro.

Este documento cobre o Orchestrator (`apps/api` + `apps/worker`, rodando no VPS via
`docker-compose.prod.yml`) e como ele se relaciona com os Node Agents das máquinas físicas. Não
cobre a lógica interna de geração do Studio (ComfyUI, prompts, fila `studio-jobs`): isso é
tratado à parte.

## 1. Subir o sistema do zero (VPS)

Pré-requisito: um VPS com Docker e Docker Compose instalados, na mesma tailnet dos Node Agents
(Tailscale conectado nele também), e um domínio apontando para o IP dele (necessário para TLS e
para o webhook do ClickUp, que precisa de URL pública).

1. **Clonar o repositório no VPS:**

   ```bash
   git clone <url-do-repositorio> desigual-os
   cd desigual-os
   ```

2. **Preparar o `.env` de produção**, a partir do exemplo:

   ```bash
   cp .env.example .env
   ```

   Preencha todas as variáveis relevantes (veja os comentários de cada uma no próprio arquivo):
   Supabase, `DATABASE_URL`, `NODE_SECRET` (mesmo valor que vai em todo Node Agent, ver seção 2),
   `REDIS_PASSWORD` (novo, só para produção, usado pelo `docker-compose.prod.yml`), chaves de
   modelo de IA, tokens de integração que você realmente usa. As variáveis marcadas no arquivo
   como "não lida em nenhum código deste repositório hoje" podem ficar em branco.

3. **Instalar dependências e aplicar o schema no banco** (direto do host do VPS, não dentro de
   container: `pnpm db:migrate`/`db:seed` falam com o Supabase pela `DATABASE_URL`, não
   precisam da API/worker no ar ainda):

   ```bash
   corepack enable
   pnpm install
   pnpm db:migrate
   pnpm db:seed
   ```

   `pnpm db:seed` é seguro para rodar em produção e seguro para rodar mais de uma vez: só
   popula dados de referência do sistema (os 5 agentes, os 2 papéis de RBAC e a matriz de
   permissões por ferramenta), sempre com `onConflictDoNothing` (nunca sobrescreve nem duplica o
   que já existe). Não cria usuário nem dado de cliente nenhum.

4. **Subir Redis, API e worker:**

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   Confirme que os três serviços ficaram saudáveis:

   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```

   Todos devem aparecer como `healthy` em pouco menos de um minuto (healthchecks com
   `start_period` de 10-15s). Se algum ficar `unhealthy`, veja a seção 3 (agente/serviço fora do
   ar) e os logs: `docker compose -f docker-compose.prod.yml logs -f api` (troque `api` por
   `worker` ou `redis`).

5. **Nginx + TLS na borda:** siga `docs/deploy/vps-nginx.conf.example` (troque
   `SEU_DOMINIO_AQUI` pelo domínio real, rode o certbot). A API fica só em `127.0.0.1:3001` no
   host (ver `docker-compose.prod.yml`); é o Nginx quem expõe `443` para fora, com TLS.

6. **Registrar o webhook do ClickUp** (precisa da URL pública já no ar): siga a seção
   correspondente no fluxo de integrações do ClickUp (`POST /team/{team_id}/webhook` da API do
   ClickUp, apontando para `https://SEU_DOMINIO_AQUI/clickup/webhook` ou a rota configurada),
   usando o mesmo valor de `CLICKUP_WEBHOOK_SECRET` do `.env`.

Neste ponto o Orchestrator está no ar, mas **nenhum agente aparece online ainda**: os Node
Agents rodam nas máquinas físicas, fora do VPS. Continue na seção 2.

## 2. Registrar um Node novo (Mac Mini ou PC do Studio)

Não duplicado aqui de propósito: siga o `README.md` da pasta do node correspondente, que já
cobre pré-requisitos, instalação, como rodar em produção (launchd/systemd) e como confirmar que
o Orchestrator está enxergando a máquina.

- `nodes/desigual-node/README.md`: Bento, Jarbas ou Suzy (Mac Minis).
- `nodes/studio-node/README.md`: PC com a GPU (RTX).
- `nodes/otto-node/README.md`: Otto (direção criativa).

O ponto em comum entre os três: o `NODE_SECRET` da máquina precisa ser **exatamente igual** ao
`NODE_SECRET` do `.env` do Orchestrator (passo 2 da seção 1 acima), e a máquina precisa estar
conectada na mesma tailnet.

## 3. Um agente aparece offline no Monitoramento

A tela de Monitoramento (e `GET /health/infrastructure`) reflete o que a sonda do Orchestrator
mediu de verdade, a cada 10 segundos (`packages/orchestrator/src/agent-probe.ts`), não um
heartbeat que pode estar velho. Se um agente aparece `offline` ou `degraded`, siga nesta ordem:

1. **A máquina está ligada e com o Tailscale conectado?** Na própria máquina do agente:

   ```bash
   tailscale status
   ```

   Se não aparecer conectada, esse é o problema: reconecte o Tailscale primeiro, o resto
   normaliza sozinho no próximo ciclo da sonda (até 10s depois).

2. **O serviço específico daquele agente está rodando na máquina?** Cada agente depende de um
   processo diferente, todos na mesma máquina Mac Mini/PC:

   | Agente | Serviço sondado | Porta padrão |
   |--------|------------------|---------------|
   | Bento  | `bento-qa` (crítico), `swarm-api`/`memory-api` (auxiliares) | 8791, 8787, 8790 |
   | Jarbas | `agentes-desigual` (susy-service) | 3102 |
   | Suzy   | `agentes-desigual` (susy-service) | 3102 |
   | Studio | ComfyUI + `/metrics` do studio-node | 8188, 4100 |
   | Otto   | `otto-node` (`GET /health`) | 4002 |

   Confirme que o processo do serviço da tabela está de pé na máquina (ex: `curl
   http://localhost:PORTA/health` ou o endpoint equivalente da tabela, direto na máquina). Se não
   estiver, reinicie esse processo local (fora do escopo deste runbook o "como", varia por
   serviço/máquina).

   Se for **Bento** e só `swarm-api` ou `memory-api` caiu (não o `bento-qa`), o agente aparece
   como `degraded`, não `offline`, e **o chat continua funcionando normalmente**: esses dois são
   auxiliares (busca de contexto extra), não bloqueiam o despacho.

3. **`NODE_SECRET`/tokens batendo?** Um 401 nos logs da API (`docker compose -f
   docker-compose.prod.yml logs api | grep -i "credentials\|401"`) na hora de registrar/heartbeat
   de um Node Agent (`desigual-node`/`otto-node`) indica `NODE_SECRET` divergente entre a máquina
   e o `.env` do Orchestrator. Para os serviços legados sondados diretamente (`bento-qa`,
   `susy-service`/`agentes-desigual`, `memory-api`), confira os tokens específicos deles
   (`BENTO_QA_TOKEN`, `AGENTES_ASK_TOKEN`, `BENTO_MEMORY_API_TOKEN` no `.env` do Orchestrator)
   contra o que está configurado na máquina do agente.

4. **Se nada disso resolver:** use o botão "Sincronizar" na tela de Monitoramento (equivalente a
   `POST /health/sync`), que roda a sonda na hora e devolve um diagnóstico com sugestão por
   serviço, incluindo o que o próprio sistema já corrigiu sozinho (nodes de teste órfãos, por
   exemplo).

## 4. A fila do Orchestrator travou (jobs acumulando, worker não processa)

Isto é sobre as filas do `apps/worker` (uma por agente, `queue-bento`/`queue-jarbas`/
`queue-suzy`/`queue-studio`/`queue-otto`, mais `automations`), não sobre geração de conteúdo do
Studio em si.

1. **O worker está de pé?**

   ```bash
   docker compose -f docker-compose.prod.yml ps worker
   docker compose -f docker-compose.prod.yml logs -f worker
   ```

   Se o container está reiniciando em loop, o log geralmente mostra o motivo direto (erro de
   conexão com o Redis ou com o Supabase costuma ser o mais comum).

2. **O Redis está de pé e alcançável?**

   ```bash
   docker compose -f docker-compose.prod.yml exec redis redis-cli -a "$REDIS_PASSWORD" ping
   ```

   Deve responder `PONG`. Se não responder, o problema é o Redis, não o worker: veja
   `docker compose -f docker-compose.prod.yml logs redis`.

3. **Quantos jobs estão parados em cada fila?** BullMQ guarda cada fila no Redis com o prefixo
   `bull:<nome-da-fila>:*`. Para inspecionar de fora:

   ```bash
   docker compose -f docker-compose.prod.yml exec redis redis-cli -a "$REDIS_PASSWORD" \
     LLEN bull:queue-bento:wait
   docker compose -f docker-compose.prod.yml exec redis redis-cli -a "$REDIS_PASSWORD" \
     LLEN bull:queue-bento:active
   ```

   Troque `queue-bento` por `queue-jarbas`, `queue-suzy`, `queue-studio`, `queue-otto` ou
   `automations` conforme a fila que você quer checar. `wait` alto e `active` zerado com o worker
   rodando é o sintoma clássico de worker travado (perdeu o lock de algum job e não está
   consumindo mais).

4. **Reiniciar o worker** costuma resolver: um restart limpo faz o BullMQ redetectar jobs
   travados (`stalled`) além do tempo de lock e redistribuí-los.

   ```bash
   docker compose -f docker-compose.prod.yml restart worker
   ```

5. Se o problema for recorrente (não só um incidente isolado), vale registrar como débito
   técnico: hoje não existe painel de inspeção de fila (tipo Bull Board) nem retry com
   idempotência garantida no `apps/worker` (job reprocessado do zero pode gerar efeito duplicado
   em alguns casos, ex: cobrança/registro de custo). Considerar adicionar as duas coisas antes de
   operar volume alto.

## 5. Backup de dados

**Risco real, não amenizado:** o projeto está hoje no **plano FREE do Supabase**. Esse plano
**não tem Point-in-Time Recovery (PITR)** real. Isso significa que, se algo apagar ou corromper
dados por engano (bug, comando errado, ataque), a capacidade de restaurar para um ponto exato no
tempo antes do problema é limitada ao que o plano free oferece (bem menor do que PITR de
verdade). `apps/api/src/health/routes.ts` já é honesto sobre isso: `last_backup_at` na tela de
Monitoramento é sempre `null` porque **não existe hoje nenhum sistema de backup implementado**
neste repositório além do que o próprio Supabase mantém no seu plano.

**Recomendação explícita:** antes de operar com dado real de cliente em produção (não só dados
de teste), considere seriamente o upgrade para o **plano Pro do Supabase**, que inclui PITR de
verdade. O custo do upgrade é bem menor que o custo de perder dado de cliente sem conseguir
recuperar. Isso não é um "nice to have" de longo prazo, é uma lacuna real de hoje.

Enquanto estiver no plano free, para reduzir o risco na marra: exporte dumps manuais
periodicamente (`pg_dump` contra a `DATABASE_URL`, guardado fora do Supabase) até decidir sobre
o upgrade.

## 6. Alertas

Desde 08/09/2026 existe um gancho de alerta real (`sendOpsAlert`, em
`packages/orchestrator/src/alerts.ts`), disparado automaticamente em dois pontos:

- **Agente caiu**: `packages/orchestrator/src/agent-sync.ts`, só na TRANSIÇÃO de
  online/degraded para offline (não repete a cada ciclo de 10s enquanto segue offline).
- **Job esgotou as tentativas**: `apps/worker/src/index.ts`, quando um job de execução
  ou de automação falha na ÚLTIMA tentativa (o BullMQ não vai reenfileirar sozinho de novo).

**Configuração**: preencha `ALERT_SLACK_WEBHOOK_URL` no `.env` de produção com a URL de um
Incoming Webhook do Slack (Slack > seu workspace > Apps > Incoming Webhooks > canal de
operação). Sem essa variável, `sendOpsAlert` é um no-op silencioso — o sistema continua
funcionando exatamente como antes, só sem avisar ninguém.

Sem essa variável configurada (ou antes de 08/09/2026), o único jeito de saber que algo está
errado é olhar a tela de Monitoramento (ou consultar `GET /health/infrastructure` /
`GET /health/events`) manualmente, ou alguém perceber que um agente parou de responder no chat.
