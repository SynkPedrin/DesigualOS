import { z } from 'zod';
import { NODE_STATUSES } from '@desigual-os/types';

/**
 * Payload enviado a cada 10s por cada node (seção 6.1). Os campos gpu, vram,
 * temperature, queue_depth e active_job só o Studio preenche (seção 7.3);
 * ficam opcionais aqui em vez de um schema separado, para manter um único
 * formato de heartbeat em todos os nodes.
 */
export const heartbeatRequestSchema = z.object({
  node_id: z.string().min(1),
  status: z.enum(NODE_STATUSES),
  cpu: z.number().min(0).max(100).optional(),
  ram: z.number().min(0).max(100).optional(),
  disk: z.number().min(0).max(100).optional(),
  agent_status: z.string().optional(),
  openclaw: z.string().optional(),
  latency_ms: z.number().nonnegative().optional(),
  timestamp: z.string(),
  gpu: z.number().min(0).max(100).optional(),
  vram: z.number().nonnegative().optional(),
  temperature: z.number().optional(),
  queue_depth: z.number().nonnegative().optional(),
  active_job: z.string().nullable().optional(),
});

export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

export const heartbeatResponseSchema = z.object({
  node_id: z.string(),
  acknowledged_at: z.string(),
});

export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;
