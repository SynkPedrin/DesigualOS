import { describe, expect, it, vi } from 'vitest';
import { criarLimitador, enviarPeloBento, type DependenciasDoCanal } from './bento-channel';
import { OpenwaError } from './openwa-client';

const envio = { phone: '5511900000001', text: 'oi', idempotencyKey: 'k1' };

function deps(extra: Partial<DependenciasDoCanal> = {}): DependenciasDoCanal & { enviados: Array<{ chatId: string; text: string; key: string }> } {
  const enviados: Array<{ chatId: string; text: string; key: string }> = [];
  return {
    enviados,
    carregarCanal: async () => ({ status: 'ativa', sessionId: 'sess', apiKey: 'chave' }),
    sessaoPronta: async () => true,
    enviarTexto: async (_c, chatId, text, key) => {
      enviados.push({ chatId, text, key });
      return { messageId: `m${enviados.length}` };
    },
    limitador: criarLimitador({ max10min: 8, maxPorHora: 20 }),
    agora: () => 1_000_000,
    chaveGeralDesligada: () => false,
    ...extra,
  };
}

describe('enviar pelo número do Bento', () => {
  it('envia para o chatId do número, com a chave de idempotência recebida', async () => {
    const d = deps();
    const r = await enviarPeloBento(envio, d);
    expect(r).toEqual({ ok: true, messageId: 'm1' });
    expect(d.enviados).toEqual([{ chatId: '5511900000001@c.us', text: 'oi', key: 'k1' }]);
  });

  it('número inválido nunca chega ao OpenWA (e não é repetível)', async () => {
    for (const phone of ['', 'abc', '+55 11 90000-0001', '123', '5511@c.us', '55119000000011111111']) {
      const d = deps();
      const r = await enviarPeloBento({ ...envio, phone }, d);
      expect(r).toMatchObject({ ok: false, motivo: 'numero_invalido', repetivel: false });
      expect(d.enviados).toHaveLength(0);
    }
  });

  it('chave geral do servidor desliga o canal', async () => {
    const d = deps({ chaveGeralDesligada: () => true });
    expect(await enviarPeloBento(envio, d)).toMatchObject({ ok: false, motivo: 'canal_desligado' });
    expect(d.enviados).toHaveLength(0);
  });

  it('canal desligado no painel não envia', async () => {
    const d = deps({ carregarCanal: async () => ({ status: 'desativada', sessionId: 's', apiKey: 'k' }) });
    expect(await enviarPeloBento(envio, d)).toMatchObject({ ok: false, motivo: 'canal_desligado' });
    expect(d.enviados).toHaveLength(0);
  });

  it('número do Bento nunca conectado: não envia, e diz por quê', async () => {
    const d = deps({ carregarCanal: async () => null });
    expect(await enviarPeloBento(envio, d)).toMatchObject({ ok: false, motivo: 'sem_sessao', repetivel: true });
  });

  it('sessão que não está pronta ou não responde: não envia (nada de enfileirar para o aparelho)', async () => {
    const parada = deps({ sessaoPronta: async () => false });
    expect(await enviarPeloBento(envio, parada)).toMatchObject({ ok: false, motivo: 'sessao_nao_pronta', repetivel: true });
    expect(parada.enviados).toHaveLength(0);
    const fora = deps({ sessaoPronta: async () => { throw new Error('OpenWA fora'); } });
    expect(await enviarPeloBento(envio, fora)).toMatchObject({ ok: false, motivo: 'sessao_nao_pronta' });
    expect(fora.enviados).toHaveLength(0);
  });

  it('LIMITE: depois de 8 envios em 10 min, trava (o laço do incidente de 19/10 não se repete)', async () => {
    const d = deps();
    const resultados = [];
    for (let i = 0; i < 12; i++) resultados.push(await enviarPeloBento({ ...envio, idempotencyKey: `k${i}` }, d));
    expect(resultados.filter((r) => r.ok)).toHaveLength(8);
    expect(resultados.slice(8).every((r) => !r.ok && r.motivo === 'limite_de_envio')).toBe(true);
    expect(d.enviados).toHaveLength(8);
  });

  it('o limitador libera de novo quando a janela passa, e respeita o teto por hora', () => {
    const l = criarLimitador({ max10min: 2, maxPorHora: 3 });
    expect([l.permitir(0), l.permitir(1_000), l.permitir(2_000)]).toEqual([true, true, false]);
    expect(l.permitir(601_000)).toBe(true); // a janela de 10 min correu
    expect(l.permitir(1_300_000)).toBe(false); // teto de 3 por hora
    expect(l.permitir(3_700_000)).toBe(true); // passou uma hora
  });

  it('erro de envio vira falha, repetível só se o OpenWA disser que é', async () => {
    const temporario = deps({ enviarTexto: async () => { throw new OpenwaError('429', 429, 'SEND_PACING_LIMITED', true); } });
    expect(await enviarPeloBento(envio, temporario)).toMatchObject({ ok: false, motivo: 'falha_de_envio', repetivel: true });
    const definitivo = deps({ enviarTexto: async () => { throw new OpenwaError('chat inválido', 400, null, false); } });
    expect(await enviarPeloBento(envio, definitivo)).toMatchObject({ ok: false, motivo: 'falha_de_envio', repetivel: false });
  });

  it('não envia com a sessão pronta se o limite já bloqueou (ordem das travas)', async () => {
    const enviarTexto = vi.fn(async () => ({ messageId: 'x' }));
    const d = deps({ limitador: { permitir: () => false }, enviarTexto });
    await enviarPeloBento(envio, d);
    expect(enviarTexto).not.toHaveBeenCalled();
  });
});
