import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * Lembretes de prazo, no sino do sistema: "vence nas próximas 24 h" e "venceu". Cada tarefa avisa UMA vez por tipo
 * (a janela de dedupe evita repetir a cada ciclo). Só tarefas abertas e não arquivadas; vai para quem é responsável
 * (e, sem responsável, para quem criou).
 */
export async function runDueReminders(now = new Date()): Promise<{ vencendo: number; vencidas: number }> {
  const T = schema.workTasks;
  const em24h = new Date(now.getTime() + 24 * 3_600_000);
  // Só empresas com o módulo LIGADO: ninguém recebe aviso de um recurso que ainda está desligado para ela.
  const base = [isNull(T.completedAt), isNull(T.archivedAt), sql`exists (select 1 from work_feature_flags f where f.organization_id = ${T.organizationId} and f.key = 'daily_tasks_enabled' and f.enabled)`];
  const [vencendo, vencidas] = await Promise.all([
    db.select({ id: T.id, number: T.number, title: T.title, org: T.organizationId, due: T.dueAt, createdBy: T.createdBy }).from(T).where(and(...base, gte(T.dueAt, now), lt(T.dueAt, em24h))).limit(500),
    db.select({ id: T.id, number: T.number, title: T.title, org: T.organizationId, due: T.dueAt, createdBy: T.createdBy }).from(T).where(and(...base, lt(T.dueAt, now), gte(T.dueAt, new Date(now.getTime() - 14 * 86_400_000)))).limit(500),
  ]);
  let n1 = 0; let n2 = 0;
  for (const [lista, tipo, janela] of [[vencendo, 'work.due_soon', '20 hours'], [vencidas, 'work.overdue', '7 days']] as const) {
    for (const t of lista) {
      const resp = await db.select({ u: schema.workTaskAssignees.userId }).from(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.taskId, t.id));
      const alvo = resp.length ? resp.map((r) => r.u) : t.createdBy ? [t.createdBy] : [];
      const link = `/daily-tasks?task=${t.id}`;
      for (const userId of alvo) {
        const [ja] = await db.select({ id: schema.notifications.id }).from(schema.notifications).where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.type, tipo), eq(schema.notifications.link, link), sql`${schema.notifications.createdAt} > now() - ${janela}::interval`)).limit(1);
        if (ja) continue;
        const quando = t.due!.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
        await db.insert(schema.notifications).values({ userId, type: tipo, title: tipo === 'work.due_soon' ? `Vence em breve (${quando}): DT-${t.number} ${t.title}` : `Atrasada desde ${quando}: DT-${t.number} ${t.title}`, body: null, link });
        if (tipo === 'work.due_soon') n1++; else n2++;
      }
    }
  }
  return { vencendo: n1, vencidas: n2 };
}
