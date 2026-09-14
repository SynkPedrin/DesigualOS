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

// Teto da chamada ao LLM no caminho síncrono do /chat (ver classifyWithLLM).
const CLASSIFIER_TIMEOUT_MS = 10_000;

const SYSTEM_PROMPT = `Você classifica pedidos de usuários de uma agência de marketing pro sistema Desigual OS.
Agentes disponíveis: bento (conhecimento institucional, processos, SOPs), jarbas (performance e tráfego pago),
suzy (social selling, WhatsApp/Instagram), studio (geração de imagem/vídeo em GPU),
otto (direção criativa: campanhas, carrosséis, conceitos, copy, direção de arte, prompts de imagem/vídeo).
Responda SÓ com um JSON no formato:
{"intent": string, "primary_agent": "bento"|"jarbas"|"suzy"|"studio"|"otto", "required_tools": string[],
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

  // Timeout explícito (achado da auditoria, 2026-09): esta chamada roda no
  // caminho SÍNCRONO do POST /chat, então uma API da Anthropic lenta/travada
  // segurava a resposta do usuário indefinidamente. maxRetries: 0 porque os 2
  // retries padrão do SDK multiplicariam a espera além do teto de 10s.
  const client = new Anthropic({ apiKey, timeout: CLASSIFIER_TIMEOUT_MS, maxRetries: 0 });

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message }],
    });
  } catch (error) {
    // Timeout = classifier indisponível: devolve null e o Router cai pro
    // rule engine/Bento, mesmo fallback de quando a chave não existe. Outros
    // erros (auth, schema da API) seguem propagando como antes.
    if (error instanceof Error && error.name === 'APIConnectionTimeoutError') {
      logger.warn({ timeoutMs: CLASSIFIER_TIMEOUT_MS }, 'Classifier LLM timed out, falling back to rules');
      return null;
    }
    throw error;
  }

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
