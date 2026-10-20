# Media Command Center (Mídia 3.0)

Atualizado em 20/10/2026. Branch `feat/openwa-whatsapp-integration`.

## O que é

O módulo Mídia lê do **banco**, não do Meta, a cada tela. Um job sincroniza contas, hierarquia e métricas diárias; telas, agentes, alertas e relatórios leem as mesmas tabelas e as mesmas configurações.

```
Meta Marketing API ──(job 30 min, só leitura)──► media_* (Postgres)
                                                   │
        ┌──────────────┬──────────────┬────────────┼──────────────┐
      Telas         Alertas       Relatórios    Agentes (Jarbas)   Config única
   /midias/:id    (worker 15m)   (client_reports)  media-agent-tools  media_settings
```

## Telas

- `/midias/:clientId`: grade de **instâncias** do cliente (cada conta Meta ou Google é um cartão com saúde, última sincronização e gasto) e, abaixo, o painel de gerenciamento da instância escolhida.
- Configurações → **Mídia e performance** (workspace): os mesmos padrões da empresa (`media_settings`, camada empresa) que a aba Configurações de cada cliente sobrescreve.

## Quem é a "Alicia"

**Alicia é uma pessoa da equipe (tráfego), não um agente de IA.** Não existe agente Alicia no código nem em `agents`. O agente de tráfego é o **Jarbas** (`jarbas-local.ts`). As "ferramentas da Alicia" foram implementadas como ferramentas de agente genéricas (`media-agent-tools.ts`) e ligadas ao Jarbas; a Alicia usa as telas. Se for desejado um agente chamado Alicia, é decisão de produto separada.

## Conexão Meta

- Central: usuário do sistema da BM (`META_SYSTEM_USER_TOKEN`, `META_BUSINESS_ID`). Sem OAuth. Ver `packages/tool-gateway/src/meta-system-user.ts` e `meta-system-connection.ts`.
- Token atual: tipo SYSTEM_USER, sem expiração, com `ads_read`, `business_management` e `ads_management`.
- **Não lê saldo pré-pago** (`funding_source_details` → Permission Denied). Só `spend_cap` e `amount_spent`.
- Insights falham de forma transitória e batem em limite de taxa; ver "Limitações".

## Dados (migração 0076, aditiva)

| Tabela | Papel |
|---|---|
| `media_ad_accounts` | catálogo de contas descobertas (inclui não vinculadas), moeda, fuso, status, saldo (`balance_kind`) |
| `media_entities` | campanha → conjunto → anúncio (+ criativo em jsonb) |
| `media_insights_daily` | métricas por dia e entidade |
| `media_sync_runs` | histórico de sincronização |
| `media_settings` | **fonte única** de configurações (empresa > cliente > conta) |
| `media_alert_rules` / `media_alert_events` | regras e disparos (idempotência por `dedupe_key` único) |
| `media_message_templates` | mensagens personalizadas |
| `media_report_schedules` | agendamento de relatórios |
| `media_action_requests` | pedidos de ação em campanha (aprovação humana) |

O vínculo cliente↔conta continua em `client_meta_accounts` (não duplicado).

## Serviços (`packages/tool-gateway/src`)

`meta-media-graph.ts` (leitura, retry, paginação adaptativa) · `media-sync.ts` · `media-metrics.ts` (métricas e períodos puros) · `media-queries.ts` (única camada de leitura, filtra por empresa) · `media-settings.ts` · `media-templates.ts` · `media-alerts.ts` · `media-agent-tools.ts` · `media-actions.ts` · `media-report-schedules.ts`.

## API (`apps/api/src/media/routes.ts`)

Leitura: `GET /media/accounts`, `/media/accounts/:id/{summary,entities,creatives}`, `/media/overview-v3`, `/media/settings`, `/media/alert-rules`, `/media/alerts`, `/media/templates`, `/media/whatsapp/destinations`, `/media/report-schedules`, `/media/actions`, `/media/sync-runs`.
Escrita (exige `clients:write`): `PUT /media/settings`, CRUD de regras/templates/agendamentos, `POST /media/alerts/evaluate`, `POST /media/accounts/:id/sync`, `POST /media/actions`, `POST /media/actions/:id/decision`.

## Worker (`apps/worker/src/scheduler`)

`media-sync` (30 min, em segundo plano, com trava), `media-alerts` (15 min), `media-report-schedules` (15 min).

## Travas de segurança

1. Envio por WhatsApp: três camadas (regra `send_enabled`, `whatsapp.sendEnabled`, destino + horário). Regra nasce com envio **desligado**, mesmo que o corpo peça ligado.
2. Mensagem com variável sem valor (ex.: saldo indisponível) **não sai**.
3. Ação em campanha: `MEDIA_ACTIONS_ENABLED=true` (padrão desligado) + `ads_management` conferido ao vivo + pedido aprovado por pessoa com `confirm`. Estado antes/depois gravado.
4. Agente só **propõe** (`request_campaign_action`); `agent.permissions.proposeActions` nasce desligado.
5. Associação conta→cliente é manual: a sincronização da conexão central só SUGERE por nome (`motivo: sugerida`); `META_AUTO_LINK_BY_NAME=true` reativa o vínculo automático. Os 14 vínculos anteriores a esta regra (11 criados por nome em 19/10) continuam e devem ser conferidos por uma pessoa.

## Variáveis de ambiente

`META_SYSTEM_USER_TOKEN`, `META_BUSINESS_ID`, `META_APP_ID`, `META_APP_SECRET`, `MEDIA_ORGANIZATION_ID` (opcional; sem ela vale a organização com mais clientes), `MEDIA_ACTIONS_ENABLED` (padrão false).

## Produção (como está publicado, 20/10/2026)

- **Front:** Vercel, projeto `desigual-os`, domínio `desigual-os.vercel.app`. Publicar a partir de uma EXPORTAÇÃO limpa do commit (`git archive <sha> | tar -x -C <pasta>`; copiar `.vercel`; `vercel deploy --prod`). Não publicar de `git worktree`: a CLI trava no upload e deixa deploy fantasma na fila.
- **API e worker:** VPS Locaweb `191.252.203.180` (`api.citavel.ai`), repositório em `/opt/desigual-os` na `main`. Publicar: `git pull --ff-only origin main` e `docker compose -f docker-compose.prod.yml --env-file .env up -d --build api worker` (leva ~5 min; OpenWA e Redis não são tocados). O `.env` do servidor é a fonte de produção (Meta, Google, `MEDIA_ORGANIZATION_ID`).
- **Um escritor só:** os jobs de mídia rodam apenas na VPS. Máquinas de desenvolvimento que apontam para o mesmo banco devem ter `MEDIA_JOBS_ENABLED=false`; sem isso elas sobrescrevem erro em `media_ad_accounts` e gastam o limite de requisições do Meta (por app).
- **Google Ads** usa as credenciais OAuth do servidor (diferentes das de um `.env` local novo). Sem developer token.

## Rollback

Servidor: imagens `desigual-os-api:rollback-20261020` e `desigual-os-worker:rollback-20261020` e o commit anterior em `/opt/desigual-os/.rollback-commit-20261020` (`422b9a8`); `.env` anterior em `.env.bak-20261020-midia`.


Migração 0076 só cria tabelas: `DROP TABLE media_*` (ordem inversa das FKs) desfaz. O código novo é aditivo; `git revert` do commit remove rotas, jobs e telas. A tela anterior segue na página como "Leitura ao vivo no Meta".

## Limitações conhecidas

- **Google Ads**: verificado contra a API real em produção (3Net: 5 campanhas, anúncios com texto, métricas; MCC com 21 contas descobertas). Ações em campanha só no Meta; Google não tem saldo/limite (`UNAVAILABLE`); "resultado" é `conversions` (atribuição diferente do Meta, nunca somar os dois).
- **Saldo real indisponível** com este token; alerta de saldo só atua em contas com limite de gastos (estimativa rotulada como tal).
- **Limite de requisições do Meta**: a carga inicial de 90 dias de 14 contas excede o limite; a sync recua e retoma a cada 30 min. Contas novas chegam completas em algumas rodadas.
- **Envio por WhatsApp não configurado**: a organização não tem conector `whatsapp` (`organization_connectors`). Alertas ficam registrados; nada é enviado.
- Envio do PDF de relatório por WhatsApp: não implementado (o PDF é gerado e fica na tela).
- Moedas diferentes nunca são somadas (totais por moeda).
- Interface verificada por typecheck, lint e `next build`; **sem teste visual em navegador** (o navegador embutido estava indisponível).
