import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AGENT_NAMES, EXECUTION_COMPLEXITIES } from '@desigual-os/types';
import type { FastifyBaseLogger } from 'fastify';

const classifierResultSchema = z.object({
  intent: z.string(),
  primary_agent: z.enum(AGENT_NAMES),
  required_tools: z.array(z.string()),
  estimated_complexity: z.enum(EXECUTION_COMPLEXITIES),
  workflow: z.array(z.enum(AGENT_NAMES)).nullable(),
});

export type ClassifierResult = z.infer<typeof classifierResultSchema>;

const SYSTEM_PROMPT = `Você classifica pedidos de usuários de uma agência de marketing pro sistema Desigual OS.
Agentes disponíveis: bento (conhecimento institucional, processos, SOPs), jarbas (performance e tráfego pago),
suzy (social selling, WhatsApp/Instagram), studio (geração de imagem/vídeo em GPU).
Responda SÓ com um JSON no formato:
{"intent": string, "primary_agent": "bento"|"jarbas"|"suzy"|"studio", "required_tools": string[],
 "estimated_complexity": "low"|"medium"|"high", "workflow": string[] | null}
workflow só é preenchido (lista ordenada de agentes) se a tarefa precisar de mais de um agente em sequência.`;

/**
 * Camada cara do Router (seção 6.2), só chamada quando o rule engine não
 * teve confiança suficiente. NÃO TESTADO CONTRA A API REAL: não havia
 * ANTHROPIC_API_KEY configurada durante o desenvolvimento deste pacote.
 * A implementação segue a API documentada do SDK oficial; validar contra
 * uma chave real antes de confiar em produção.
 */
export async function classifyWithLLM(message: string, logger: FastifyBaseLogger): Promise<ClassifierResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY not configured, classifier unavailable');
    return null;
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: message }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(textBlock.text);
    return classifierResultSchema.parse(parsed);
  } catch (error) {
    logger.error({ error, raw: textBlock.text }, 'Classifier returned an unparseable response');
    return null;
  }
}
