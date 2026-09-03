import { z } from 'zod';
import { AGENT_NAMES, EXECUTION_COMPLEXITIES } from '@desigual-os/types';

/**
 * Saída padrão do AI Router (seção 6.2). client_id fica de fora daqui
 * porque o Router não recebe isso na mensagem, quem sabe o cliente ativo é
 * quem chama (seção de chat); ele é anexado depois, fora deste pacote.
 */
export const routerDecisionSchema = z.object({
  intent: z.string(),
  primary_agent: z.enum(AGENT_NAMES),
  required_tools: z.array(z.string()),
  context: z.array(z.string()),
  estimated_complexity: z.enum(EXECUTION_COMPLEXITIES),
  workflow: z.array(z.enum(AGENT_NAMES)).nullable(),
  confidence: z.number().min(0).max(1),
  source: z.enum(['rule_engine', 'classifier', 'manual']),
});

export type RouterDecision = z.infer<typeof routerDecisionSchema>;
