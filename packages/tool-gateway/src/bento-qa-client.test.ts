import { afterEach, describe, expect, it, vi } from 'vitest';
import { askBentoQA } from './bento-qa-client';

/**
 * Regressão do bug real de 09/09/2026: o default antigo (`body.texto ?? body.answer`) sempre
 * devolvia o texto pré-formatado do bento-qa — com o cabeçalho "🧠 Bento:" e o rodapé
 * "Fontes:\n[n] caminho/do/arquivo.md" embutidos — porque `texto` vem preenchido em toda resposta
 * real. Isso fazia o Chat central (que não pede o texto formatado, e já usa `citations` à parte
 * pra montar `sources`) mostrar caminho de arquivo do vault na tela pro usuário, e ignorava por
 * completo qualquer limpeza feita do lado do bento-qa: a resposta chegava suja de outro campo.
 */
function respostaCrua(overrides: Partial<{ answer: string; texto: string; status: string }> = {}) {
  return {
    status: 'ok',
    answer: 'O Jarbas cuida do tráfego pago.',
    texto: '🧠 Bento:\n\nO Jarbas cuida do tráfego pago.\n\nFontes:\n[3] 03_Equipe/jarbas-de-andrade-persona.md',
    citations: [{ n: 3, path: '03_Equipe/jarbas-de-andrade-persona.md' }],
    ...overrides,
  };
}

function mockFetchOnce(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('askBentoQA — escolha de campo (answer vs texto)', () => {
  it('por padrão devolve o texto LIMPO (answer), sem cabeçalho nem caminho de arquivo', async () => {
    mockFetchOnce(respostaCrua());
    const r = await askBentoQA({ url: 'http://x', token: 't' }, 'quem cuida do trafego pago?');
    expect(r.text).toBe('O Jarbas cuida do tráfego pago.');
    expect(r.text).not.toContain('🧠 Bento');
    expect(r.text).not.toContain('.md');
    expect(r.text).not.toContain('Fontes:');
  });

  it('com preferFormattedText, devolve o texto pré-formatado (uso: comentário de ClickUp)', async () => {
    mockFetchOnce(respostaCrua());
    const r = await askBentoQA(
      { url: 'http://x', token: 't', channel: 'clickup', preferFormattedText: true },
      'quem cuida do trafego pago?',
    );
    expect(r.text).toContain('🧠 Bento:');
    expect(r.text).toContain('Fontes:');
    expect(r.text).toContain('.md');
  });

  it('status nao-sei (sem citação) segue devolvendo answer normalmente, sem exigir formattedText', async () => {
    // hasCitedAnswer só bloqueia status 'ok' sem citação — 'nao-sei' é uma resposta honesta
    // válida, com answer preenchido (a frase de fallback) e citations vazio.
    mockFetchOnce({
      status: 'nao-sei',
      answer: 'Não encontrei isso nas fontes. Registrei a lacuna para a curadoria.',
      texto: '🧠 Bento:\n\nNão encontrei isso nas fontes. Registrei a lacuna para a curadoria.',
      citations: [],
    });
    const r = await askBentoQA({ url: 'http://x', token: 't' }, 'pergunta sem resposta no vault');
    expect(r.text).toBe('Não encontrei isso nas fontes. Registrei a lacuna para a curadoria.');
    expect(r.text).not.toContain('🧠 Bento');
  });

  it('sempre devolve as citações separadas, independente do campo de texto escolhido', async () => {
    mockFetchOnce(respostaCrua());
    const r = await askBentoQA({ url: 'http://x', token: 't' }, 'quem cuida do trafego pago?');
    expect(r.citations).toEqual([{ n: 3, path: '03_Equipe/jarbas-de-andrade-persona.md' }]);
  });
});

/**
 * Regressão do 413 medido em produção (18/09/2026): o panorama GLOBAL da
 * carteira (133KB, 1124 tasks) passava do limite de 128KB do bento-qa e a
 * pergunta "me atualiza aí" morria sem resposta.
 */
describe('teto do corpo (HTTP 413 do serviço real)', () => {
  it('contexto gigante é truncado ANTES de enviar, com marcação honesta', async () => {
    let bytesEnviados = 0;
    let corpoEnviado = '';
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      corpoEnviado = String(init?.body ?? '');
      bytesEnviados = Buffer.byteLength(corpoEnviado);
      return new Response(JSON.stringify({ status: 'ok', answer: 'resposta', citations: [{ n: 1, path: 'x' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { askBentoQA, BENTO_QA_BODY_LIMIT_BYTES } = await import('./bento-qa-client');
      await askBentoQA({ url: 'http://x', token: 't' }, 'me atualiza aí', 'DADOS\n' + 'task\n'.repeat(40_000));
      expect(bytesEnviados).toBeLessThanOrEqual(BENTO_QA_BODY_LIMIT_BYTES + 100);
      expect(corpoEnviado).toContain('CONTEXTO TRUNCADO');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('contexto pequeno passa intacto', async () => {
    let corpoEnviado = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      corpoEnviado = String(init?.body ?? '');
      return new Response(JSON.stringify({ status: 'ok', answer: 'r', citations: [{ n: 1, path: 'x' }] }), { status: 200 });
    }));
    try {
      const { askBentoQA } = await import('./bento-qa-client');
      await askBentoQA({ url: 'http://x', token: 't' }, 'pergunta', 'contexto pequeno');
      expect(corpoEnviado).toContain('contexto pequeno');
      expect(corpoEnviado).not.toContain('CONTEXTO TRUNCADO');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
