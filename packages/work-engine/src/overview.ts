import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';
import type { WorkContext } from './context';

type Linha = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>): Promise<Linha[]> => (await db.execute(q)) as unknown as Linha[];

/**
 * Painel do topo da tela (cartões + painel lateral): o que importa HOJE, no escopo escolhido (espaço, lista ou
 * cliente). Tudo da empresa de quem pergunta; "Foco do dia" é sempre da própria pessoa.
 */
export async function workOverview(ctx: WorkContext, scope: { spaceId?: string; listId?: string; clientId?: string } = {}) {
  const org = ctx.organizationId;
  const esc = sql`${scope.spaceId ? sql`and l.space_id = ${scope.spaceId}` : sql``} ${scope.listId ? sql`and t.list_id = ${scope.listId}` : sql``} ${scope.clientId ? sql`and t.client_id = ${scope.clientId}` : sql``}`;
  const base = sql`from work_tasks t join work_lists l on l.id = t.list_id join work_task_statuses s on s.id = t.status_id where t.organization_id = ${org} and t.archived_at is null and t.parent_task_id is null ${esc}`;
  const dia = (ts: string) => sql`((${sql.raw(ts)}) at time zone 'America/Sao_Paulo')::date`;

  const [c] = await rows(sql`select
      count(*) filter (where t.completed_at is null and ${dia('t.due_at')} = ${dia('now()')})::int as hoje,
      count(*) filter (where t.completed_at is null and t.due_at < now() and ${dia('t.due_at')} < ${dia('now()')})::int as atrasadas,
      count(*) filter (where t.completed_at is null and s.category = 'blocked')::int as bloqueadas,
      count(distinct t.client_id) filter (where t.completed_at is null)::int as clientes_ativos,
      count(*) filter (where t.completed_at is null and not exists (select 1 from work_task_assignees a where a.task_id = t.id))::int as sem_responsavel,
      count(*) filter (where s.category = 'done' and s.name ~* '^pronto')::int as prontas_sem_encerrar,
      count(*) filter (where t.completed_at is not null and exists (select 1 from work_tasks f where f.parent_task_id = t.id and f.archived_at is null and f.completed_at is null))::int as concluidas_com_subtarefa_aberta
    ${base}`);
  const [ontem] = await rows(sql`select count(*) filter (where ${dia('t.due_at')} = ${dia("now() - interval '1 day'")})::int as n ${base}`);
  const semAtividade = await rows(sql`select count(*)::int as n from (
      select t.client_id from work_tasks t join work_lists l on l.id = t.list_id
      where t.organization_id = ${org} and t.archived_at is null and t.completed_at is null and t.client_id is not null ${esc}
      group by t.client_id having max(t.updated_at) < now() - interval '7 days') x`);
  const proximas = await rows(sql`select t.id, t.number, t.title, t.due_at, t.priority, l.name as lista, t.client_id, s.name as status, s.color
    ${base} and t.completed_at is null and t.due_at >= now() order by t.due_at asc limit 6`);
  const foco = await rows(sql`select t.id, t.number, t.title, t.version, (t.completed_at is not null) as feita,
      -- Mesma regra do botão Concluir: "encerrado" antes de "concluído/complete", e nunca "pronto" nem "cancelado" se houver outro.
      (select id from work_task_statuses s where s.space_id = l.space_id and s.is_final
         order by case when s.name ~* '^encerrad' then 0 when s.name ~* '^(conclu|complete|done|finaliz)' then 1 when s.name ~* 'cancel|^pronto' then 3 else 2 end, s.position limit 1) as final_id,
      (select id from work_task_statuses s where s.space_id = l.space_id and (s.is_initial or s.category = 'todo')
         order by case when s.name ~* '^aberto$' then 0 when s.name ~* '^open$' then 1 when s.is_initial then 2 else 3 end, s.position limit 1) as initial_id
    from work_tasks t join work_lists l on l.id = t.list_id join work_task_assignees a on a.task_id = t.id and a.user_id = ${ctx.userId}
    where t.organization_id = ${org} and t.archived_at is null and ${dia('t.due_at')} = ${dia('now()')} order by t.completed_at is not null, t.due_at limit 12`);
  return {
    contagens: { hoje: Number(c?.hoje ?? 0), ontem: Number(ontem?.n ?? 0), atrasadas: Number(c?.atrasadas ?? 0), bloqueadas: Number(c?.bloqueadas ?? 0), clientesAtivos: Number(c?.clientes_ativos ?? 0), semResponsavel: Number(c?.sem_responsavel ?? 0), prontasSemEncerrar: Number(c?.prontas_sem_encerrar ?? 0), concluidasComSubtarefaAberta: Number(c?.concluidas_com_subtarefa_aberta ?? 0), clientesSemAtividade: Number(semAtividade[0]?.n ?? 0) },
    proximasEntregas: proximas.map((p) => ({ id: p.id as string, key: `DT-${p.number}`, title: p.title as string, dueAt: new Date(String(p.due_at)).toISOString(), priority: Number(p.priority), lista: p.lista as string, clientId: (p.client_id as string | null) ?? null, status: p.status as string, color: p.color as string })),
    focoDoDia: foco.map((f) => ({ id: f.id as string, key: `DT-${f.number}`, title: f.title as string, version: Number(f.version), feita: Boolean(f.feita), finalId: (f.final_id as string | null) ?? null, initialId: (f.initial_id as string | null) ?? null })),
  };
}
