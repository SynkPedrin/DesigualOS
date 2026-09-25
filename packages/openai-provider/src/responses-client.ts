import OpenAI from 'openai';
import type { FastifyBaseLogger } from 'fastify';
import { resolveOpenAICredential } from './credential.js';
import { MAX_TOOL_STEPS, type OpenAIModelId, type UsageTokens } from './models.js';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Runtime agêntico via Responses API (seção 4/20 da missão). Fino de
 * propósito: quem decide tool/policy/write é a camada de política do
 * chamador (Bento/Otto), este client só fala com a OpenAI e devolve
 * resultado + uso real de tokens.
 *
 * Nenhum teste desta missão chama isto de verdade (regra: zero custo pago
 * OpenAI). Toda cobertura de teste deve mockar `OpenAI` / injetar um client
 * fake via `createOpenAIClient` overload de teste, nunca bater na rede.
 */
export interface ResponsesToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ResponsesRequest {
  model: OpenAIModelId;
  /** Prefixo estável (seção 10, prompt caching): instruções, identidade, política de tool, definições de tool. */
  instructions: string;
  /** Conteúdo dinâmico, SEMPRE depois do prefixo estável. */
  input: string;
  tools?: ResponsesToolDefinition[];
  maxOutputTokens: number;
  previousResponseId?: string;
}

export interface ResponsesResult {
  responseId: string;
  outputText: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage: UsageTokens;
  model: OpenAIModelId;
}

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const { apiKey } = resolveOpenAICredential();
  cachedClient = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
  return cachedClient;
}

/** Só para teste: injeta um client fake e evita qualquer chamada de rede real. */
export function __setOpenAIClientForTest(client: OpenAI | null): void {
  cachedClient = client;
}

/**
 * Uma chamada única à Responses API. Retry: no máximo 1 vez, só para erro
 * claramente retryable (timeout, 429, 5xx) — seção 35, nunca loop.
 */
export async function callResponses(
  request: ResponsesRequest,
  logger: FastifyBaseLogger,
): Promise<ResponsesResult> {
  const client = getClient();
  const attempt = async (): Promise<ResponsesResult> => {
    const response = await client.responses.create({
      model: request.model,
      instructions: request.instructions,
      input: request.input,
      max_output_tokens: request.maxOutputTokens,
      ...(request.previousResponseId ? { previous_response_id: request.previousResponseId } : {}),
      tools: request.tools as never,
    });

    const toolCalls = (response.output ?? [])
      .filter((item): item is Extract<typeof item, { type: 'function_call' }> => item.type === 'function_call')
      .map((item) => ({ id: item.call_id ?? item.id, name: item.name, arguments: item.arguments }));

    const usage: UsageTokens = {
      inputTokens: response.usage?.input_tokens ?? 0,
      cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };

    return {
      responseId: response.id,
      outputText: response.output_text ?? '',
      toolCalls,
      usage,
      model: request.model,
    };
  };

  try {
    return await attempt();
  } catch (error) {
    const retryable = isRetryableError(error);
    logger.warn({ error: error instanceof Error ? error.message : String(error), retryable }, 'OpenAI Responses call failed');
    if (!retryable) throw error;
    return attempt();
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    return error.status === 429 || (error.status !== undefined && error.status >= 500);
  }
  if (error instanceof Error) {
    return error.name === 'APIConnectionTimeoutError' || error.name === 'APIConnectionError';
  }
  return false;
}

export { MAX_TOOL_STEPS };
