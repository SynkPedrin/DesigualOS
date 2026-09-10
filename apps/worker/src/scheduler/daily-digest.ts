import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { Logger } from '@desigual-os/logging';

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Fim de dia (pedido do usuário): compila o que cada colaborador terminou
 * hoje num checklist e grava como memória do Bento (kind='daily_checklist'),
 * de fato "atualizando a base de dados do Bento" como pedido, não é só uma
 * notificação solta.
 */
export async function runEndOfDayChecklist(logger: Logger): Promise<void> {
  const todayStart = startOfDay(new Date());

  const completedToday = await db
    .select()
    .from(schema.executions)
    .where(and(eq(schema.executions.status, 'completed'), gte(schema.executions.completedAt, todayStart)));

  const byUser = new Map<string, typeof completedToday>();
  for (const execution of completedToday) {
    const list = byUser.get(execution.userId) ?? [];
    list.push(execution);
    byUser.set(execution.userId, list);
  }

  const [bento] = await db.select().from(schema.agents).where(eq(schema.agents.name, 'bento'));

  for (const [userId, executions] of byUser) {
    const checklist = executions
      .map((execution) => `- [x] (${execution.agent}) ${execution.intent} - ${execution.executionId}`)
      .join('\n');
    const content = `Checklist de ${todayStart.toISOString().slice(0, 10)}:\n${checklist}`;

    if (bento) {
      await db.insert(schema.memories).values({
        agentId: bento.id,
        userId,
        kind: 'daily_checklist',
        content,
        metadata: { date: todayStart.toISOString().slice(0, 10), execution_count: executions.length },
      });
    }

    await db.insert(schema.notifications).values({
      userId,
      type: 'daily_checklist',
      title: 'Checklist do dia',
      body: `${executions.length} tarefa(s) concluída(s) hoje.`,
    });
  }

  logger.info({ users: byUser.size }, 'End-of-day checklist generated');
}

/**
 * Manhã (pedido do usuário): centraliza o que ainda está pendente/travado
 * pra cada colaborador se organizar no início do dia.
 */
export async function runMorningBriefing(logger: Logger): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stuckOrFailed = await db
    .select()
    .from(schema.executions)
    .where(
      and(
        ne(schema.executions.status, 'completed'),
        inArray(schema.executions.status, ['queued', 'running', 'failed']),
        lt(schema.executions.createdAt, oneHourAgo),
        gte(schema.executions.createdAt, twentyFourHoursAgo),
      ),
    );

  const byUser = new Map<string, typeof stuckOrFailed>();
  for (const execution of stuckOrFailed) {
    const list = byUser.get(execution.userId) ?? [];
    list.push(execution);
    byUser.set(execution.userId, list);
  }

  for (const [userId, executions] of byUser) {
    const pending = executions.map((execution) => `- (${execution.agent}) ${execution.intent}: ${execution.status}`).join('\n');

    await db.insert(schema.notifications).values({
      userId,
      type: 'morning_briefing',
      title: 'Pendências de ontem',
      body: `${executions.length} item(ns) pendente(s) ou travado(s):\n${pending}`,
    });
  }

  logger.info({ users: byUser.size }, 'Morning briefing generated');
}
