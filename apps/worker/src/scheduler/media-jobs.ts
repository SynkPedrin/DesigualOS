import { enqueueClientReport } from '@desigual-os/orchestrator';
import { runAlertEvaluation, runDueReportSchedules, syncGoogleMedia, syncMediaForCentralConnection } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

/**
 * Jobs do Media Command Center.
 *
 * A sincronização leva minutos (19 contas, três níveis cada) e o worker do
 * scheduler é UM só, compartilhado com briefing, health e varredura do Bento.
 * Se ela rodasse dentro do handler, todos esses esperariam. Por isso o handler
 * só DISPARA e volta; o trabalho segue em segundo plano com uma trava em
 * memória que impede duas sincronizações simultâneas (a segunda é descartada,
 * a próxima rodada cobre).
 */

let syncing = false;

export function startMediaSync(logger: Logger): void {
  if (syncing) {
    logger.info('[media-sync] rodada anterior ainda em andamento, pulando');
    return;
  }
  syncing = true;
  const started = Date.now();
  void syncMediaForCentralConnection()
    .then((report) => {
      if ('status' in report) {
        logger.info('[media-sync] conexão central não está ativa, nada a sincronizar');
        return;
      }
      logger.info(
        { accounts: report.accounts, synced: report.accountsSynced, failed: report.accountsFailed.length, rows: report.rows, seconds: Math.round((Date.now() - started) / 1000) },
        '[media-sync] concluído',
      );
      for (const f of report.accountsFailed) logger.warn({ accountId: f.accountId, error: f.error }, '[media-sync] conta falhou — as outras seguiram');
    })
    .catch((error: unknown) => logger.error({ motivo: error instanceof Error ? error.message : String(error) }, '[media-sync] falhou'))
    // Google Ads na sequência: outra API, outros limites; uma falha não afeta a outra.
    .then(() => syncGoogleMedia())
    .then((g) => {
      if (g.links > 0) logger.info({ links: g.links, synced: g.accountsSynced, failed: g.accountsFailed.length, rows: g.rows }, '[media-sync] Google Ads concluído');
      for (const f of g.accountsFailed) logger.warn({ customerId: f.customerId, error: f.error }, '[media-sync] conta Google falhou');
    })
    .catch((error: unknown) => logger.error({ motivo: error instanceof Error ? error.message : String(error) }, '[media-sync] Google falhou'))
    .finally(() => {
      syncing = false;
    });
}

/** Avalia as regras de alerta. Rápido (só banco), roda no handler mesmo. */
export async function runMediaAlerts(logger: Logger): Promise<void> {
  try {
    const summary = await runAlertEvaluation();
    if (summary.rulesEvaluated > 0) logger.info(summary, '[media-alerts] avaliação concluída');
  } catch (error) {
    logger.error({ motivo: error instanceof Error ? error.message : String(error) }, '[media-alerts] falhou');
  }
}

/** Gera os relatórios agendados que venceram. Cada período é gerado uma vez (ver media-report-schedules.ts). */
export async function runMediaReportSchedules(logger: Logger): Promise<void> {
  try {
    const summary = await runDueReportSchedules(enqueueClientReport);
    if (summary.generated > 0 || summary.failed.length > 0) logger.info(summary, '[media-reports] agendamentos processados');
  } catch (error) {
    logger.error({ motivo: error instanceof Error ? error.message : String(error) }, '[media-reports] falhou');
  }
}
