import type { z } from 'zod';
import type { Logger } from '@desigual-os/logging';
import {
  callResponses,
  isOpenAICredentialConfigured,
  pickModel,
  type OpenAITaskKind,
  type ResponsesRequest,
} from '@desigual-os/openai-provider';
import type { FastifyBaseLogger } from 'fastify';
import { OttoLLMError, tryParse, type OttoChatMessage, type OttoChatOptions, type OttoLLMHealth, type OttoLLMProvider } from './ollama-provider.js';

/**
 * Provider OpenAI do Otto (seção 25 da missão de release OpenAI + ClickUp
 * MCP: "Migrate Otto user-facing text intelligence from Ollama to OpenAI").
 * Mesma interface `OttoLLMProvider` do Ollama — o resto do pacote (planner,
 * critic, quality) não sabe qual provider está por trás.
 *
 * `callResponses` já não dá `tools` nenhuma pra esta chamada (chamada de
 * texto/JSON pura) — mesma regra de `packages/router/src/safe-complete.ts`:
 * nenhuma ferramenta disponível, então nada que o texto de entrada diga vira
 * ação real.
 */
export interface OttoOpenAIProviderConfig {
  /** Escalada de dificuldade explícita do chamador (ex: crítica pediu "ficou genérico" → difícil). */
  taskKind?: OpenAITaskKind;
  maxOutputTokens?: number;
  logger?: Logger;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1400; // seção 9: Otto ~1000-1400 quando necessário

function toResponsesInput(messages: OttoChatMessage[]): { instructions: string; input: string } {
  // Prefixo estável primeiro (seção 10, prompt caching): mensagens de
  // sistema concatenadas viram `instructions`; o resto (user/assistant,
  // conteúdo dinâmico do turno) vira `input`.
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const rest = messages.filter((m) => m.role !== 'system');
  const instructions = systemParts.join('\n\n');
  const input = rest.map((m) => `[${m.role}] ${m.content}`).join('\n\n');
  return { instructions, input };
}

export function createOttoOpenAIProvider(config: OttoOpenAIProviderConfig = {}): OttoLLMProvider {
  const logger = (config.logger ?? console) as unknown as FastifyBaseLogger;
  const taskKind = config.taskKind ?? 'otto_creative_normal';

  async function call(messages: OttoChatMessage[], opts: OttoChatOptions | undefined, jsonMode: boolean): Promise<string> {
    if (!isOpenAICredentialConfigured()) {
      throw new OttoLLMError(
        'OPENAI_API_KEY não configurada. Otto não tem provider Ollama de fallback automático nesta chamada (regra de release: nenhum downgrade silencioso de qualidade) — configure a credencial ou aponte OTTO_LLM_PROVIDER=ollama explicitamente.',
      );
    }
    const { instructions, input } = toResponsesInput(messages);
    // Sol só em escalada explícita — nunca por budget tier aqui, o chamador
    // (planner/critic) decide `taskKind`; o downgrade de orçamento é
    // aplicado dentro de `pickModel` a partir do tier real do ledger, que
    // este módulo não consulta diretamente (fica a cargo do call site que
    // tem o `organizationId`, ver CLAUDE_RELEASE_HANDOFF.md).
    const decision = pickModel(taskKind, 'normal');
    const request: ResponsesRequest = {
      model: decision.model,
      instructions: jsonMode
        ? `${instructions}\n\nResponda SOMENTE com um JSON válido, sem markdown, sem texto antes ou depois.`
        : instructions,
      input,
      maxOutputTokens: opts?.numPredict ?? config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    };
    const result = await callResponses(request, logger);
    if (!result.outputText.trim()) {
      throw new OttoLLMError('OpenAI Responses retornou conteúdo vazio');
    }
    return result.outputText;
  }

  return {
    async chat(messages, opts) {
      return call(messages, opts, false);
    },

    async chatJson(messages, schema, opts) {
      const first = await call(messages, opts, true);
      const firstResult = tryParse(first, schema);
      if (firstResult.ok) return firstResult.value;

      logger.warn?.({ error: firstResult.error }, 'Otto (OpenAI) chatJson: resposta inválida, tentando correção');

      const correction: OttoChatMessage[] = [
        ...messages,
        { role: 'assistant', content: first },
        {
          role: 'user',
          content: `Sua resposta anterior não é um JSON válido para o schema esperado. Erro: ${firstResult.error}. Responda SOMENTE com o JSON corrigido, sem markdown, sem texto antes ou depois.`,
        },
      ];
      const second = await call(correction, opts, true);
      const secondResult = tryParse(second, schema);
      if (secondResult.ok) return secondResult.value;

      throw new OttoLLMError(`OpenAI chatJson falhou validação de schema após retry de correção: ${secondResult.error}`);
    },

    async healthCheck(): Promise<OttoLLMHealth> {
      const decision = pickModel(taskKind, 'normal');
      if (!isOpenAICredentialConfigured()) {
        return {
          status: 'down',
          detail: 'OPENAI_API_KEY não configurada — Otto não pode responder via OpenAI até a credencial existir no ambiente do servidor.',
          model: decision.model,
          baseUrl: 'https://api.openai.com',
        };
      }
      // Não fazemos chamada real aqui (regra da missão: zero custo pago em
      // validação) — presença de credencial é o único critério de "ok"
      // neste healthCheck estático. Falha real de rede/autenticação só
      // aparece na primeira chamada de verdade.
      return {
        status: 'ok',
        detail: `Credencial OpenAI configurada, modelo alvo "${decision.model}"`,
        model: decision.model,
        baseUrl: 'https://api.openai.com',
      };
    },
  };
}
