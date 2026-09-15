import { describe, expect, it } from 'vitest';
import { WebSearchError, createWebSearchProvider, createWebSearchProviderFromEnv } from './web-search-provider.js';
import { runResearch } from './research.js';

/**
 * O provider é a ÚNICA parte da pesquisa que toca a rede, então o que se
 * testa aqui é exatamente isso: a requisição que sai (endpoint, header de
 * auth, corpo) e o parse do que volta, com fetch injetado. A inteligência
 * (classificação/síntese) tem suíte própria em research.test.ts.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createWebSearchProvider', () => {
  it('Brave: manda a chave no header e extrai url/título/snippet', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const provider = createWebSearchProvider({
      vendor: 'brave',
      apiKey: 'chave-brave',
      fetchFn: async (url, init) => {
        seenUrl = String(url);
        seenHeaders = (init?.headers ?? {}) as Record<string, string>;
        return jsonResponse({
          web: { results: [{ url: 'https://exame.com/a', title: 'Tendência 2026', description: '<b>Dado</b>  atual' }] },
        });
      },
    });

    const sources = await provider.search('tendências de marketing');

    expect(seenUrl).toContain('api.search.brave.com');
    expect(seenUrl).toContain('q=tend%C3%AAncias%20de%20marketing');
    expect(seenHeaders['X-Subscription-Token']).toBe('chave-brave');
    // Tag HTML removida e espaço normalizado: o snippet vai pro prompt.
    expect(sources).toEqual([{ url: 'https://exame.com/a', title: 'Tendência 2026', snippet: 'Dado atual' }]);
  });

  it('Tavily: manda bearer + query no corpo', async () => {
    let body: Record<string, unknown> = {};
    const provider = createWebSearchProvider({
      vendor: 'tavily',
      apiKey: 'chave-tavily',
      fetchFn: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return jsonResponse({ results: [{ url: 'https://g1.globo.com/b', title: 'T', content: 'conteúdo' }] });
      },
    });

    const sources = await provider.search('mercado de pizza');

    expect(body.query).toBe('mercado de pizza');
    expect(sources[0]?.url).toBe('https://g1.globo.com/b');
  });

  it('Serper: lê `organic` e usa o campo link', async () => {
    const provider = createWebSearchProvider({
      vendor: 'serper',
      apiKey: 'k',
      fetchFn: async () => jsonResponse({ organic: [{ link: 'https://hbr.org/c', title: 'H', snippet: 's' }] }),
    });
    const sources = await provider.search('q');
    expect(sources[0]).toEqual({ url: 'https://hbr.org/c', title: 'H', snippet: 's' });
  });

  it('descarta resultado sem snippet: fonte sem trecho não sustenta afirmação', async () => {
    const provider = createWebSearchProvider({
      vendor: 'brave',
      apiKey: 'k',
      fetchFn: async () =>
        jsonResponse({ web: { results: [{ url: 'https://x.com/a', description: '' }, { url: 'https://g1.globo.com/b', description: 'tem trecho' }] } }),
    });
    const sources = await provider.search('q');
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe('https://g1.globo.com/b');
  });

  it('erro HTTP vira WebSearchError (nunca lista vazia silenciosa)', async () => {
    const provider = createWebSearchProvider({ vendor: 'brave', apiKey: 'k', fetchFn: async () => jsonResponse({}, 429) });
    await expect(provider.search('q')).rejects.toThrow(WebSearchError);
  });

  it('rede fora vira WebSearchError com a causa preservada', async () => {
    const provider = createWebSearchProvider({
      vendor: 'tavily',
      apiKey: 'k',
      fetchFn: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(provider.search('q')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('falha de busca faz runResearch declarar performed=false (não "pesquisei e não achei")', async () => {
    const provider = createWebSearchProvider({ vendor: 'brave', apiKey: 'k', fetchFn: async () => jsonResponse({}, 500) });
    const result = await runResearch(provider, 'tendências', { shouldResearch: true });
    expect(result.performed).toBe(false);
    expect(result.evidence).toEqual([]);
  });
});

describe('createWebSearchProviderFromEnv', () => {
  it('sem vendor/chave devolve null: sem pesquisa configurada, sem pesquisa', () => {
    expect(createWebSearchProviderFromEnv({})).toBeNull();
    expect(createWebSearchProviderFromEnv({ OTTO_SEARCH_PROVIDER: 'brave' })).toBeNull();
    expect(createWebSearchProviderFromEnv({ OTTO_SEARCH_API_KEY: 'k' })).toBeNull();
  });

  it('vendor desconhecido falha alto, não vira no-op silencioso', () => {
    expect(() => createWebSearchProviderFromEnv({ OTTO_SEARCH_PROVIDER: 'google', OTTO_SEARCH_API_KEY: 'k' })).toThrow(
      /OTTO_SEARCH_PROVIDER inválido/,
    );
  });

  it('com vendor + chave devolve provider funcional e respeita OTTO_SEARCH_URL', async () => {
    let seenUrl = '';
    const provider = createWebSearchProviderFromEnv(
      { OTTO_SEARCH_PROVIDER: 'brave', OTTO_SEARCH_API_KEY: 'k', OTTO_SEARCH_URL: 'https://proxy.interno/search' },
      {
        fetchFn: async (url) => {
          seenUrl = String(url);
          return jsonResponse({ web: { results: [] } });
        },
      },
    );
    expect(provider).not.toBeNull();
    await provider!.search('q');
    expect(seenUrl).toContain('https://proxy.interno/search');
  });
});
