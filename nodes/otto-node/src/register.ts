import {
  registerNodeRequestSchema,
  registerNodeResponseSchema,
  type RegisterNodeResponse,
} from '@desigual-os/node-protocol';
import type { Logger } from '@desigual-os/logging';
import { OTTO_CAPABILITIES, type OttoNodeConfig } from './config';
import { authHeaders } from './security/index';

export async function registerWithOrchestrator(
  config: OttoNodeConfig,
  logger: Logger,
): Promise<RegisterNodeResponse> {
  const payload = registerNodeRequestSchema.parse({
    node_id: config.NODE_ID,
    agent: config.AGENT_NAME,
    type: config.NODE_TYPE,
    private_host: config.PRIVATE_HOST,
    capabilities: [...OTTO_CAPABILITIES],
    version: config.VERSION,
  });

  const response = await fetch(`${config.ORCHESTRATOR_URL}/nodes/register`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Registration failed with status ${response.status}: ${await response.text()}`);
  }

  const result = registerNodeResponseSchema.parse(await response.json());
  logger.info({ node_id: result.node_id }, 'Registered with Orchestrator');
  return result;
}
