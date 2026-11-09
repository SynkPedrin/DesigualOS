import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buscarNoCerebroDoBento, esquecerPausaDoCerebro, formatarBlocoDoCerebro } from './cerebro-do-bento';

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

  it('pergunta com o nome do cliente e devolve as notas do vault, com o caminho', async () => {
    const pedidos: Array<{ url: string; corpo: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, corpo: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ results: [{ path: 'clientes/dcs/dados-canonicos.md', content: 'Dr. Fernando, CRM-SP 115229' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const notas = await buscarNoCerebroDoBento('qual o CRM do médico?', { cliente: 'DCS - Diagnostico por imagem', fetchImpl });
    expect(pedidos[0]).toEqual({ url: 'http://cerebro.test:8790/memory/search', corpo: { query: 'qual o CRM do médico? (DCS - Diagnostico por imagem)', top_k: 5 } });
    const bloco = formatarBlocoDoCerebro(notas);
    expect(bloco).toContain('[1] clientes/dcs/dados-canonicos.md');
    expect(bloco).toContain('CRM-SP 115229');
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
