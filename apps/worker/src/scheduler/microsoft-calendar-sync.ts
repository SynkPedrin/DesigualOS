import { MICROSOFT_CALENDAR_PROVIDER, listActiveMemberCalendarAccountIds, syncMemberMicrosoftCalendar } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

/**
 * Sync periódica do Microsoft 365/Outlook Calendar (07/10/2026) — mesmo
 * papel de google-calendar-sync.ts: a tela lê só o que já está em
 * `calendar_events`, quem mantém isso fresco é este job.
 *
 * UMA CONTA FALHAR NUNCA DERRUBA AS OUTRAS — mesmo princípio do Google.
 */
export async function syncAllMicrosoftCalendars(logger: Logger): Promise<void> {
  const contas = await listActiveMemberCalendarAccountIds(MICROSOFT_CALENDAR_PROVIDER);
  if (contas.length === 0) return;

  let sucesso = 0;
  let falha = 0;
  for (const accountId of contas) {
    try {
      const resultado = await syncMemberMicrosoftCalendar(accountId);
      sucesso += 1;
      if (resultado.upserted > 0 || resultado.cancelled > 0) logger.info({ accountId, upserted: resultado.upserted, cancelled: resultado.cancelled }, 'Microsoft Calendar sincronizado');
    } catch (error) {
      falha += 1;
      logger.error({ accountId, error }, 'Falha ao sincronizar Microsoft Calendar de uma conta — seguindo pras próximas');
    }
  }
  logger.info({ total: contas.length, sucesso, falha }, 'Sync periódica do Microsoft Calendar concluída');
}
