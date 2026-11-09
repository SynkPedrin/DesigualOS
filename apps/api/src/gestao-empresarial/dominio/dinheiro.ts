/**
 * dinheiro.ts: dinheiro é INTEIRO em centavos. Nunca float, nunca `number` com vírgula.
 *
 * Toda conta do módulo passa por aqui. `0,1 + 0,2` em ponto flutuante dá `0,30000000000000004`;
 * em centavos, 10 + 20 = 30, sempre.
 */

export class ErroDeValor extends Error {}

/** "1.234,56", "R$ 1.234,56", "1234.56", "1234" → centavos. Lança em texto que não é dinheiro. */
export function centavosDeTexto(texto: string): number {
  const limpo = texto.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!limpo) throw new ErroDeValor('Valor vazio.');
  const negativo = limpo.startsWith('-');
  const corpo = negativo ? limpo.slice(1) : limpo;
  if (!/^\d[\d.,]*$/.test(corpo)) throw new ErroDeValor(`Valor inválido: "${texto}".`);
  // O último separador decide: vírgula ou ponto seguidos de 1 ou 2 dígitos = centavos.
  const m = /^(.*?)[.,](\d{1,2})$/.exec(corpo);
  const inteiros = (m ? m[1]! : corpo).replace(/[.,]/g, '');
  const fracao = m ? m[2]!.padEnd(2, '0') : '00';
  if (!/^\d+$/.test(inteiros)) throw new ErroDeValor(`Valor inválido: "${texto}".`);
  const centavos = Number(inteiros) * 100 + Number(fracao);
  if (!Number.isSafeInteger(centavos)) throw new ErroDeValor('Valor grande demais.');
  return negativo ? -centavos : centavos;
}

/** Garante que é inteiro seguro. A API usa isto na borda: `12.5` é erro, não "12 centavos". */
export function exigirCentavos(valor: unknown, campo = 'valor'): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor)) throw new ErroDeValor(`${campo} precisa ser um inteiro em centavos.`);
  return valor;
}

/** 123456 → "R$ 1.234,56". Sem Intl, para o resultado ser idêntico em qualquer máquina. */
export function formatarBRL(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const reais = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sinal}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Divide `total` em `n` partes que SOMAM exatamente `total`. A sobra de centavos vai uma a uma
 * para as primeiras parcelas (100,00 em 3 → 33,34 · 33,33 · 33,33).
 */
export function dividirEmParcelas(total: number, n: number): number[] {
  if (!Number.isSafeInteger(total) || total <= 0) throw new ErroDeValor('Total precisa ser positivo, em centavos.');
  if (!Number.isInteger(n) || n < 1 || n > 360) throw new ErroDeValor('Número de parcelas deve ficar entre 1 e 360.');
  if (total < n) throw new ErroDeValor('Há mais parcelas do que centavos para dividir.');
  const base = Math.floor(total / n);
  const sobra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < sobra ? 1 : 0));
}

export const somar = (valores: readonly number[]): number => valores.reduce((a, b) => a + b, 0);
