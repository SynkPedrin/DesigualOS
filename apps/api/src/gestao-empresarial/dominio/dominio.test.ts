import { describe, expect, it } from 'vitest';
import { centavosDeTexto, dividirEmParcelas, ErroDeValor, exigirCentavos, formatarBRL, somar } from './dinheiro';
import { dataValida, diasEntre, hojeEmSaoPaulo, isoDeBR, somarDias, somarMeses } from './datas';
import { gerarParcelas, lerParcela } from './parcelas';
import { ocorrenciasPendentes } from './recorrencia';
import { situacaoDe } from './situacao';
import { cnpjValido, cpfValido, lerDocumento, normalizarNome, textoOuNulo } from './documentos';
import { projetarFluxo } from './fluxo-de-caixa';
import { totaisPorSituacao, historicoParcial } from './indicadores';

describe('dinheiro em centavos', () => {
  it('lê os formatos brasileiros e o de máquina', () => {
    expect(centavosDeTexto('1.234,56')).toBe(123456);
    expect(centavosDeTexto('R$ 1.234,56')).toBe(123456);
    expect(centavosDeTexto('1234.56')).toBe(123456);
    expect(centavosDeTexto('14980.00')).toBe(1498000);
    expect(centavosDeTexto('0,5')).toBe(50);
    expect(centavosDeTexto('1234')).toBe(123400);
    expect(centavosDeTexto('1.234')).toBe(123400);
    expect(centavosDeTexto('-10,00')).toBe(-1000);
  });
  it('recusa texto que não é dinheiro em vez de chutar', () => {
    for (const ruim of ['', 'abc', '12,3x', '1,2,3,4x']) expect(() => centavosDeTexto(ruim)).toThrow(ErroDeValor);
  });
  it('a conta de ponto flutuante que quebra: 0,1 + 0,2 dá exatamente 0,30', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(somar([centavosDeTexto('0,10'), centavosDeTexto('0,20')])).toBe(30);
  });
  it('exige inteiro na borda: 12.5 centavos é erro, não 12', () => {
    expect(() => exigirCentavos(12.5)).toThrow(ErroDeValor);
    expect(() => exigirCentavos('100')).toThrow(ErroDeValor);
    expect(exigirCentavos(100)).toBe(100);
  });
  it('formata igual em qualquer máquina', () => {
    expect(formatarBRL(123456)).toBe('R$ 1.234,56');
    expect(formatarBRL(5)).toBe('R$ 0,05');
    expect(formatarBRL(-100000)).toBe('-R$ 1.000,00');
    expect(formatarBRL(100000000)).toBe('R$ 1.000.000,00');
  });
  it('divide em parcelas que SOMAM o total, com a sobra nas primeiras', () => {
    expect(dividirEmParcelas(10000, 3)).toEqual([3334, 3333, 3333]);
    for (const [t, n] of [[10000, 3], [99999, 7], [1, 1], [100, 100], [123457, 12]] as const) expect(somar(dividirEmParcelas(t, n))).toBe(t);
  });
  it('recusa parcelamento impossível', () => {
    expect(() => dividirEmParcelas(0, 2)).toThrow();
    expect(() => dividirEmParcelas(100, 0)).toThrow();
    expect(() => dividirEmParcelas(2, 5)).toThrow(/mais parcelas/);
  });
});

describe('datas como dia, sem fuso', () => {
  it('valida datas reais', () => {
    expect(dataValida('2026-02-28')).toBe(true);
    expect(dataValida('2026-02-30')).toBe(false);
    expect(dataValida('2024-02-29')).toBe(true);
    expect(dataValida('2026-13-01')).toBe(false);
    expect(dataValida('01/02/2026')).toBe(false);
  });
  it('mês curto cai no último dia e não pula de mês', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2024-01-31', 1)).toBe('2024-02-29');
    expect(somarMeses('2026-11-30', 3)).toBe('2027-02-28');
    expect(somarMeses('2026-12-15', 1)).toBe('2027-01-15');
    expect(somarMeses('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('soma dias atravessando mês e ano', () => {
    expect(somarDias('2026-12-30', 3)).toBe('2027-01-02');
    expect(diasEntre('2026-10-08', '2026-10-22')).toBe(14);
  });
  it('lê o formato do Operand e recusa data impossível', () => {
    expect(isoDeBR('23/10/2026')).toBe('2026-10-23');
    expect(isoDeBR('31/02/2026')).toBeNull();
    expect(isoDeBR('2026-10-23')).toBeNull();
  });
  it('"hoje" é o dia de São Paulo, não o UTC', () => {
    expect(hojeEmSaoPaulo(new Date('2026-10-23T01:30:00Z'))).toBe('2026-10-22');
    expect(hojeEmSaoPaulo(new Date('2026-10-22T12:00:00Z'))).toBe('2026-10-22');
  });
});

describe('parcelas', () => {
  it('3 parcelas mensais que somam o total, mantendo o dia', () => {
    const p = gerarParcelas({ totalCentavos: 10000, quantidade: 3, primeiroVencimento: '2026-01-31' });
    expect(p.map((x) => x.vencimento)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(p.map((x) => x.valorCentavos)).toEqual([3334, 3333, 3333]);
    expect(p.map((x) => `${x.numero}/${x.total}`)).toEqual(['1/3', '2/3', '3/3']);
  });
  it('lê "2/3" e não chuta com "5x18"', () => {
    expect(lerParcela('2/3')).toEqual({ numero: 2, total: 3 });
    expect(lerParcela(' 1 / 2 ')).toEqual({ numero: 1, total: 2 });
    expect(lerParcela('5x18')).toBeNull();
    expect(lerParcela('3/2')).toBeNull();
    expect(lerParcela('')).toBeNull();
    expect(lerParcela(null)).toBeNull();
  });
});

describe('recorrência', () => {
  const base = { frequencia: 'mensal' as const, inicio: '2026-01-31' };
  it('gera as ocorrências do período, com mês curto', () => {
    expect(ocorrenciasPendentes(base, '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('rodar de novo depois de avançar geradoAte não duplica', () => {
    const primeira = ocorrenciasPendentes(base, '2026-03-31');
    const segunda = ocorrenciasPendentes({ ...base, geradoAte: primeira.at(-1) }, '2026-03-31');
    expect(primeira).toHaveLength(3);
    expect(segunda).toEqual([]);
    expect(ocorrenciasPendentes({ ...base, geradoAte: '2026-03-31' }, '2026-05-31')).toEqual(['2026-04-30', '2026-05-31']);
  });
  it('respeita a data final e as outras frequências', () => {
    expect(ocorrenciasPendentes({ ...base, fim: '2026-02-28' }, '2026-12-31')).toEqual(['2026-01-31', '2026-02-28']);
    expect(ocorrenciasPendentes({ frequencia: 'trimestral', inicio: '2026-01-10' }, '2026-12-31')).toHaveLength(4);
    expect(ocorrenciasPendentes({ frequencia: 'semanal', inicio: '2026-10-01' }, '2026-10-22')).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);
    expect(ocorrenciasPendentes({ frequencia: 'anual', inicio: '2024-02-29' }, '2027-03-01')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28']);
  });
  it('dia do mês próprio vale sobre o dia do início', () => {
    expect(ocorrenciasPendentes({ frequencia: 'mensal', inicio: '2026-01-05', diaDoMes: 10 }, '2026-03-31')).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });
});

describe('situação: vencido é calculado, nunca guardado', () => {
  const hoje = '2026-10-22';
  it('aberto vence no dia SEGUINTE ao vencimento', () => {
    expect(situacaoDe({ status: 'aberto', dueDate: '2026-10-22' }, hoje)).toBe('aberto');
    expect(situacaoDe({ status: 'aberto', dueDate: '2026-10-21' }, hoje)).toBe('vencido');
    expect(situacaoDe({ status: 'aberto', dueDate: '2026-10-23' }, hoje)).toBe('aberto');
  });
  it('quitado e cancelado nunca viram vencido, por mais antigos que sejam', () => {
    expect(situacaoDe({ status: 'quitado', dueDate: '2021-06-01' }, hoje)).toBe('quitado');
    expect(situacaoDe({ status: 'cancelado', dueDate: '2021-06-01' }, hoje)).toBe('cancelado');
  });
});

describe('documentos', () => {
  it('confere dígito verificador de CPF e CNPJ', () => {
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('52998224726')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cnpjValido('11222333000181')).toBe(true);
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
  });
  it('lê com máscara, marca inválido sem corrigir e trata ausente como nulo', () => {
    expect(lerDocumento('529.982.247-25')).toEqual({ document: '52998224725', kind: 'cpf', valid: true });
    expect(lerDocumento('11.222.333/0001-82')).toEqual({ document: '11222333000182', kind: 'cnpj', valid: false });
    expect(lerDocumento('12345')).toEqual({ document: '12345', kind: 'outro', valid: false });
    expect(lerDocumento('')).toEqual({ document: null, kind: null, valid: null });
    expect(lerDocumento(null)).toEqual({ document: null, kind: null, valid: null });
    expect(lerDocumento('  ')).toEqual({ document: null, kind: null, valid: null });
  });
  it('célula só com espaço é vazio (o Operand exporta assim)', () => {
    expect(textoOuNulo(' ')).toBeNull();
    expect(textoOuNulo('')).toBeNull();
    expect(textoOuNulo('  SP ')).toBe('SP');
    expect(textoOuNulo(null)).toBeNull();
  });
  it('normaliza nome só para comparar', () => {
    expect(normalizarNome('  Ação  Gráfica  LTDA ')).toBe('acao grafica ltda');
  });
});

describe('fluxo de caixa', () => {
  const hoje = '2026-10-22';
  it('projeta só o aberto, separa o vencido e acumula a partir do saldo', () => {
    const f = projetarFluxo(
      [
        { kind: 'receita', status: 'aberto', dueDate: '2026-10-08', amountCents: 10000 },
        { kind: 'receita', status: 'aberto', dueDate: '2026-10-27', amountCents: 5000 },
        { kind: 'despesa', status: 'aberto', dueDate: '2026-11-05', amountCents: 3000 },
        { kind: 'receita', status: 'quitado', dueDate: '2026-10-25', amountCents: 99999 },
        { kind: 'receita', status: 'cancelado', dueDate: '2026-11-25', amountCents: 88888 },
      ],
      { hoje, saldoInicialCentavos: 1000 },
    );
    expect(f.vencidoACobrar).toBe(10000);
    expect(f.vencidoAPagar).toBe(0);
    expect(f.meses).toEqual([
      { mes: '2026-10', aReceber: 15000, aPagar: 0, saldoDoMes: 15000, acumulado: 16000 },
      { mes: '2026-11', aReceber: 0, aPagar: 3000, saldoDoMes: -3000, acumulado: 13000 },
    ]);
  });
});

describe('indicadores', () => {
  it('cancelado não é receita: o bruto do Operand inflaria 2,5 vezes', () => {
    const t = totaisPorSituacao([
      { kind: 'receita', status: 'quitado', amountCents: 12565849 },
      { kind: 'receita', status: 'aberto', amountCents: 169800 },
      { kind: 'receita', status: 'cancelado', amountCents: 19209510 },
    ]);
    expect(t.receitaRecebida).toBe(12565849);
    expect(t.receitaAberta).toBe(169800);
    expect(t.cancelado).toBe(19209510);
    expect(t.receitaRecebida + t.receitaAberta).toBe(12735649);
  });
  it('quitado usa o valor efetivamente pago, quando difere do previsto', () => {
    expect(totaisPorSituacao([{ kind: 'receita', status: 'quitado', amountCents: 1000, paidAmountCents: 900 }]).receitaRecebida).toBe(900);
  });
  it('histórico é parcial quando só há receita e nenhuma despesa', () => {
    expect(historicoParcial([{ kind: 'receita', status: 'quitado', amountCents: 1 }])).toBe(true);
    expect(historicoParcial([{ kind: 'receita', status: 'quitado', amountCents: 1 }, { kind: 'despesa', status: 'aberto', amountCents: 1 }])).toBe(false);
    expect(historicoParcial([])).toBe(false);
    expect(historicoParcial([{ kind: 'receita', status: 'cancelado', amountCents: 1 }])).toBe(false);
  });
});

describe('situação com dado inconsistente', () => {
  it('status fora da lista é erro, nunca "aberto" em silêncio', () => {
    expect(() => situacaoDe({ status: 'pago', dueDate: '2026-10-01' }, '2026-10-22')).toThrow(/desconhecido/);
  });
});
