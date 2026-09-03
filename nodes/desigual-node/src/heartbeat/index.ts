import { heartbeatRequestSchema, heartbeatResponseSchema } from '@desigual-os/node-protocol';
import type { Logger } from '@desigual-os/logging';
import type { NodeConfig } from '../config.js';
import { collectMetrics } from '../metrics/index.js';
import { authHeaders } from '../security/index.js';
import { runtimeState } from '../state.js';

async function sendHeartbeat(config: NodeConfig, logger: Logger): Promise<void> {
  const startedAt = Date.now();
  const metrics = await collectMetrics();

  const payload = heartbeatRequestSchema.parse({
    node_id: config.NODE_ID,
    status: 'online',
    cpu: metrics.cpu,
    ram: metrics.ram,
    disk: metrics.disk,
    agent_status: runtimeState.agentStatus,
    openclaw: 'unknown',
    latency_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });

  const response = await fetch(`${config.ORCHESTRATOR_URL}/nodes/${config.NODE_ID}/heartbeat`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'Heartbeat rejected by Orchestrator');
    return;
  }

  heartbeatResponseSchema.parse(await response.json());
  logger.debug('Heartbeat sent');
}

export function startHeartbeatLoop(config: NodeConfig, logger: Logger): NodeJS.Timeout {
  void sendHeartbeat(config, logger).catch((error: unknown) => {
    logger.error({ error }, 'Initial heartbeat failed');
  });

  return setInterval(() => {
    void sendHeartbeat(config, logger).catch((error: unknown) => {
      logger.error({ error }, 'Heartbeat failed');
    });
  }, config.HEARTBEAT_INTERVAL_MS);
}
