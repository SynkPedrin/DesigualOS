import type { Logger } from '@desigual-os/logging';
import type { ResearchProvider, ResearchSource } from './research.js';

/**
 * web-search-provider.ts — a implementação REAL do ResearchProvider (§55-59).
 * research.ts é a inteligência (classificar fonte, sintetizar, virar
 * evidência) e é pura; aqui mora a única parte que toca a rede: a busca.
 *
 * Três provedores porque nenhum deles é universal e a chave é decisão de
 * deploy, não de código. Todos devolvem a MESMA forma (ResearchSource), então
 * o pipeline criativo não sabe nem se importa com qual está ligado.
 *
 * Sem chave configurada NÃO existe pesquisa: createWebSearchProvider devolve
 * null e runResearch marca `performed: false`. Isso é deliberado e é a regra
 * de ouro do projeto aplicada à pesquisa — o Otto jamais pode dizer que
 * pesquisou sem ter feito uma chamada de verdade (§59). Um provider que
 * devolvesse resultado fabricado quando a chave falta seria exatamente a
 * mentira que o gate anti-alucinação existe pra impedir.
 */

export type WebSearchVendor = 'brave' | 'tavily' | 'serper';

export const WEB_SEARCH_VENDORS: readonly WebSearchVendor[] = ['brave', 'tavily', 'serper'] as const;

export interface WebSearchConfig {
  vendor: WebSearchVendor;
  apiKey: string;
  /** Override do endpoint (self-host/proxy). Default: o endpoint oficial do vendor. */
  baseUrl?: string;
  /** Quantos resultados pedir. O synthesize corta depois; aqui é o teto da chamada. */
  maxResults?: number;
  timeoutMs?: number;
  /** Fetch injetável: a suíte roda sem rede. */
  fetchFn?: typeof fetch;
  logger?: Logger;
}

export class WebSearchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WebSearchError';
  }
}

const DEFAULT_BASE_URL: Record<WebSearchVendor, string> = {
  brave: 'https://api.search.brave.com/res/v1/web/search',
  tavily: 'https://api.tavily.com/search',
  serper: 'https://google.serper.dev/search',
};

/** Recorta o snippet: o synthesize trabalha com trecho, não com página inteira. */
function clean(text: unknown, max = 400): string {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseBrave(body: unknown): ResearchSource[] {
  const results = (body as { web?: { results?: unknown[] } })?.web?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw) => {
    const item = raw as { url?: unknown; title?: unknown; description?: unknown };
    if (typeof item.url !== 'string') return [];
    const title = clean(item.title, 200);
    return [{ url: item.url, snippet: clean(item.description), ...(title ? { title } : {}) }];
  });
}

function parseTavily(body: unknown): ResearchSource[] {
  const results = (body as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw) => {
    const item = raw as { url?: unknown; title?: unknown; content?: unknown };
    if (typeof item.url !== 'string') return [];
    const title = clean(item.title, 200);
    return [{ url: item.url, snippet: clean(item.content), ...(title ? { title } : {}) }];
  });
}

function parseSerper(body: unknown): ResearchSource[] {
  const results = (body as { organic?: unknown[] })?.organic;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw) => {
    const item = raw as { link?: unknown; title?: unknown; snippet?: unknown };
    if (typeof item.link !== 'string') return [];
    const title = clean(item.title, 200);
    return [{ url: item.link, snippet: clean(item.snippet), ...(title ? { title } : {}) }];
  });
}

interface VendorRequest {
  url: string;
  init: RequestInit;
  parse: (body: unknown) => ResearchSource[];
}

function buildRequest(config: WebSearchConfig, query: string): VendorRequest {
  const base = config.baseUrl ?? DEFAULT_BASE_URL[config.vendor];
  const count = config.maxResults ?? 8;
  switch (config.vendor) {
    case 'brave': {
      const url = `${base}?q=${encodeURIComponent(query)}&count=${count}`;
      return {
        url,
        init: { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': config.apiKey } },
        parse: parseBrave,
      };
    }
    case 'tavily':
      return {
        url: base,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ query, max_results: count, search_depth: 'basic' }),
        },
        parse: parseTavily,
      };
    case 'serper':
      return {
        url: base,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': config.apiKey },
          body: JSON.stringify({ q: query, num: count }),
        },
        parse: parseSerper,
      };
  }
}

/**
 * Provider de busca real. Lança WebSearchError em falha — quem chama é
 * runResearch, que trata a exceção devolvendo `performed: false`. Ou seja:
 * rede fora vira "não pesquisei", nunca "pesquisei e não achei nada".
 */
export function createWebSearchProvider(config: WebSearchConfig): ResearchProvider {
  const doFetch = config.fetchFn ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;

  return {
    async search(query: string): Promise<ResearchSource[]> {
      const { url, init, parse } = buildRequest(config, query);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await doFetch(url, { ...init, signal: controller.signal });
      } catch (error) {
        throw new WebSearchError(`busca (${config.vendor}) falhou: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new WebSearchError(`busca (${config.vendor}) respondeu ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new WebSearchError(`busca (${config.vendor}) devolveu JSON inválido`, { cause: error });
      }

      const sources = parse(body).filter((source) => source.snippet.length > 0);
      config.logger?.info({ vendor: config.vendor, query, results: sources.length }, '[OTTO:research] busca externa concluída');
      return sources;
    },
  };
}

/**
 * Monta o provider a partir da env. Devolve null quando não há vendor+chave:
 * o pipeline segue sem pesquisa e DECLARA isso, em vez de fingir.
 */
export function createWebSearchProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  extra: { fetchFn?: typeof fetch; logger?: Logger } = {},
): ResearchProvider | null {
  const vendor = env.OTTO_SEARCH_PROVIDER?.trim().toLowerCase();
  const apiKey = env.OTTO_SEARCH_API_KEY?.trim();
  if (!vendor || !apiKey) return null;
  if (!WEB_SEARCH_VENDORS.includes(vendor as WebSearchVendor)) {
    throw new WebSearchError(`OTTO_SEARCH_PROVIDER inválido: "${vendor}". Use um de: ${WEB_SEARCH_VENDORS.join(', ')}.`);
  }
  const baseUrl = env.OTTO_SEARCH_URL?.trim();
  const maxResults = env.OTTO_SEARCH_MAX_RESULTS ? Number(env.OTTO_SEARCH_MAX_RESULTS) : undefined;
  return createWebSearchProvider({
    vendor: vendor as WebSearchVendor,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(Number.isFinite(maxResults) && maxResults ? { maxResults } : {}),
    ...(extra.fetchFn ? { fetchFn: extra.fetchFn } : {}),
    ...(extra.logger ? { logger: extra.logger } : {}),
  });
}
