import { z } from 'zod';
import { AGENT_NAMES } from '@desigual-os/types';

/**
 * POST /execute (seção 7.1). message é o prompt já resolvido pelo Context
 * Engine (Fase 11); context_refs são recortes que o Node deve buscar
 * localmente sob demanda (ex: Obsidian), nunca um dump inteiro.
 */
export const executeRequestSchema = z.object({
  execution_id: z.string().min(1),
  message: z.string().min(1),
  context_refs: z.array(z.string()).default([]),
});

export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

export const executeResultStatusSchema = z.enum(['completed', 'failed', 'timeout']);

export const executeResponseSchema = z.object({
  execution_id: z.string(),
  agent: z.enum(AGENT_NAMES),
  status: executeResultStatusSchema,
  answer: z.string().nullable(),
  sources: z.array(z.string()).default([]),
  tool_calls: z.array(z.unknown()).default([]),
  usage: z.object({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
  }),
  error: z.string().nullable().optional(),
});

export type ExecuteResponse = z.infer<typeof executeResponseSchema>;
