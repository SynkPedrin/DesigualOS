import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { todayIn } from './media-metrics';

/**
 * media-report-schedules.ts — agendamento de relatórios de mídia.
 *
 * Não existe um gerador novo nem um agendador exclusivo de agente: um
 * agendamento só CRIA o mesmo `client_reports` que o botão "Gerar relatório"
 * cria e o enfileira no mesmo worker. Idempotência pela `lastPeriodKey`: o
 * job pode rodar a cada 15 min e o período só é gerado uma vez.
 */

export interface ScheduleLike {
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number;
  timezone: string;
  lastPeriodKey: string | null;
  lastRunAt: Date | null;
}

function localParts(now: Date, timeZone: string): { date: string; hour: number; weekday: number; day: number } {
  const date = todayIn(now, timeZone);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(now));
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { date, hour: hour === 24 ? 0 : hour, weekday, day: Number(date.slice(8)) };
}

/** A chave do período que ESTE momento representaria, ou null se o agendamento não vence agora. */
export function dueKey(s: ScheduleLike, now: Date): string | null {
  const t = localParts(now, s.timezone);
  if (t.hour < s.hour) return null;
  switch (s.frequency) {
    case 'daily':
      break;
    case 'weekly':
      if (s.dayOfWeek === null || t.weekday !== s.dayOfWeek) return null;
      break;
    case 'biweekly':
      if (s.dayOfWeek === null || t.weekday !== s.dayOfWeek) return null;
      // quinzenal: só se a última geração foi há 13+ dias (ou nunca)
      if (s.lastRunAt && now.getTime() - s.lastRunAt.getTime() < 13 * 86_400_000) return null;
      break;
    case 'monthly':
      if (s.dayOfMonth === null || t.day !== s.dayOfMonth) return null;
      break;
    default:
      return null;
  }
  return t.date;
}

export function isDue(s: ScheduleLike, now: Date): boolean {
  const key = dueKey(s, now);
  return key !== null && key !== s.lastPeriodKey;
}

export interface ScheduleRunSummary {
  evaluated: number;
  generated: number;
  skipped: number;
  failed: Array<{ scheduleId: string; error: string }>;
}

/** `enqueue` é injetado: o worker passa o enfileirador real; teste passa um falso. */
export async function runDueReportSchedules(enqueue: (reportId: string) => Promise<void>, now = new Date()): Promise<ScheduleRunSummary> {
  const summary: ScheduleRunSummary = { evaluated: 0, generated: 0, skipped: 0, failed: [] };
  const schedules = await db.select().from(schema.mediaReportSchedules).where(eq(schema.mediaReportSchedules.enabled, true));
  for (const s of schedules) {
    summary.evaluated += 1;
    const key = dueKey(s, now);
    if (!key || key === s.lastPeriodKey) {
      summary.skipped += 1;
      continue;
    }
    if (!s.createdBy) {
      summary.failed.push({ scheduleId: s.id, error: 'agendamento sem responsável (quem criou foi removido)' });
      continue;
    }
    try {
      // Reserva o período ANTES de gerar: duas execuções simultâneas disputam este UPDATE e só uma ganha.
      const claimed = await db
        .update(schema.mediaReportSchedules)
        .set({ lastPeriodKey: key, lastRunAt: now })
        .where(and(eq(schema.mediaReportSchedules.id, s.id), s.lastPeriodKey === null ? undefined : eq(schema.mediaReportSchedules.lastPeriodKey, s.lastPeriodKey)))
        .returning({ id: schema.mediaReportSchedules.id });
      if (claimed.length === 0) {
        summary.skipped += 1;
        continue;
      }
      const periodEnd = now;
      const periodStart = new Date(now.getTime() - s.periodDays * 86_400_000);
      const [report] = await db
        .insert(schema.clientReports)
        .values({ organizationId: s.organizationId, clientId: s.clientId, requestedBy: s.createdBy, channels: s.channels, periodDays: s.periodDays, periodStart, periodEnd })
        .returning({ id: schema.clientReports.id });
      await enqueue(report!.id);
      summary.generated += 1;
    } catch (error) {
      summary.failed.push({ scheduleId: s.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return summary;
}
