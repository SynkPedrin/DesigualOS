import { dividirEmParcelas } from './dinheiro';
import { somarMeses } from './datas';

export interface Parcela {
  numero: number;
  total: number;
  valorCentavos: number;
  vencimento: string;
}

/**
 * Parcelamento: N parcelas mensais que somam EXATAMENTE o total. O dia do vencimento é o do
 * primeiro, e mês curto cai no último dia (nunca pula para o mês seguinte).
 */
export function gerarParcelas(entrada: { totalCentavos: number; quantidade: number; primeiroVencimento: string }): Parcela[] {
  const valores = dividirEmParcelas(entrada.totalCentavos, entrada.quantidade);
  const dia = Number(entrada.primeiroVencimento.slice(8, 10));
  return valores.map((valorCentavos, i) => ({
    numero: i + 1,
    total: valores.length,
    valorCentavos,
    vencimento: somarMeses(entrada.primeiroVencimento, i, dia),
  }));
}

/** "2/3" → { numero: 2, total: 3 }. Texto fora do padrão (ex.: "5x18") devolve nulo, não chuta. */
export function lerParcela(texto: string | null | undefined): { numero: number; total: number } | null {
  const m = /^\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*$/.exec(texto ?? '');
  if (!m) return null;
  const [numero, total] = [Number(m[1]), Number(m[2])];
  return numero >= 1 && total >= numero ? { numero, total } : null;
}
