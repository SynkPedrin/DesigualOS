import { z } from 'zod';
import { AGENT_NAMES, NODE_TYPES } from '@desigual-os/types';

/**
 * Payload que cada Node Agent envia ao subir (seção 6.1 do prompt mestre).
 * Chaves em snake_case porque este é o contrato de rede, não uma estrutura interna.
 */
export const registerNodeRequestSchema = z.object({
  node_id: z.string().min(1),
  agent: z.enum(AGENT_NAMES),
  type: z.enum(NODE_TYPES),
  private_host: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  version: z.string().min(1),
});

export type RegisterNodeRequest = z.infer<typeof registerNodeRequestSchema>;

export const registerNodeResponseSchema = z.object({
  node_id: z.string(),
  status: z.literal('online'),
  registered_at: z.string(),
});

export type RegisterNodeResponse = z.infer<typeof registerNodeResponseSchema>;
