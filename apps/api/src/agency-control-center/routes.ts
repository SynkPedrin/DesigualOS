import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { organizacaoProvedora } from '../lib/escopo-de-organizacao';
import { contextoCompletoDe } from '../organizations/contexto';

/**
 * agency-control-center/routes.ts — "Controle da Agência" (Part I do prompt
 * de refinamento "FINAL PRODUCT REFINEMENT", §52-59, 06/10/2026).
 *
 * NÃO confundir com `/panorama`: panorama é uso de IA/infra (execuções,
 * memória, sinais) — útil pra quem opera a PLATAFORMA. Isto aqui é operação
 * de AGÊNCIA (demandas, aprovações, clientes em atenção, carga por
 * colaborador) — útil pra quem gerencia o TRABALHO. Os dois cabem na mesma
 * home (`apps/web/src/app/(shell)/page.tsx`) como seções separadas, cada um
 * respondendo uma pergunta diferente.
 *
 * UMA VIAGEM SÓ AO BANCO (mesma lição documentada em panorama/routes.ts): o
 * pool tem 3 conexões, a home já faz várias chamadas paralelas por conta
 * própria, e separar isto em 8 queries pequenas foi o que derrubou a rota
 * mais importante da tela uma vez. Fica tudo num `WITH` só.
 *
 * O QUE FICA DE FORA DE PROPÓSITO, e por quê:
 *
 * - "Campanhas em alerta" / spend agregado de TODOS os clientes: cada cliente
 *   com Meta/Google conectado exige uma chamada de API externa (ver
 *   client-meta-accounts.ts / client-google-ads-accounts.ts — não existe
 *   cache local de métrica). Agregar isso pra N clientes numa única resposta
 *   síncrona da home significaria N chamadas externas por carregamento de
 *   tela — o mesmo problema que a nota de panorama.ts já resolveu não fazer
 *   para tarefa do ClickUp. Esta rota mostra só QUANTOS clientes têm mídia
 *   CONECTADA (dado nosso, sem chamada externa); a performance agregada
 *   pede um job assíncrono com snapshot cacheado (ver precedente em
 *   `apps/worker/src/scheduler/integration-health.ts`), não implementado
 *   ainda — não inventado aqui para não fingir "0 alertas" quando a resposta
 *   real é "não sabemos".
 * - Calendar em Integration Health: não existe integração de calendário
 *   implementada em nenhum lugar do repositório — aparece como
 *   `nao_implementado`, nunca como "desconectado" (que implicaria algo que
 *   já existiu e caiu).
 * - Filtro "equipe": não existe conceito de time/departamento modelado hoje
 *   (só `client_users.responsibility`, que já vira o filtro "área"). Filtrar
 *   por equipe exigiria um conceito novo, fora do escopo desta rota.
 */
const FUNIL_RESOURCE_TYPE = 'brief';

export async function registerAgencyControlCenterRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { client_id?: string; responsibility?: string } }>(
    '/agency-control-center',
    { preHandler: [requireAuth, requireModule('operacao')] },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      const contexto = await contextoCompletoDe(user);
      const deTrabalho = contexto.deTrabalho;
      if (!deTrabalho) {
        reply.code(403);
        return { error: 'Sem empresa de trabalho definida.' };
      }
      const org = deTrabalho.id;
      const legadoVisivel = organizacaoProvedora() === org;
      const { client_id: clientIdFiltro, responsibility: areaFiltro } = request.query;

      const bruto = await db.execute(sql`
        with
        /** Mesma regra de carteira de panorama.ts: NULL só entra no contexto da provedora. */
        cli as (
          select c.id, c.name from clients c
          where c.deleted_at is null
            and (c.organization_id = ${org}::uuid or (${legadoVisivel} and c.organization_id is null))
            and (${clientIdFiltro ?? null}::uuid is null or c.id = ${clientIdFiltro ?? null}::uuid)
        ),
        /** Clientes cujo responsável bate com o filtro de área — vazio quando não há filtro. */
        cli_area as (
          select distinct cu.client_id from client_users cu
          where ${areaFiltro ?? null}::text is not null and cu.responsibility = ${areaFiltro ?? null}::text
        ),
        cli_filtrado as (
          select c.* from cli c
          where ${areaFiltro ?? null}::text is null or c.id in (select client_id from cli_area)
        ),
        demandas as (
          select d.* from demands d
          where d.organization_id = ${org}::uuid and d.client_id in (select id from cli_filtrado)
        ),
        aprov as (
          select a.* from approval_requests a
          where a.organization_id = ${org}::uuid
            and (a.client_id is null or a.client_id in (select id from cli_filtrado))
        ),
        briefs_s as (
          select b.* from briefs b
          where b.organization_id = ${org}::uuid and b.client_id in (select id from cli_filtrado)
        ),
        conversas as (
          select cv.* from conversation_threads cv
          where cv.organization_id = ${org}::uuid
            and (cv.client_id is null or cv.client_id in (select id from cli_filtrado))
        ),
        /**
         * previstas_hoje usa due_date::date = current_date, avaliado em UTC
         * pelo Postgres: perto da meia-noite, "hoje" no fuso de quem olha a
         * tela pode discordar por algumas horas do "hoje" daqui. Mesma
         * ambiguidade que demands.dueDate já carrega em qualquer outro lugar
         * do produto — não é introduzida por esta rota.
         */
        kpi as (
          select
            (select count(*) from cli_filtrado)::int as clientes_ativos,
            (select count(*) from conversas where status = 'waiting_agency')::int as conversas_aguardando,
            (select count(*) from demandas where status not in ('done', 'cancelled'))::int as demandas_abertas,
            (select count(*) from demandas where due_date < now() and status not in ('done', 'cancelled'))::int as atrasados,
            (select count(*) from aprov where status = 'pending')::int as aguardando_aprovacao,
            (select count(*) from demandas where due_date::date = current_date and status <> 'cancelled')::int as previstas_hoje
        ),
        /**
         * Funil: demands.status sozinho não distingue "revisão" de "aprovação"
         * (os dois vivem num status só, 'in_production') — a distinção real
         * está em approval_requests sobre o brief daquela demanda. Documentado
         * em detalhe no cabeçalho do arquivo.
         */
        funil as (
          select
            (select count(*) from demandas where status = 'new')::int as novas,
            (select count(*) from demandas where status = 'briefing')::int as briefing,
            (select count(*) from demandas d where d.status = 'in_production'
              and not exists (
                select 1 from briefs_s b join aprov a on a.resource_type = ${FUNIL_RESOURCE_TYPE} and a.resource_id = b.id::text
                where b.demand_id = d.id and a.status in ('pending', 'changes_requested')
              ))::int as producao,
            (select count(distinct b.demand_id) from briefs_s b join aprov a on a.resource_type = ${FUNIL_RESOURCE_TYPE} and a.resource_id = b.id::text
              where a.status = 'changes_requested')::int as revisao,
            (select count(distinct b.demand_id) from briefs_s b join aprov a on a.resource_type = ${FUNIL_RESOURCE_TYPE} and a.resource_id = b.id::text
              where a.status = 'pending')::int as aprovacao,
            (select count(*) from demandas where status = 'done')::int as concluido
        ),
        /** Responsável "de conta" do cliente — fallback pra qualquer responsabilidade cadastrada. */
        responsavel as (
          select distinct on (cu.client_id) cu.client_id, u.name
          from client_users cu
          join users u on u.id = cu.user_id
          where cu.responsibility is not null
          order by cu.client_id, (cu.responsibility = 'account') desc, cu.created_at asc
        ),
        atencao_cliente as (
          select c.id, c.name, r.name as responsavel,
            coalesce(dd.overdue, 0)::int as demandas_atrasadas,
            coalesce(pa.pending, 0)::int as aprovacoes_pendentes
          from cli_filtrado c
          left join (
            select client_id, count(*) as overdue from demandas
            where due_date < now() and status not in ('done', 'cancelled') group by client_id
          ) dd on dd.client_id = c.id
          left join (
            select client_id, count(*) as pending from aprov where status = 'pending' and client_id is not null group by client_id
          ) pa on pa.client_id = c.id
          left join responsavel r on r.client_id = c.id
          where coalesce(dd.overdue, 0) > 0 or coalesce(pa.pending, 0) > 0
          order by (coalesce(dd.overdue, 0) * 10 + coalesce(pa.pending, 0)) desc
          limit 8
        ),
        /** Mesmo padrão de "gente" em panorama.ts: membro ativo da empresa de trabalho. */
        pessoas as (
          select u.id, u.name from users u
          where u.active = true and u.deleted_at is null
            and exists (select 1 from organization_members om where om.user_id = u.id and om.organization_id = ${org}::uuid)
            and (${areaFiltro ?? null}::text is null or exists (
              select 1 from client_users cu where cu.user_id = u.id and cu.responsibility = ${areaFiltro ?? null}::text
            ))
        ),
        operacao_colaborador as (
          select p.id, p.name,
            (select count(distinct cu.client_id)::int from client_users cu where cu.user_id = p.id and cu.client_id in (select id from cli_filtrado)) as clientes,
            (select count(*)::int from demandas where owner_id = p.id and status not in ('done', 'cancelled')) as em_andamento,
            (select count(*)::int from demandas where owner_id = p.id and due_date < now() and status not in ('done', 'cancelled')) as atrasados,
            (select count(*)::int from aprov where approver_id = p.id and status = 'pending') as aprovacoes_pendentes
          from pessoas p
        ),
        meta_mapeados as (select count(distinct client_id)::int as n from client_meta_accounts where client_id in (select id from cli_filtrado)),
        google_mapeados as (select count(distinct client_id)::int as n from client_google_ads_accounts where client_id in (select id from cli_filtrado)),
        clickup_saude as (select status, last_event_at from integration_health where source = 'clickup.webhook' limit 1),
        whatsapp_saude as (select status from organization_connectors where organization_id = ${org}::uuid and provider = 'whatsapp' limit 1),
        meta_conexoes as (
          select count(*)::int as n from integration_connections ic
          join organization_members om on om.user_id = ic.user_id and om.organization_id = ${org}::uuid
          where ic.provider = 'meta' and ic.status = 'connected'
        ),
        google_conexoes as (
          select count(*)::int as n from integration_connections ic
          join organization_members om on om.user_id = ic.user_id and om.organization_id = ${org}::uuid
          where ic.provider = 'google_ads' and ic.status = 'connected'
        )
        select
          (select row_to_json(kpi) from kpi) as kpi,
          (select row_to_json(funil) from funil) as funil,
          (select coalesce(json_agg(row_to_json(atencao_cliente)), '[]'::json) from atencao_cliente) as atencao,
          (select coalesce(json_agg(row_to_json(operacao_colaborador)), '[]'::json) from operacao_colaborador) as operacao,
          (select n from meta_mapeados) as meta_mapeados,
          (select n from google_mapeados) as google_mapeados,
          (select status from clickup_saude) as clickup_status,
          (select last_event_at from clickup_saude) as clickup_last_event_at,
          (select status from whatsapp_saude) as whatsapp_status,
          (select n from meta_conexoes) as meta_conexoes,
          (select n from google_conexoes) as google_conexoes
      `);

      const linha = bruto[0] as {
        kpi: {
          clientes_ativos: number;
          conversas_aguardando: number;
          demandas_abertas: number;
          atrasados: number;
          aguardando_aprovacao: number;
          previstas_hoje: number;
        };
        funil: { novas: number; briefing: number; producao: number; revisao: number; aprovacao: number; concluido: number };
        atencao: Array<{ id: string; name: string; responsavel: string | null; demandas_atrasadas: number; aprovacoes_pendentes: number }>;
        operacao: Array<{ id: string; name: string; clientes: number; em_andamento: number; atrasados: number; aprovacoes_pendentes: number }>;
        meta_mapeados: number;
        google_mapeados: number;
        clickup_status: string | null;
        clickup_last_event_at: string | null;
        whatsapp_status: string | null;
        meta_conexoes: number;
        google_conexoes: number;
      };

      return {
        kpis: linha.kpi,
        funil_de_workflow: linha.funil,
        clientes_em_atencao: linha.atencao.map((c) => ({
          client_id: c.id,
          client_name: c.name,
          responsavel: c.responsavel,
          demandas_atrasadas: c.demandas_atrasadas,
          aprovacoes_pendentes: c.aprovacoes_pendentes,
        })),
        // Só quem tem alguma carga aparece — "zero em tudo" não é carga, é ausência de dado útil aqui.
        operacao_por_colaborador: linha.operacao
          .filter((p) => p.clientes > 0 || p.em_andamento > 0 || p.atrasados > 0 || p.aprovacoes_pendentes > 0)
          .sort((a, b) => b.em_andamento + b.atrasados - (a.em_andamento + a.atrasados)),
        media_summary: {
          clientes_com_meta_conectado: linha.meta_mapeados,
          clientes_com_google_ads_conectado: linha.google_mapeados,
          /** Deliberadamente SEM spend agregado — ver cabeçalho do arquivo. */
          performance_agregada_disponivel: false,
        },
        integration_health: {
          clickup: { status: linha.clickup_status ?? 'unknown', last_event_at: linha.clickup_last_event_at },
          whatsapp: { status: linha.whatsapp_status ?? 'desconectado' },
          meta: { status: linha.meta_conexoes > 0 ? 'conectado' : 'desconectado', collaborator_connections: linha.meta_conexoes },
          google_ads: { status: linha.google_conexoes > 0 ? 'conectado' : 'desconectado', collaborator_connections: linha.google_conexoes },
          calendar: { status: 'nao_implementado' },
        },
        gerado_em: new Date().toISOString(),
      };
    },
  );
}
