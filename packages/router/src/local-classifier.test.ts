import { describe, expect, it, vi } from 'vitest';
import { classifyLocally } from './local-classifier';

const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never;

function respostaDoModelo(conteudo: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ message: { content: conteudo } }), { status: 200 })) as unknown as typeof fetch;
}

/**
 * Regressão do blocker de AUTO (24/09/2026): sem classifier, "como tá a 3Net
 * esse mês?" ia pro Bento e voltava com dado de vault de outro mês — e, num
 * follow-up, de outro cliente.
 */
describe('classifier local de roteamento', () => {
  it('aceita o agente devolvido pelo modelo', async () => {
    const r = await classifyLocally('como tá a 3Net?', logger, respostaDoModelo('{"agent":"jarbas","confidence":0.9}'));
    expect(r).toEqual({ agent: 'jarbas', confidence: 0.9 });
  });

  it('assume confiança padrão quando o modelo omite o campo', async () => {
    const r = await classifyLocally('me dá 3 títulos', logger, respostaDoModelo('{"agent":"otto"}'));
    expect(r?.agent).toBe('otto');
    expect(r?.confidence).toBeGreaterThan(0);
  });

  it('recusa agente fora do enum em vez de chutar (o caso "otto|jarbas")', async () => {
    const r = await classifyLocally('qual campanha tá melhor?', logger, respostaDoModelo('{"agent":"otto|jarbas"}'));
    expect(r).toBeNull();
  });

  it('recusa JSON quebrado', async () => {
    const r = await classifyLocally('oi', logger, respostaDoModelo('isso não é json'));
    expect(r).toBeNull();
  });

  it('devolve null quando o gateway responde erro', async () => {
    const fetchErro = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    const r = await classifyLocally('oi', logger, fetchErro);
    expect(r).toBeNull();
  });

  it('devolve null quando o gateway está fora do ar', async () => {
    const fetchExplode = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const r = await classifyLocally('oi', logger, fetchExplode);
    expect(r).toBeNull();
  });
});
