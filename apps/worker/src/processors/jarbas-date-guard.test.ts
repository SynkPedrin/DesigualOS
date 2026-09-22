import { describe, expect, it } from 'vitest';
import {
  checkDateRangeMatch,
  extractQueriedRange,
  extractRequestedRange,
  sourceRangeMismatchMessage,
} from './jarbas-date-guard';

/**
 * JARBAS_EXACT_DATE_RANGE — regressão do bug real medido ao vivo
 * (22/09/2026): "Jarbas, qual cliente apresentou melhor resultado entre 19 e
 * 21 de setembro de 2026?" voltou com "CARTEIRA, 2026-09-01 a 2026-09-30,
 * fonte: Meta Ads" — o serviço externo ignorou o range pedido e consultou o
 * MÊS inteiro, entregando um ranking confiante do período errado. Como a
 * causa raiz é externa (JARBAS_ASK_URL, sem código neste repositório), o
 * guard bloqueia a divergência NA BORDA em vez de corrigir a fonte.
 */
describe('extractRequestedRange', () => {
  it('reconhece "entre 19 e 21 de setembro de 2026" (o caso real)', () => {
    expect(extractRequestedRange('Jarbas, qual cliente apresentou melhor resultado entre 19 e 21 de setembro de 2026?')).toEqual({
      start: '2026-09-19',
      end: '2026-09-21',
    });
  });

  it('reconhece "do dia 19 ao dia 21 de setembro de 2026"', () => {
    expect(extractRequestedRange('Só do dia 19 ao dia 21 de setembro de 2026.')).toEqual({
      start: '2026-09-19',
      end: '2026-09-21',
    });
  });

  it('reconhece "de 19 a 21 de setembro de 2026"', () => {
    expect(extractRequestedRange('Compare de 19 a 21 de setembro de 2026 com a semana anterior.')).toEqual({
      start: '2026-09-19',
      end: '2026-09-21',
    });
  });

  it('reconhece range numérico DD/MM/YYYY a DD/MM/YYYY', () => {
    expect(extractRequestedRange('Quero o range de 19/09/2026 a 21/09/2026.')).toEqual({
      start: '2026-09-19',
      end: '2026-09-21',
    });
  });

  it('NÃO reconhece datas relativas — fail-open, nunca chuta um valor', () => {
    expect(extractRequestedRange('Quem foi melhor essa semana?')).toBeNull();
    expect(extractRequestedRange('E no fim de semana passado?')).toBeNull();
    expect(extractRequestedRange('Compare os últimos 7 dias com os 7 anteriores.')).toBeNull();
  });
});

describe('extractQueriedRange', () => {
  it('lê o cabeçalho real que o Jarbas devolve', () => {
    expect(
      extractQueriedRange(
        'CARTEIRA, 2026-09-01 a 2026-09-30, fonte: Meta Ads\n6 contas com investimento no periodo...',
      ),
    ).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('sem cabeçalho reconhecível, devolve null (fail-open)', () => {
    expect(extractQueriedRange('Elite foi o melhor cliente no período.')).toBeNull();
  });
});

describe('checkDateRangeMatch — reproduz e bloqueia o bug real', () => {
  const PEDIDO = 'Jarbas, qual cliente apresentou melhor resultado entre 19 e 21 de setembro de 2026?';
  const RESPOSTA_REAL =
    'CARTEIRA, 2026-09-01 a 2026-09-30, fonte: Meta Ads\n' +
    '6 contas com investimento no periodo\n' +
    'Investimento total: R$ 11.330,30\n' +
    'Melhor eficiencia: Elite: R$ 3,15 por resultado';

  it('divergência real (19-21 pedido vs 01-30 consultado) é BLOQUEADA', () => {
    const r = checkDateRangeMatch(PEDIDO, RESPOSTA_REAL);
    expect(r.ok).toBe(false);
    expect(r.requested).toEqual({ start: '2026-09-19', end: '2026-09-21' });
    expect(r.queried).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('range batendo passa normalmente', () => {
    const r = checkDateRangeMatch(PEDIDO, 'CARTEIRA, 2026-09-19 a 2026-09-21, fonte: Meta Ads\nElite foi o melhor.');
    expect(r.ok).toBe(true);
  });

  it('sem range explícito no pedido (relativo), não bloqueia — não é o que este guard cobre', () => {
    const r = checkDateRangeMatch('Quem foi melhor essa semana?', RESPOSTA_REAL);
    expect(r.ok).toBe(true);
    expect(r.requested).toBeNull();
  });

  it('resposta sem cabeçalho de range reconhecível não bloqueia (fail-open)', () => {
    const r = checkDateRangeMatch(PEDIDO, 'Não encontrei dados suficientes pra esse período.');
    expect(r.ok).toBe(true);
  });
});

describe('sourceRangeMismatchMessage', () => {
  it('nunca promete ação futura — seção 15 da missão', () => {
    const msg = sourceRangeMismatchMessage({
      ok: false,
      requested: { start: '2026-09-19', end: '2026-09-21' },
      queried: { start: '2026-09-01', end: '2026-09-30' },
    });
    expect(msg).not.toMatch(/vou (verificar|checar|consultar)[^.]*e (te )?(volto|retorno)/i);
    expect(msg).toMatch(/19\/09\/2026/);
    expect(msg).toMatch(/01\/09\/2026/);
    expect(msg).toMatch(/SOURCE_RANGE_MISMATCH/);
  });
});
