/**
 * datas.ts: datas do financeiro são DIA, não instante. Vivem como "AAAA-MM-DD" e a aritmética
 * é feita em UTC sobre esse texto, então o fuso da máquina nunca desloca um vencimento
 * (o relatório em PDF já mostrou datas um dia atrás por isso).
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dataValida(iso: string): boolean {
  const m = ISO.exec(iso);
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(a, me - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === me - 1 && t.getUTCDate() === d;
}

function partes(iso: string): [number, number, number] {
  if (!dataValida(iso)) throw new Error(`Data inválida: "${iso}".`);
  const m = ISO.exec(iso)!;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const paraIso = (a: number, m: number, d: number) => `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ultimoDiaDoMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();

/** Soma meses mantendo o `dia`; em mês curto vale o último dia (31/01 + 1 mês = 28/02 ou 29/02). */
export function somarMeses(iso: string, meses: number, dia?: number): string {
  const [a, m, d] = partes(iso);
  const indice = a * 12 + (m - 1) + meses;
  const ano = Math.floor(indice / 12);
  const mes = (indice % 12) + 1;
  return paraIso(ano, mes, Math.min(dia ?? d, ultimoDiaDoMes(ano, mes)));
}

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = partes(iso);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return paraIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const diasEntre = (de: string, ate: string): number => {
  const [a1, m1, d1] = partes(de);
  const [a2, m2, d2] = partes(ate);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
};

/** "Hoje" no fuso da agência, não no do servidor. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** "dd/mm/aaaa" (formato do Operand) → "aaaa-mm-dd". Nulo se não for uma data real. */
export function isoDeBR(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return dataValida(iso) ? iso : null;
}

export const mesDe = (iso: string): string => iso.slice(0, 7);
