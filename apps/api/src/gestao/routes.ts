import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { requireAuth, requireRole } from '../auth/middleware';
import { requireTenant } from '../lib/tenant-context';
import { tarefasDaAgencia } from '../clickup/routes';
import { redactForViewer, type CalendarEventRow } from '../calendar/access';
import { inicioDoDia, tarefasPorPessoa, vazio, type TarefasDaPessoa } from './tarefas';
import { estadosDePresenca } from '../internal-chat/presenca';

const logger = createLogger({ service: 'api:gestao' });

/**
 * GESTÃO DA EQUIPE (21/10/2026, pedido do Pedro para a Tammy).
 *
 *   GET /gestao/equipe          — cada colaborador: tarefas, atrasos, agenda de hoje, quinzenas, aprovações, atividade
 *   GET /gestao/equipe/:pessoa  — o mesmo de uma pessoa, por inteiro (listas e agenda da semana)
 *
 * QUEM VÊ: administrador (master) da empresa de trabalho. A equipe é quem tem
 * vínculo ativo com a mesma empresa e não é administrador.
 *
 * O QUE ENTRA (decisão do Pedro: "só o trabalho"): tarefas do ClickUp,
 * quinzenas, aprovações, agenda, clientes e a atividade de trabalho. NÃO entra:
 * mensagem privada da Comunicação, conversa com o Bento/Jarbas/Otto. Evento
 * particular na agenda aparece como "ocupado", sem título (redactForViewer).
 *
 * ClickUp fora do ar não derruba o painel: as outras partes chegam e a de
 * tarefas diz o que aconteceu.
 */

type Pessoa = {
  id: string;
  name: string;
  email: string;
  clickup_email: string | null;
  avatar_url: string | null;
  last_seen_at: string | null;
  job_title: string | null;
};

async function equipe(organizationId: string, apenas?: string): Promise<Pessoa[]> {
  return db.execute<Pessoa>(sql`
    select u.id, u.name, u.email, u.clickup_email, u.avatar_url, u.last_seen_at, u.job_title
    from users u
    join organization_members om on om.user_id = u.id and om.organization_id = ${organizationId}::uuid
    where u.active and u.deleted_at is null
      and not exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.name = 'master')
      ${apenas ? sql`and u.id = ${apenas}::uuid` : sql``}
    order by u.name
  `);
}

async function numerosDoTrabalho(organizationId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, { demandas_abertas: number; demandas_atrasadas: number; aprovacoes_pendentes: number; clientes: number; agenda_conectada: boolean }>();
  const lista = sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
  const linhas = await db.execute<{ id: string; demandas_abertas: number; demandas_atrasadas: number; aprovacoes_pendentes: number; clientes: number; agenda_conectada: boolean }>(sql`
    select p.id,
      (select count(*)::int from demands d where d.organization_id = ${organizationId}::uuid and d.owner_id = p.id and d.status not in ('done', 'cancelled')) as demandas_abertas,
      (select count(*)::int from demands d where d.organization_id = ${organizationId}::uuid and d.owner_id = p.id and d.status not in ('done', 'cancelled') and d.due_date < now()) as demandas_atrasadas,
      (select count(*)::int from approval_requests a where a.organization_id = ${organizationId}::uuid and a.approver_id = p.id and a.status = 'pending') as aprovacoes_pendentes,
      (select count(distinct cu.client_id)::int from client_users cu join clients c on c.id = cu.client_id where cu.user_id = p.id and c.organization_id = ${organizationId}::uuid and c.deleted_at is null) as clientes,
      exists (select 1 from member_calendar_accounts m where m.user_id = p.id and m.organization_id = ${organizationId}::uuid) as agenda_conectada
    from unnest(${lista}) as p(id)
  `);
  return new Map(linhas.map((l) => [l.id, l]));
}

type Evento = ReturnType<typeof redactForViewer> & { pessoa_id: string };

async function agendaDaEquipe(organizationId: string, ids: string[], de: Date, ate: Date, viewerId: string): Promise<Evento[]> {
  if (ids.length === 0) return [];
  const lista = sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
  const linhas = await db.execute<{ pessoa_id: string; participantes: string[] } & Record<string, unknown>>(sql`
    select p.member_id as pessoa_id, e.id, e.organization_id, e.client_id, e.title, e.description, e.start_at, e.end_at, e.timezone,
      e.location, e.meeting_url, e.source, e.visibility, e.status, e.created_by,
      (select array_agg(x.member_id) from calendar_event_participants x where x.event_id = e.id and x.member_id is not null) as participantes
    from calendar_event_participants p
    join calendar_events e on e.id = p.event_id
    where p.member_id = any(${lista}) and e.organization_id = ${organizationId}::uuid
      and e.start_at < ${ate.toISOString()}::timestamptz and e.end_at > ${de.toISOString()}::timestamptz
      and e.status <> 'cancelled'
    order by e.start_at
  `);
  return linhas.map((l) => {
    const evento: CalendarEventRow = {
      id: String(l.id), organizationId: String(l.organization_id), clientId: (l.client_id as string | null) ?? null, title: String(l.title ?? ''),
      description: (l.description as string | null) ?? null, startAt: new Date(String(l.start_at)), endAt: new Date(String(l.end_at)),
      timezone: String(l.timezone ?? 'America/Sao_Paulo'), location: (l.location as string | null) ?? null, meetingUrl: (l.meeting_url as string | null) ?? null,
      source: String(l.source ?? ''), visibility: String(l.visibility ?? 'default'), status: String(l.status ?? 'confirmed'), createdBy: String(l.created_by ?? ''),
    };
    return { ...redactForViewer(evento, viewerId, new Set(l.participantes ?? [])), pessoa_id: l.pessoa_id };
  });
}

async function atividadeRecente(organizationId: string, ids: string[], porPessoa: number) {
  if (ids.length === 0) return [] as Array<{ user_id: string; summary: string | null; source: string; type: string; client_name: string | null; at: string }>;
  const lista = sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
  return db.execute<{ user_id: string; summary: string | null; source: string; type: string; client_name: string | null; at: string }>(sql`
    select x.user_id, x.summary, x.source, x.type, x.client_name, x.at from (
      select e.user_id, e.summary, e.source, e.type, c.name as client_name, coalesce(e.occurred_at, e.created_at) as at,
        row_number() over (partition by e.user_id order by coalesce(e.occurred_at, e.created_at) desc) as n
      from operational_events e left join clients c on c.id = e.client_id
      where e.organization_id = ${organizationId}::uuid and e.user_id = any(${lista})
        and coalesce(e.occurred_at, e.created_at) > now() - interval '30 days'
    ) x where x.n <= ${porPessoa} order by x.at desc
  `);
}

/** O que a equipe fez por último (a fila "acontecendo agora" do Hoje da gestão). */
async function feedDaEquipe(organizationId: string, ids: string[], limite: number) {
  if (ids.length === 0) return [] as Array<{ id: string; user_id: string; user_name: string; summary: string | null; source: string; type: string; client_name: string | null; at: string }>;
  const lista = sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
  return db.execute<{ id: string; user_id: string; user_name: string; summary: string | null; source: string; type: string; client_name: string | null; at: string }>(sql`
    select e.id, e.user_id, u.name as user_name, e.summary, e.source, e.type, c.name as client_name, coalesce(e.occurred_at, e.created_at) as at
    from operational_events e join users u on u.id = e.user_id left join clients c on c.id = e.client_id
    where e.organization_id = ${organizationId}::uuid and e.user_id = any(${lista})
      and coalesce(e.occurred_at, e.created_at) > now() - interval '7 days'
    order by coalesce(e.occurred_at, e.created_at) desc limit ${limite}
  `);
}

async function tarefasDaEquipe(request: FastifyRequest, pessoas: Pessoa[]) {
  try {
    const agencia = await tarefasDaAgencia(request.authUser!);
    if (!agencia.ok) return { disponivel: false as const, erro: 'O ClickUp não está conectado para esta empresa.' };
    const r = tarefasPorPessoa(
      agencia.tasks,
      pessoas.map((p) => ({ id: p.id, emails: [p.email, p.clickup_email].filter((e): e is string => Boolean(e)) })),
      (listId) => { const c = listId ? agencia.clientByListId.get(listId) : undefined; return c ? { id: c.id, name: c.name } : null; },
    );
    return { disponivel: true as const, truncado: agencia.truncated, ...r };
  } catch (error) {
    logger.warn({ error }, 'Gestão da equipe: tarefas do ClickUp indisponíveis');
    return { disponivel: false as const, erro: 'Não foi possível consultar o ClickUp agora. Tente de novo em instantes.' };
  }
}

const semLista = (t: TarefasDaPessoa) => { const { lista: _lista, ...resto } = t; return resto; };

export async function registerGestaoRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (rotas) => {
    rotas.addHook('preHandler', async (request, reply) => {
      await requireAuth(request, reply);
      if (reply.sent) return;
      await requireTenant(request, reply);
      if (reply.sent) return;
      await requireRole('master')(request, reply);
    });

    rotas.get('/gestao/equipe', async (request) => {
      const org = request.tenantContext!.organizationId;
      const viewer = request.authUser!.id;
      const pessoas = await equipe(org);
      const ids = pessoas.map((p) => p.id);
      const agora = Date.now();
      const hoje = new Date(inicioDoDia(agora));
      const amanha = new Date(hoje.getTime() + 24 * 60 * 60_000);
      const [tarefas, numeros, agenda, atividade, presenca, feed] = await Promise.all([
        tarefasDaEquipe(request, pessoas),
        numerosDoTrabalho(org, ids),
        agendaDaEquipe(org, ids, hoje, amanha, viewer),
        atividadeRecente(org, ids, 1),
        // Presença é enfeite: Redis lento ou fora não segura o painel (1 s, depois todo mundo "offline").
        Promise.race([estadosDePresenca(ids), new Promise<Map<string, 'online' | 'away'>>((ok) => setTimeout(() => ok(new Map()), 1_000).unref())]),
        feedDaEquipe(org, ids, 20),
      ]);
      return {
        gerado_em: new Date(agora).toISOString(),
        tarefas: tarefas.disponivel
          ? { disponivel: true, truncado: tarefas.truncado, sem_responsavel: tarefas.semResponsavel, sem_responsavel_atrasadas: tarefas.semResponsavelAtrasadas, listas: tarefas.listas }
          : { disponivel: false, erro: tarefas.erro },
        feed: feed.map((f) => ({ ...f, at: new Date(f.at).toISOString() })),
        pessoas: pessoas.map((p) => {
          const meus = agenda.filter((e) => e.pessoa_id === p.id);
          const agoraEvento = meus.find((e) => Date.parse(e.start_at) <= agora && Date.parse(e.end_at) > agora) ?? null;
          const proximo = meus.find((e) => Date.parse(e.start_at) > agora) ?? null;
          const n = numeros.get(p.id);
          const ultima = atividade.find((a) => a.user_id === p.id) ?? null;
          return {
            id: p.id, name: p.name, email: p.email, avatar_url: p.avatar_url, job_title: p.job_title,
            // Presença ao vivo (mesma da Comunicação): 'online' com a tela à vista, 'away' com a aba de lado.
            presenca: presenca.get(p.id) ?? 'offline',
            last_seen_at: p.last_seen_at ? new Date(p.last_seen_at).toISOString() : null,
            tarefas: tarefas.disponivel ? semLista(tarefas.porPessoa.get(p.id) ?? vazio()) : null,
            demandas: { abertas: n?.demandas_abertas ?? 0, atrasadas: n?.demandas_atrasadas ?? 0 },
            aprovacoes_pendentes: n?.aprovacoes_pendentes ?? 0,
            clientes: n?.clientes ?? 0,
            agenda: {
              conectada: n?.agenda_conectada ?? false,
              hoje: meus.length,
              agora: agoraEvento,
              proximo,
              eventos: meus.map(({ pessoa_id: _p, ...e }) => e),
            },
            ultima_atividade: ultima ? { summary: ultima.summary, source: ultima.source, client_name: ultima.client_name, at: new Date(ultima.at).toISOString() } : null,
          };
        }),
      };
    });

    rotas.get<{ Params: { pessoa: string } }>('/gestao/equipe/:pessoa', async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.pessoa);
      if (!id.success) { reply.code(404); return { error: 'Colaborador não encontrado.' }; }
      const org = request.tenantContext!.organizationId;
      const [pessoa] = await equipe(org, id.data);
      if (!pessoa) { reply.code(404); return { error: 'Colaborador não encontrado.' }; }
      const agora = Date.now();
      const hoje = new Date(inicioDoDia(agora));
      const fimDaSemana = new Date(hoje.getTime() + 7 * 24 * 60 * 60_000);
      const [tarefas, numeros, agenda, atividade, demandas, aprovacoes, clientes] = await Promise.all([
        tarefasDaEquipe(request, [pessoa]),
        numerosDoTrabalho(org, [pessoa.id]),
        agendaDaEquipe(org, [pessoa.id], hoje, fimDaSemana, request.authUser!.id),
        atividadeRecente(org, [pessoa.id], 25),
        db.execute<{ id: string; title: string; status: string; priority: string; due_date: string | null; client_name: string | null }>(sql`
          select d.id, d.title, d.status, d.priority, d.due_date, c.name as client_name from demands d left join clients c on c.id = d.client_id
          where d.organization_id = ${org}::uuid and d.owner_id = ${pessoa.id}::uuid and d.status not in ('done', 'cancelled')
          order by d.due_date nulls last limit 50`),
        db.execute<{ id: string; resource_type: string; created_at: string; client_name: string | null }>(sql`
          select a.id, a.resource_type, a.created_at, c.name as client_name from approval_requests a left join clients c on c.id = a.client_id
          where a.organization_id = ${org}::uuid and a.approver_id = ${pessoa.id}::uuid and a.status = 'pending'
          order by a.created_at limit 50`),
        db.execute<{ id: string; name: string; responsabilidades: string[] }>(sql`
          select c.id, c.name, array_agg(distinct cu.responsibility) as responsabilidades from client_users cu join clients c on c.id = cu.client_id
          where cu.user_id = ${pessoa.id}::uuid and c.organization_id = ${org}::uuid and c.deleted_at is null
          group by c.id, c.name order by c.name`),
      ]);
      const meus = tarefas.disponivel ? tarefas.porPessoa.get(pessoa.id) ?? vazio() : null;
      return {
        pessoa: { id: pessoa.id, name: pessoa.name, email: pessoa.email, avatar_url: pessoa.avatar_url, job_title: pessoa.job_title, last_seen_at: pessoa.last_seen_at ? new Date(pessoa.last_seen_at).toISOString() : null },
        tarefas: tarefas.disponivel ? { disponivel: true, truncado: tarefas.truncado, ...meus } : { disponivel: false, erro: tarefas.erro },
        agenda: { conectada: numeros.get(pessoa.id)?.agenda_conectada ?? false, eventos: agenda.map(({ pessoa_id: _p, ...e }) => e) },
        demandas: demandas.map((d) => ({ ...d, due_date: d.due_date ? new Date(d.due_date).toISOString() : null, atrasada: Boolean(d.due_date && Date.parse(String(d.due_date)) < agora) })),
        aprovacoes: aprovacoes.map((a) => ({ ...a, created_at: new Date(a.created_at).toISOString() })),
        clientes,
        atividade: atividade.map((a) => ({ summary: a.summary, source: a.source, type: a.type, client_name: a.client_name, at: new Date(a.at).toISOString() })),
      };
    });
  });
}
