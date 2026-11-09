import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';
import type { WorkContext } from './context';

type Linha = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>): Promise<Linha[]> => (await db.execute(q)) as unknown as Linha[];

/** Números do trabalho da empresa (tudo filtrado por organização; `spaceId` opcional restringe a um espaço). */
export async function workReport(ctx: WorkContext, opts: { spaceId?: string; weeks?: number } = {}) {
  const org = ctx.organizationId;
  const semanas = Math.min(Math.max(opts.weeks ?? 8, 1), 26);
  const esc = opts.spaceId ? sql`and l.space_id = ${opts.spaceId}` : sql``;
  const base = sql`from work_tasks t join work_lists l on l.id = t.list_id join work_task_statuses s on s.id = t.status_id where t.organization_id = ${org} and t.archived_at is null ${esc}`;

  const [totais] = await rows(sql`select count(*)::int as total,
      count(*) filter (where t.completed_at is null)::int as abertas,
      count(*) filter (where t.completed_at is not null)::int as concluidas,
      count(*) filter (where t.completed_at is null and t.due_at < now())::int as atrasadas,
      count(*) filter (where t.completed_at is null and not exists (select 1 from work_task_assignees a where a.task_id = t.id))::int as sem_responsavel,
      count(*) filter (where t.completed_at is null and t.due_at is null)::int as sem_prazo
    ${base} and t.parent_task_id is null`);
  const porStatus = await rows(sql`select s.name, s.color, s.category, count(*)::int as n ${base} and t.parent_task_id is null group by s.name, s.color, s.category order by n desc limit 20`);
  const porResponsavel = await rows(sql`select u.id, u.name, count(*) filter (where t.completed_at is null)::int as abertas, count(*) filter (where t.completed_at is not null)::int as concluidas,
      count(*) filter (where t.completed_at is null and t.due_at < now())::int as atrasadas
    from work_task_assignees a join work_tasks t on t.id = a.task_id join work_lists l on l.id = t.list_id join users u on u.id = a.user_id
    where t.organization_id = ${org} and t.archived_at is null and t.parent_task_id is null ${esc} group by u.id, u.name order by abertas desc limit 30`);
  const porPrioridade = await rows(sql`select t.priority, count(*)::int as n ${base} and t.parent_task_id is null and t.completed_at is null group by t.priority order by t.priority`);
  const fluxo = await rows(sql`select to_char(date_trunc('week', d.semana), 'YYYY-MM-DD') as semana,
      (select count(*)::int from work_tasks t join work_lists l on l.id = t.list_id where t.organization_id = ${org} and t.parent_task_id is null ${esc} and t.created_at >= d.semana and t.created_at < d.semana + interval '7 days') as criadas,
      (select count(*)::int from work_tasks t join work_lists l on l.id = t.list_id where t.organization_id = ${org} and t.parent_task_id is null ${esc} and t.completed_at >= d.semana and t.completed_at < d.semana + interval '7 days') as concluidas
    from (select generate_series(date_trunc('week', now()) - make_interval(weeks => ${semanas - 1}), date_trunc('week', now()), interval '1 week') as semana) d order by d.semana`);
  const [ciclo] = await rows(sql`select round(avg(extract(epoch from (t.completed_at - t.created_at)) / 86400)::numeric, 1)::float as dias_medios from work_tasks t join work_lists l on l.id = t.list_id where t.organization_id = ${org} and t.completed_at is not null and t.completed_at > now() - interval '90 days' ${esc}`);
  const tempo = await rows(sql`select u.name, round(sum(te.duration_ms) / 3600000.0, 1)::float as horas from work_time_entries te join users u on u.id = te.user_id join work_tasks t on t.id = te.task_id join work_lists l on l.id = t.list_id
    where te.organization_id = ${org} and te.started_at > now() - interval '30 days' ${esc} group by u.name order by horas desc limit 15`);
  return { totais, porStatus, porResponsavel, porPrioridade, fluxo, cicloMedioDias: (ciclo?.dias_medios as number | null) ?? null, tempoPorPessoa30d: tempo };
}
