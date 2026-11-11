import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buscarNoCerebroDoBento, esquecerPausaDoCerebro, formatarBlocoDoCerebro, pastasDoCliente } from './cerebro-do-bento';

/** O cérebro do Bento (memory-api do Mac Mini) entra na conversa e NUNCA segura a resposta (09/11/2026). */
describe('cérebro do Bento', () => {
  beforeEach(() => {
    process.env.BENTO_MEMORY_API_URL = 'http://cerebro.test:8790';
    process.env.BENTO_MEMORY_API_TOKEN = 'token-de-teste';
    esquecerPausaDoCerebro();
  });
  afterEach(() => {
    delete process.env.BENTO_MEMORY_API_URL;
    delete process.env.BENTO_MEMORY_API_TOKEN;
  });

  /**
   * Formato REAL da memory-api (medido da VPS em 11/11/2026): o texto vem em `text`, e a busca solta devolve cópias de
   * um dossiê guardado no arquivo. A primeira versão lia `content` e entregava zero nota ao Bento.
   */
  it('lê o campo text, põe a pasta do cliente primeiro e deixa o arquivo morto de fora', async () => {
    const pedidos: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body)) as { filters?: { path_prefix?: string } };
      pedidos.push(corpo);
      const results =
        corpo.filters?.path_prefix === 'clientes/dcs/'
          ? [
              { path: 'clientes/dcs/dados-canonicos.md', heading: 'Corpo clínico', text: 'Responsável técnico: Dr. Fernando, CRM-SP 115229' },
              { path: 'clientes/dcs/dados-canonicos.md', heading: 'Unidades', text: 'Matriz: Rua Saudades, 1031, Birigui' },
            ]
          : corpo.filters?.path_prefix
            ? []
            : [
                { path: '04_Arquivo/perplexity-bruto-2026-04/DCS.md', heading: null, text: 'pesquisa antiga' },
                { path: 'clientes/dcs/plano-marketing.md', heading: null, text: 'plano de marketing' },
              ];
      return new Response(JSON.stringify({ results, took_ms: 5 }), { status: 200 });
    }) as unknown as typeof fetch;

    const notas = await buscarNoCerebroDoBento('qual o CRM do médico?', { cliente: 'DCS - Diagnostico por imagem', fetchImpl });

    expect(pedidos).toContainEqual({ query: 'qual o CRM do médico?', top_k: 8, filters: { path_prefix: 'clientes/dcs/' } });
    expect(pedidos).toContainEqual({ query: 'qual o CRM do médico? (DCS - Diagnostico por imagem)', top_k: 12 });
    expect(notas.map((n) => n.path)).toEqual(['clientes/dcs/dados-canonicos.md', 'clientes/dcs/plano-marketing.md']);
    const bloco = formatarBlocoDoCerebro(notas);
    expect(bloco).toContain('[1] clientes/dcs/dados-canonicos.md');
    expect(bloco).toContain('CRM-SP 115229');
    expect(bloco).toContain('Rua Saudades');
    expect(bloco).not.toContain('pesquisa antiga');
  });

  it('pastas candidatas pelo nome curto e pelo nome inteiro, sem acento', () => {
    expect(pastasDoCliente('DCS - Diagnostico por imagem')).toEqual(['clientes/dcs/', 'clientes/dcs-diagnostico-por-imagem/']);
    expect(pastasDoCliente('Fácil Seguros')).toEqual(['clientes/facil-seguros/']);
  });

  it('a busca da pasta falhar não derruba a busca geral', async () => {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body)) as { filters?: unknown };
      if (corpo.filters) return new Response('erro', { status: 500 });
      return new Response(JSON.stringify({ results: [{ path: 'clientes/elite/estado-atual.md', text: 'campanha ativa' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const notas = await buscarNoCerebroDoBento('como está a elite?', { cliente: 'Elite', fetchImpl });
    expect(notas).toEqual([{ path: 'clientes/elite/estado-atual.md', content: 'campanha ativa' }]);
  });

  it('memory-api travada (RTX desligada): desiste no teto e não tenta de novo por 2 min', async () => {
    let chamadas = 0;
    const travada = ((_url: string, init: RequestInit) => {
      chamadas++;
      return new Promise((_ok, falha) => init.signal?.addEventListener('abort', () => falha(new Error('timeout'))));
    }) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await buscarNoCerebroDoBento('qual o endereço?', { fetchImpl: travada })).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(5_500);
    expect(await buscarNoCerebroDoBento('outra pergunta', { fetchImpl: travada })).toEqual([]);
    expect(chamadas).toBe(1);
  }, 10_000);

  it('sem endereço configurado, não busca nada e o bloco fica vazio', async () => {
    delete process.env.BENTO_MEMORY_API_URL;
    expect(await buscarNoCerebroDoBento('x')).toEqual([]);
    expect(formatarBlocoDoCerebro([])).toBe('');
  });
});
