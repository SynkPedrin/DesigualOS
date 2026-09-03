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
