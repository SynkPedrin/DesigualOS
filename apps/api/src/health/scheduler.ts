import { and, eq, inArray, lt } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { Logger } from '@desigual-os/logging';
import { HEALTH_SWEEP_INTERVAL_MS, HEALTH_THRESHOLDS_MS } from './thresholds.js';

/**
 * Rebaixa nodes que pararam de mandar heartbeat. 'maintenance', 'busy' e
 * 'rendering' ficam de fora de propósito: maintenance é override manual do
 * operador (POST /nodes/:node_id/command); busy/rendering ainda não existem
 * de verdade (entram na Fase 4+), então não vale a pena o sweep decidir o
 * que fazer com eles ainda.
 */
async function sweepStaleNodes(): Promise<void> {
  const now = Date.now();
  const offlineCutoff = new Date(now - HEALTH_THRESHOLDS_MS.offline);
  const degradedCutoff = new Date(now - HEALTH_THRESHOLDS_MS.degraded);
  const warningCutoff = new Date(now - HEALTH_THRESHOLDS_MS.warning);

  await db
    .update(schema.nodes)
    .set({ status: 'offline', updatedAt: new Date() })
    .where(
      and(
        inArray(schema.nodes.status, ['online', 'warning', 'degraded']),
        lt(schema.nodes.lastHeartbeatAt, offlineCutoff),
      ),
    );

  await db
    .update(schema.nodes)
    .set({ status: 'degraded', updatedAt: new Date() })
    .where(
      and(inArray(schema.nodes.status, ['online', 'warning']), lt(schema.nodes.lastHeartbeatAt, degradedCutoff)),
    );

  await db
    .update(schema.nodes)
    .set({ status: 'warning', updatedAt: new Date() })
    .where(and(eq(schema.nodes.status, 'online'), lt(schema.nodes.lastHeartbeatAt, warningCutoff)));
}

export function startHealthSweep(logger: Logger): NodeJS.Timeout {
  return setInterval(() => {
    void sweepStaleNodes().catch((error: unknown) => {
      logger.error({ error }, 'Health sweep failed');
    });
  }, HEALTH_SWEEP_INTERVAL_MS);
}


/**
 * Retenção do histórico de saúde.
 *
 * Achado real (11/09/2026, medido no banco): `health_checks` tinha 93.661
 * linhas e crescia 21.367 POR DIA (5 agentes x 6 sondagens por minuto), sem
 * nada que apagasse nada - desde 03/09. Em um ano seriam ~7,8 milhões de
 * linhas. E não é só espaço: a consulta do painel de Monitoramento
 * (selectDistinctOn em health/routes.ts) varre essa tabela inteira pra
 * devolver 10 linhas - medido em 85ms hoje, e piorando todo dia.
 *
 * 7 dias é o bastante pro que esse histórico serve (ver o que aconteceu
 * durante um incidente recente); nada no sistema lê health_check mais velho
 * que isso.
 */
const HEALTH_CHECK_RETENTION_DAYS = 7;
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60_000;

export async function pruneOldHealthChecks(): Promise<number> {
  const cutoff = new Date(Date.now() - HEALTH_CHECK_RETENTION_DAYS * 24 * 60 * 60_000);
  const deleted = await db
    .delete(schema.healthChecks)
    .where(lt(schema.healthChecks.createdAt, cutoff))
    .returning({ id: schema.healthChecks.id });
  return deleted.length;
}

export function startHealthCheckRetention(logger: Logger): NodeJS.Timeout {
  const run = () => {
    void pruneOldHealthChecks()
      .then((deleted) => {
        if (deleted > 0) logger.info({ deleted, dias: HEALTH_CHECK_RETENTION_DAYS }, 'Histórico de saúde antigo removido');
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'Limpeza do histórico de saúde falhou');
      });
  };
  run();
  return setInterval(run, RETENTION_SWEEP_INTERVAL_MS);
}
