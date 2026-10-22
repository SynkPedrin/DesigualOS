import { mesDe } from './datas';
import { situacaoDe } from './situacao';

export interface LancamentoDeFluxo {
  kind: 'receita' | 'despesa';
  status: 'aberto' | 'quitado' | 'cancelado';
  dueDate: string;
  amountCents: number;
}

export interface MesDeFluxo {
  mes: string;
  aReceber: number;
  aPagar: number;
  saldoDoMes: number;
  acumulado: number;
}

/**
 * Projeção mês a mês do que está ABERTO (a receber e a pagar). Cancelado e quitado ficam
 * de fora: o que já entrou ou saiu mora no razão, não na projeção. Vencidos e não vencidos
 * entram (dinheiro que ainda não chegou continua sendo previsão); `vencidoACobrar` separa o que
 * já devia ter entrado, para ninguém ler atraso como entrada futura.
 */
export function projetarFluxo(
  lancamentos: readonly LancamentoDeFluxo[],
  opcoes: { hoje: string; saldoInicialCentavos: number },
): { meses: MesDeFluxo[]; vencidoACobrar: number; vencidoAPagar: number } {
  const porMes = new Map<string, { r: number; p: number }>();
  let vencidoACobrar = 0;
  let vencidoAPagar = 0;
  for (const l of lancamentos) {
    if (situacaoDe(l, opcoes.hoje) === 'quitado' || l.status === 'cancelado') continue;
    if (situacaoDe(l, opcoes.hoje) === 'vencido') {
      if (l.kind === 'receita') vencidoACobrar += l.amountCents;
      else vencidoAPagar += l.amountCents;
    }
    const mes = mesDe(l.dueDate < opcoes.hoje ? opcoes.hoje : l.dueDate);
    const acc = porMes.get(mes) ?? { r: 0, p: 0 };
    if (l.kind === 'receita') acc.r += l.amountCents;
    else acc.p += l.amountCents;
    porMes.set(mes, acc);
  }
  let acumulado = opcoes.saldoInicialCentavos;
  const meses = [...porMes.keys()].sort().map((mes) => {
    const { r, p } = porMes.get(mes)!;
    acumulado += r - p;
    return { mes, aReceber: r, aPagar: p, saldoDoMes: r - p, acumulado };
  });
  return { meses, vencidoACobrar, vencidoAPagar };
}
