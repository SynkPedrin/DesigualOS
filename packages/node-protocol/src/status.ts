import { z } from 'zod';
import { AGENT_NAMES, NODE_TYPES } from '@desigual-os/types';

/**
 * Endpoints locais que todo Node Agent expõe (seção 7.1): GET /health,
 * GET /status, GET /capabilities. Não confundir com o healthcheck da API
 * central em apps/api.
 */
export const nodeHealthResponseSchema = z.object({
  status: z.literal('ok'),
  node_id: z.string(),
  timestamp: z.string(),
});

export type NodeHealthResponse = z.infer<typeof nodeHealthResponseSchema>;

export const nodeStatusResponseSchema = z.object({
  node_id: z.string(),
  agent: z.enum(AGENT_NAMES),
  type: z.enum(NODE_TYPES),
  version: z.string(),
  agent_status: z.string(),
  uptime_seconds: z.number().nonnegative(),
});

export type NodeStatusResponse = z.infer<typeof nodeStatusResponseSchema>;

export const nodeCapabilitiesResponseSchema = z.object({
  node_id: z.string(),
  capabilities: z.array(z.string()),
});

export type NodeCapabilitiesResponse = z.infer<typeof nodeCapabilitiesResponseSchema>;
