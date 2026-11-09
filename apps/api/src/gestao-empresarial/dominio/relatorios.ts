import { diasEntre } from './datas';

export type FaixaDeAtraso = 'a_vencer' | '1_30' | '31_60' | '61_90' | 'mais_de_90';
export const FAIXAS: readonly FaixaDeAtraso[] = ['a_vencer', '1_30', '31_60', '61_90', 'mais_de_90'];

/** Dias de atraso contados do vencimento: no próprio dia ainda é "a vencer" (a mesma regra da situação). */
export function faixaDeAtraso(vencimento: string, hoje: string): FaixaDeAtraso {
  const atraso = diasEntre(vencimento, hoje);
  if (atraso <= 0) return 'a_vencer';
  if (atraso <= 30) return '1_30';
  if (atraso <= 60) return '31_60';
  if (atraso <= 90) return '61_90';
  return 'mais_de_90';
}

export function agruparPorAtraso(lancamentos: ReadonlyArray<{ dueDate: string; amountCents: number }>, hoje: string): Record<FaixaDeAtraso, { quantidade: number; totalCents: number }> {
  const r = Object.fromEntries(FAIXAS.map((f) => [f, { quantidade: 0, totalCents: 0 }])) as Record<FaixaDeAtraso, { quantidade: number; totalCents: number }>;
  for (const l of lancamentos) {
    const f = r[faixaDeAtraso(l.dueDate, hoje)];
    f.quantidade += 1;
    f.totalCents += l.amountCents;
  }
  return r;
}

/** CSV para planilha brasileira: separador `;`, vírgula decimal, aspas dobradas, e prefixo contra injeção de fórmula. */
export function linhaCsv(campos: ReadonlyArray<string | number | null>): string {
  return campos
    .map((c) => {
      if (c === null) return '';
      let t = String(c);
      // Célula que começa com = + - @ vira fórmula no Excel. Quem digitou "=1+1" num campo livre não pode executar nada.
      if (typeof c === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
      return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    })
    .join(';');
}

export const centavosParaCsv = (c: number): string => `${c < 0 ? '-' : ''}${Math.trunc(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, '0')}`;
