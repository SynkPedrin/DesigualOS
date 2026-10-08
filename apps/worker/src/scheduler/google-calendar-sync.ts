import { GOOGLE_CALENDAR_PROVIDER, listActiveMemberCalendarAccountIds, syncMemberGoogleCalendar } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

/**
 * Sync periódica do Google Calendar (§25 do prompt "CALENDAR + AUTOMATIONS +
 * BENTO V2": "não full-fetch em toda abertura da página" — a tela lê só o
 * que já está em `calendar_events`; quem mantém isso fresco é este job).
 *
 * UMA CONTA FALHAR NUNCA DERRUBA AS OUTRAS (§80 — mesmo princípio geral de
 * "falha parcial" do prompt, aplicado aqui): token revogado de um
 * colaborador não pode impedir a sync de todo mundo.
 */
export async function syncAllGoogleCalendars(logger: Logger): Promise<void> {
  const contas = await listActiveMemberCalendarAccountIds(GOOGLE_CALENDAR_PROVIDER);
  if (contas.length === 0) return;

  let sucesso = 0;
  let falha = 0;
  for (const accountId of contas) {
    try {
      const resultado = await syncMemberGoogleCalendar(accountId);
      sucesso += 1;
      if (resultado.upserted > 0) logger.info({ accountId, upserted: resultado.upserted, fullSync: resultado.fullSync }, 'Google Calendar sincronizado');
    } catch (error) {
      falha += 1;
      logger.error({ accountId, error }, 'Falha ao sincronizar Google Calendar de uma conta — seguindo pras próximas');
    }
  }
  logger.info({ total: contas.length, sucesso, falha }, 'Sync periódica do Google Calendar concluída');
}
