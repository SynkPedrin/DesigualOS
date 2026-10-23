/**
 * Prévia das parcelas ao faturar. É a MESMA regra da API (dominio/parcelas.ts): soma exata do total,
 * sobra de centavos nas primeiras, dia do primeiro vencimento mantido (mês curto cai no último dia).
 * A API recalcula e é quem vale; aqui só se mostra o que vai acontecer.
 */
export function dividir(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const sobra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < sobra ? 1 : 0));
}

export function somarMeses(iso: string, meses: number, dia: number): string {
  const [a, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  const indice = a * 12 + (m - 1) + meses;
  const ano = Math.floor(indice / 12);
  const mes = (indice % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

export function previaDasParcelas(total: number, n: number, primeiro: string): Array<{ numero: number; valor: number; vencimento: string }> {
  if (!Number.isInteger(n) || n < 1 || n > 120 || total < n || !/^\d{4}-\d{2}-\d{2}$/.test(primeiro)) return [];
  const dia = Number(primeiro.slice(8, 10));
  return dividir(total, n).map((valor, i) => ({ numero: i + 1, valor, vencimento: somarMeses(primeiro, i, dia) }));
}
