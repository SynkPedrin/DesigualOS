/**
 * Normaliza um telefone digitado para o formato que o backend guarda: só
 * dígitos, com DDI e DDD (`5511900000001`). Aceita como a pessoa digita:
 * "(11) 90000-0001", "11 90000-0001", "+55 11 90000-0001", "5511900000001".
 *
 * Devolve `null` quando não dá para ter certeza de que é um celular ou fixo
 * brasileiro: errar o número manda um aviso de mídia para a pessoa errada.
 * Não "completa" nada além do DDI 55, e só quando o que sobra tem o tamanho de
 * um número nacional (DDD + 8 ou 9 dígitos).
 */
/** DDD (11 a 99) + celular (9 e mais 8 dígitos) ou fixo (2 a 5 e mais 7 dígitos). */
const NACIONAL = /^[1-9][1-9](?:9\d{8}|[2-5]\d{7})$/;

export function normalizarTelefoneBr(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, '');
  // "+1 415 ..." é de outro país: nunca vira número brasileiro por ter 11 dígitos.
  if (entrada.trim().startsWith('+') && !digitos.startsWith('55')) return null;
  if (digitos.startsWith('55') && NACIONAL.test(digitos.slice(2))) return digitos;
  if (NACIONAL.test(digitos)) return `55${digitos}`;
  return null;
}

/** `5511900000001` vira `+55 11 90000-0001`, para exibir (nunca para comparar). */
export function telefoneBrLegivel(telefone: string): string {
  const d = telefone.replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(d)) return `+${d}`;
  const ddd = d.slice(2, 4);
  const resto = d.slice(4);
  return `+55 ${ddd} ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}
