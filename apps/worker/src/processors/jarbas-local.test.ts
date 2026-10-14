import { describe, expect, it, vi } from 'vitest';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));
vi.mock('@desigual-os/router', () => ({ completeTextSafely: vi.fn() }));
vi.mock('@desigual-os/tool-gateway', () => ({}));

// Terça, 14/10/2026, 10h em São Paulo.
const AGORA = new Date('2026-10-14T13:00:00Z');

describe('periodoDaPergunta', () => {
  it('sem período na frase: últimos 7 dias, dizendo que é o padrão, e o anterior do mesmo tamanho', async () => {
    const { periodoDaPergunta } = await import('./jarbas-local');
    const p = periodoDaPergunta('como está a campanha da Elite?', AGORA);
    expect(p.atual).toEqual({ since: '2026-10-08', until: '2026-10-14' });
    expect(p.anterior).toEqual({ since: '2026-10-01', until: '2026-10-07' });
    expect(p.rotulo).toContain('padrão');
  });

  it('entende ontem, últimos N dias, semana passada, mês passado e este mês', async () => {
    const { periodoDaPergunta } = await import('./jarbas-local');
    expect(periodoDaPergunta('e ontem?', AGORA).atual).toEqual({ since: '2026-10-13', until: '2026-10-13' });
    expect(periodoDaPergunta('últimos 30 dias', AGORA).atual).toEqual({ since: '2026-09-15', until: '2026-10-14' });
    expect(periodoDaPergunta('como foi a semana passada?', AGORA).atual).toEqual({ since: '2026-10-05', until: '2026-10-11' });
    const mesPassado = periodoDaPergunta('resultado do mês passado', AGORA);
    expect(mesPassado.atual).toEqual({ since: '2026-09-01', until: '2026-09-30' });
    expect(mesPassado.anterior).toEqual({ since: '2026-08-01', until: '2026-08-31' });
    expect(periodoDaPergunta('como está este mês?', AGORA).atual).toEqual({ since: '2026-10-01', until: '2026-10-14' });
  });

  it('faixa em dd/mm, com e sem ano', async () => {
    const { periodoDaPergunta } = await import('./jarbas-local');
    const p = periodoDaPergunta('de 01/09 a 15/09', AGORA);
    expect(p.atual).toEqual({ since: '2026-09-01', until: '2026-09-15' });
    expect(p.anterior).toEqual({ since: '2026-08-17', until: '2026-08-31' });
    expect(periodoDaPergunta('de 01/08/2026 até 31/08/2026', AGORA).atual).toEqual({ since: '2026-08-01', until: '2026-08-31' });
  });
});

describe('dadosEmTexto', () => {
  const periodo = { atual: { since: '2026-10-08', until: '2026-10-14' }, anterior: { since: '2026-10-01', until: '2026-10-07' }, rotulo: 'últimos 7 dias' };

  it('canal sem conta vira SEM DADOS com o motivo, nunca zero', async () => {
    const { dadosEmTexto } = await import('./jarbas-local');
    const t = dadosEmTexto('Elite', periodo, [{ canal: 'Google Ads', conectado: false, motivo: 'nenhuma conta do Google Ads vinculada a este cliente' }]);
    expect(t).toContain('SEM DADOS: nenhuma conta do Google Ads vinculada a este cliente.');
    expect(t).not.toMatch(/R\$\s*0/);
  });

  it('a variação é calculada aqui, não pelo modelo, e as campanhas vêm por investimento', async () => {
    const { dadosEmTexto } = await import('./jarbas-local');
    const t = dadosEmTexto('Elite', periodo, [
      {
        canal: 'Meta Ads',
        conectado: true,
        atual: { investimento: 1500, impressoes: 30000, cliques: 600, ctr: 2, cpc: 2.5, resultados: 40 },
        anterior: { investimento: 1000, impressoes: 25000, cliques: 500, ctr: 2, cpc: 2, resultados: 50 },
        campanhas: [
          { nome: 'Pequena', status: 'ACTIVE', investimento: 100, cliques: 10, ctr: 1 },
          { nome: 'Grande', status: 'ACTIVE', investimento: 1400, cliques: 590, ctr: 2.1 },
        ],
      },
    ]);
    expect(t).toContain('+50% vs período anterior'); // investimento 1000 → 1500
    expect(t).toContain('-20% vs período anterior'); // resultados 50 → 40
    expect(t.indexOf('- Grande')).toBeLessThan(t.indexOf('- Pequena'));
  });

  it('conta conectada sem veiculação diz isso em vez de inventar totais', async () => {
    const { dadosEmTexto } = await import('./jarbas-local');
    const t = dadosEmTexto('Elite', periodo, [{ canal: 'Meta Ads', conectado: true, atual: null, anterior: null, campanhas: [] }]);
    expect(t).toContain('sem nenhuma veiculação no período');
  });
});

describe('montarPromptDoJarbas', () => {
  it('proíbe número fora do bloco e qualquer promessa de alteração', async () => {
    const { montarPromptDoJarbas } = await import('./jarbas-local');
    const p = montarPromptDoJarbas('como está a Elite?', 'CLIENTE: Elite');
    expect(p).toContain('Todo número da resposta tem que estar no bloco DADOS');
    expect(p).toContain('Você só lê');
    expect(p.indexOf('\nPERGUNTA:\n')).toBeLessThan(p.indexOf('\nDADOS:\n'));
  });

  it('JARBAS_LOCAL_ENABLED=false desliga', async () => {
    const { jarbasLocalLigado } = await import('./jarbas-local');
    expect(jarbasLocalLigado({})).toBe(true);
    expect(jarbasLocalLigado({ JARBAS_LOCAL_ENABLED: 'false' })).toBe(false);
  });
});
