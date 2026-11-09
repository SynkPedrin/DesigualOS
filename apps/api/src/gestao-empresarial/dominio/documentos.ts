/** documentos.ts: CPF, CNPJ, telefone e e-mail. Normalizar serve para COMPARAR; o original é guardado. */

export const soDigitos = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

const todosIguais = (d: string) => /^(\d)\1+$/.test(d);

export function cpfValido(d: string): boolean {
  if (d.length !== 11 || todosIguais(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(d: string): boolean {
  if (d.length !== 14 || todosIguais(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i]!;
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

export interface DocumentoLido {
  /** Só dígitos; nulo quando não havia documento. */
  document: string | null;
  kind: 'cpf' | 'cnpj' | 'outro' | null;
  /** Nulo = nada para conferir. `false` = dígito verificador não bate (entra marcado, nunca corrigido). */
  valid: boolean | null;
}

export function lerDocumento(bruto: string | null | undefined): DocumentoLido {
  const d = soDigitos(bruto);
  if (!d) return { document: null, kind: null, valid: null };
  if (d.length === 11) return { document: d, kind: 'cpf', valid: cpfValido(d) };
  if (d.length === 14) return { document: d, kind: 'cnpj', valid: cnpjValido(d) };
  return { document: d, kind: 'outro', valid: false };
}

/** Sem acento, minúsculas, espaços únicos. Só para comparar nomes. */
export const normalizarNome = (v: string | null | undefined): string =>
  (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Vazio no Operand vem como célula em branco OU um espaço: ambos viram nulo. */
export const textoOuNulo = (v: string | null | undefined): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

export const emailValido = (v: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
