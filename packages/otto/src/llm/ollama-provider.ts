import type { Logger } from '@desigual-os/logging';
import type { z } from 'zod';
import { parseJsonLoose } from './json-extract.js';

/**
 * Erro estruturado do provider de LLM do Otto. Nunca engolimos falha de LLM:
 * o planner decide o que fazer (retry, fallback, abortar), mas a falha sobe
 * com causa preservada pra auditoria.
 */
export class OttoLLMError extends Error {
  constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OttoLLMError';
  }
}

export interface OttoChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OttoLLMProviderConfig {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  /**
   * Janela de contexto enviada ao Ollama. Precisa ser EXPLÍCITA: o Ollama usa 4096 por default
   * mesmo quando o modelo aceita muito mais (qwen2.5:3b declara 32768 em /api/show), e o que
   * passa disso é truncado em SILÊNCIO. O system prompt do Otto (persona + trechos do Brain)
   * passa de 4k tokens, então sem isto a persona chegava cortada no modelo e a resposta saía
   * sem voz de Otto nenhuma (medido ao vivo em 08/09/2026, briefing da Fratelli).
   */
  numCtx?: number;
  /**
   * Quanto tempo o modelo fica residente na VRAM entre chamadas. Sem isto o Ollama descarrega
   * depois de 5 min e a próxima chamada paga cold load (~1,9 GB no Mac mini Intel do Otto, que
   * roda em CPU), que foi o que fez a 1ª tentativa do briefing da Fratelli estourar 300s
   * enquanto a 2ª, com modelo quente, levou 138s.
   */
  keepAlive?: string;
  /**
   * Fetch injetável pra testes: o provider não depende de rede de verdade
   * quando a suíte roda sem Ollama instalado.
   */
  fetchFn?: typeof fetch;
  logger?: Logger;
}

export interface OttoChatOptions {
  timeoutMs?: number;
  /** Temperatura do decode; criativo usa mais alto, QC usa mais baixo. */
  temperature?: number;
  /**
   * Desliga o raciocínio interno do modelo (`think: false` no /api/chat).
   *
   * É o maior lever de latência do Otto, medido ao vivo em 10/09/2026 contra
   * o Ollama 0.33.3 local com o OTTO_MODEL configurado (qwen3.5:4b, que
   * declara capability "thinking" e a usa POR DEFAULT). Mesmo prompt, mesmo
   * modelo, pedido de headline:
   *   default (raciocínio ligado): 1.724 tokens gerados, 6.409 chars de
   *     `message.thinking`, 226.315 ms - e a resposta terminava pedindo mais
   *     briefing em vez de entregar a headline.
   *   `think: false`:                 27 tokens, 0 chars de thinking,
   *     1.659 ms - com a headline pronta.
   * 136x no mesmo hardware. Era literalmente o "pensa demais; demora demais".
   *
   * ASSIMETRIA IMPORTANTE (por que não existe a opção de LIGAR): mandar
   * `think: true` pra um modelo sem a capability faz o Ollama responder
   * `{"error":"\"<modelo>\" does not support thinking"}` (verificado), o que
   * derrubaria o Otto se alguém apontasse o OTTO_MODEL de volta pro
   * `mistral` (que é o default do schema de config). Já `think: false` é
   * aceito sem erro por modelo que não pensa (também verificado). Então o
   * contrato aqui é só de SUPRESSÃO: `true` manda `think: false`, e
   * `false`/ausente não manda campo nenhum e deixa o default do modelo
   * valer. Assim nenhum valor desta opção é capaz de gerar HTTP 400.
   */
  suppressThinking?: boolean;
}

export type OttoLLMHealthStatus = 'ok' | 'degraded' | 'down';

export interface OttoLLMHealth {
  status: OttoLLMHealthStatus;
  /** Explicação honesta do estado, pra surfar em health endpoint e log. */
  detail: string;
  model: string;
  baseUrl: string;
}

export interface OttoLLMProvider {
  chat(messages: OttoChatMessage[], opts?: OttoChatOptions): Promise<string>;
  chatJson<S extends z.ZodTypeAny>(
    messages: OttoChatMessage[],
    schema: S,
    opts?: OttoChatOptions,
  ): Promise<z.output<S>>;
  healthCheck(): Promise<OttoLLMHealth>;
}

interface OllamaChatResponse {
  message?: { content?: string };
}

interface OllamaTagsResponse {
  models?: { name?: string; model?: string }[];
}

const DEFAULT_TIMEOUT_MS = 120_000;
/** Ver OttoLLMProviderConfig.numCtx: o default do Ollama (4096) corta o prompt do Otto. */
const DEFAULT_NUM_CTX = 16_384;
/** Ver OttoLLMProviderConfig.keepAlive: evita cold load de ~1,9 GB entre perguntas. */
const DEFAULT_KEEP_ALIVE = '30m';

export function createOttoLLMProvider(config: OttoLLMProviderConfig): OttoLLMProvider {
  const { baseUrl, model } = config;
  const fetchFn = config.fetchFn ?? fetch;
  const logger = config.logger;

  async function postChat(
    messages: OttoChatMessage[],
    opts: { json: boolean; timeoutMs?: number; temperature?: number; suppressThinking?: boolean },
  ): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          ...(opts.json ? { format: 'json' } : {}),
          // Só o valor SEGURO viaja (ver OttoChatOptions.suppressThinking):
          // `think: false` nunca quebra, `think: true` quebraria em modelo
          // sem a capability, então nunca é enviado.
          ...(opts.suppressThinking ? { think: false } : {}),
          keep_alive: config.keepAlive ?? DEFAULT_KEEP_ALIVE,
          // `options` sempre presente: antes ele só existia quando vinha temperature, então
          // num_ctx nunca era enviado e o Ollama silenciosamente usava 4096.
          options: {
            num_ctx: config.numCtx ?? DEFAULT_NUM_CTX,
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          },
          messages,
        }),
        // Timeout SEMPRE explícito (regra da casa): um Ollama pendurado não
        // pode segurar o pipeline criativo pra sempre.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new OttoLLMError(`Ollama chat request failed (${baseUrl})`, { cause: error });
    }

    if (!response.ok) {
      throw new OttoLLMError(`Ollama chat returned HTTP ${response.status} (model: ${model})`);
    }

    let body: OllamaChatResponse;
    try {
      body = (await response.json()) as OllamaChatResponse;
    } catch (error) {
      throw new OttoLLMError('Ollama chat response is not valid JSON', { cause: error });
    }

    const content = body.message?.content;
    if (!content) {
      throw new OttoLLMError('Ollama chat returned empty content');
    }
    return content;
  }

  return {
    async chat(messages, opts) {
      return postChat(messages, {
        json: false,
        ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts?.suppressThinking !== undefined ? { suppressThinking: opts.suppressThinking } : {}),
      });
    },

    /**
     * chatJson usa o format:'json' do Ollama (força JSON bem formado no decode)
     * + validação Zod. Modelo local pequeno às vezes devolve JSON quebrado ou
     * fora do schema mesmo com format:'json'; por isso há UMA tentativa de
     * correção com o erro devolvido no prompt. Se a segunda também falhar,
     * o erro sobe - nunca devolvemos um plano "mais ou menos".
     */
    async chatJson(messages, schema, opts) {
      const chatOpts = {
        json: true,
        ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
        // Default de SUPRESSÃO no caminho estruturado: extrair JSON de schema
        // conhecido não é tarefa de raciocínio aberto, e com o modelo pensando
        // o plano criativo pagava milhares de tokens de monólogo antes da
        // primeira chave do JSON. Quem quiser o contrário passa explicitamente.
        suppressThinking: opts?.suppressThinking ?? true,
      };

      const first = await postChat(messages, chatOpts);
      const firstResult = tryParse(first, schema);
      if (firstResult.ok) {
        if (firstResult.repaired) {
          // Sucesso, mas o modelo não entregou JSON puro. Fica no log porque é
          // sinal de qualidade do modelo/prompt, não deve passar invisível.
          logger?.warn({ model }, 'Otto chatJson: JSON vinha embrulhado, desembrulhado sem gastar nova chamada');
        }
        return firstResult.value;
      }

      logger?.warn(
        { model, error: firstResult.error },
        'Otto chatJson: resposta inválida, tentando correção',
      );

      const correction: OttoChatMessage[] = [
        ...messages,
        { role: 'assistant', content: first },
        {
          role: 'user',
          content:
            `Sua resposta anterior não é um JSON válido para o schema esperado. ` +
            `Erro: ${firstResult.error}. ` +
            `Responda SOMENTE com o JSON corrigido, sem markdown, sem texto antes ou depois.`,
        },
      ];
      const second = await postChat(correction, chatOpts);
      const secondResult = tryParse(second, schema);
      if (secondResult.ok) return secondResult.value;

      throw new OttoLLMError(
        `Ollama chatJson failed schema validation after correction retry: ${secondResult.error}`,
      );
    },

    /**
     * Health real: GET /api/tags e confere se o modelo configurado está
     * instalado. Distingue down (Ollama inalcançável) de degraded (Ollama
     * no ar mas modelo ausente) - os dois pedem ações operacionais diferentes.
     */
    async healthCheck() {
      const base = { model, baseUrl };
      let response: Response;
      try {
        response = await fetchFn(`${baseUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
        });
      } catch (error) {
        return {
          ...base,
          status: 'down',
          detail: `Ollama unreachable at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (!response.ok) {
        return { ...base, status: 'down', detail: `Ollama /api/tags returned HTTP ${response.status}` };
      }

      let tags: OllamaTagsResponse;
      try {
        tags = (await response.json()) as OllamaTagsResponse;
      } catch {
        return { ...base, status: 'down', detail: 'Ollama /api/tags returned invalid JSON' };
      }

      // Ollama lista "mistral:latest" pra quem pede "mistral": comparamos
      // pelo nome sem a tag pra não reportar degraded falso.
      const installed = (tags.models ?? [])
        .map((m) => (m.name ?? m.model ?? '').split(':')[0])
        .filter(Boolean);
      const wanted = model.split(':')[0] ?? model;
      if (!installed.includes(wanted)) {
        return {
          ...base,
          status: 'degraded',
          detail: `Model "${model}" not installed (available: ${installed.join(', ') || 'none'})`,
        };
      }
      return { ...base, status: 'ok', detail: `Model "${model}" available` };
    },
  };
}

function tryParse<S extends z.ZodTypeAny>(
  content: string,
  schema: S,
): { ok: true; value: z.output<S>; repaired: boolean } | { ok: false; error: string } {
  // parseJsonLoose evita gastar a chamada de correção (outra geração inteira,
  // minutos no hardware do Otto) quando o problema é só embrulho: cerca de
  // markdown, prosa antes da primeira chave, bloco de raciocínio vazado.
  const parsed = parseJsonLoose(content);
  if (!parsed.ok) return parsed;
  const result = schema.safeParse(parsed.value);
  if (!result.success) {
    return { ok: false, error: `schema mismatch: ${result.error.message}` };
  }
  return { ok: true, value: result.data, repaired: parsed.repaired };
}
