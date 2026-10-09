import { describe, expect, it } from 'vitest';
import type { MediaOverviewClientWire } from '@/lib/api/contracts';
import { alertasDeMidia, resumoDeMidia } from './resumo-de-midia';

/**
 * Esta é a tela onde um zero tranquilizador custa mais caro. "Investimento
 * total: R$ 0" lido como "ninguém está gastando", quando na verdade era "não
 * consegui ler três contas", é a diferença entre dormir tranquilo e perder o
 * mês. Os testes abaixo existem para que nenhuma conta aqui complete buraco
 * com zero.
 */
function lido(
  nome: string,
  insights: { spend?: number | null; impressions?: number | null; clicks?: number | null; results?: number | null } | null,
): MediaOverviewClientWire {
  return {
    client_id: nome,
    client_name: nome,
    status: 'ativo',
    connected: true,
    account_id: `act_${nome}`,
    account_label: null,
    data_available: true,
    insights: insights
      ? {
          spend: insights.spend ?? null,
          impressions: insights.impressions ?? null,
          clicks: insights.clicks ?? null,
          ctr: null,
          results: insights.results ?? null,
        }
      : null,
  };
}

const semConta = (nome: string): MediaOverviewClientWire => ({
  client_id: nome,
  client_name: nome,
  status: 'ativo',
  connected: false,
});

const semLeitura = (nome: string, reason: string): MediaOverviewClientWire => ({
  client_id: nome,
  client_name: nome,
  status: 'ativo',
  connected: true,
  account_id: `act_${nome}`,
  account_label: null,
  data_available: false,
  reason,
});

describe('resumoDeMidia', () => {
  it('soma só o que foi lido, e diz sobre quantos o total fala', () => {
    const r = resumoDeMidia([
      lido('a', { spend: 1000, impressions: 10_000, clicks: 200, results: 10 }),
      lido('b', { spend: 500, impressions: 5_000, clicks: 50, results: 5 }),
      semLeitura('c', 'Token revogado'),
      semConta('d'),
    ]);
    expect(r.investido).toBe(1500);
    expect(r.leads).toBe(15);
    expect(r.totalDeClientes).toBe(4);
    expect(r.comLeitura).toBe(2);
    expect(r.semLeitura).toBe(1);
    expect(r.semConta).toBe(1);
  });

  /**
   * O caso que motiva o arquivo inteiro: nenhuma leitura disponível. Uma soma
   * ingênua devolveria 0 e a tela diria "R$ 0 investido", que é uma afirmação
   * sobre o mundo feita a partir de ausência de dado.
   */
  it('sem nenhuma leitura, o total é ausente — nunca zero', () => {
    const r = resumoDeMidia([semLeitura('a', 'API fora'), semConta('b')]);
    expect(r.investido).toBeNull();
    expect(r.impressoes).toBeNull();
    expect(r.leads).toBeNull();
    expect(r.cplMedio).toBeNull();
    expect(r.ctrMedio).toBeNull();
  });

  it('carteira vazia não inventa número', () => {
    const r = resumoDeMidia([]);
    expect(r.investido).toBeNull();
    expect(r.totalDeClientes).toBe(0);
  });

  it('gasto sem lead não vira custo por lead igual a zero nem infinito', () => {
    const r = resumoDeMidia([lido('a', { spend: 900, results: 0 })]);
    expect(r.investido).toBe(900);
    expect(r.leads).toBe(0);
    expect(r.cplMedio).toBeNull();
  });

  /**
   * Média das médias trata uma conta de mil impressões igual a uma de um
   * milhão, e o CTR que sai não corresponde a cliente nenhum.
   */
  it('CTR é ponderado por impressão, não média das médias', () => {
    const r = resumoDeMidia([
      lido('grande', { impressions: 1_000_000, clicks: 10_000 }), // 1%
      lido('pequena', { impressions: 1_000, clicks: 100 }), // 10%
    ]);
    // Ponderado: 10.100 / 1.001.000 ≈ 1,009%. A média simples daria 5,5%.
    expect(r.ctrMedio).toBeCloseTo(1.009, 2);
  });

  it('cliente lido mas com insights nulos não quebra nem conta como zero', () => {
    const r = resumoDeMidia([lido('a', { spend: 300, results: 3 }), lido('b', null)]);
    expect(r.investido).toBe(300);
    expect(r.comLeitura).toBe(2);
  });
});

describe('alertasDeMidia', () => {
  it('cliente sem conta vinculada vira alerta', () => {
    const [alerta] = alertasDeMidia([semConta('Colormaq')]);
    expect(alerta?.tipo).toBe('sem-conta');
    expect(alerta?.clienteNome).toBe('Colormaq');
  });

  it('o motivo da falha vem da API, não é escrito aqui', () => {
    const [alerta] = alertasDeMidia([semLeitura('Elite', 'Token expirado em 02/10')]);
    expect(alerta?.tipo).toBe('sem-leitura');
    expect(alerta?.motivo).toBe('Token expirado em 02/10');
  });

  it('gastou e não trouxe resultado é alerta', () => {
    const alertas = alertasDeMidia([lido('a', { spend: 2000, results: 0 })]);
    expect(alertas.map((x) => x.tipo)).toContain('sem-resultado');
  });

  /**
   * A distinção que separa alerta útil de acusação falsa: `results` ausente
   * não é `results` zero. Tratar ausência como zero acusaria campanha boa de
   * não entregar, só porque a métrica não veio.
   */
  it('resultado NÃO MEDIDO não vira acusação de campanha sem resultado', () => {
    const alertas = alertasDeMidia([lido('a', { spend: 2000, results: null })]);
    expect(alertas.map((x) => x.tipo)).not.toContain('sem-resultado');
  });

  it('cliente saudável não gera alerta', () => {
    expect(alertasDeMidia([lido('a', { spend: 100, results: 4 })])).toEqual([]);
  });
});
