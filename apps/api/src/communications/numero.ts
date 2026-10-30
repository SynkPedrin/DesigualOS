/**
 * Número digitado em "Nova conversa" → só dígitos, com o código do país. Quem digita no Brasil escreve DDD e número
 * ("(18) 99632-6160"), às vezes com o 55 ou um 0 de longa distância na frente; número de fora vem com "+". Sem como
 * saber o país, não adivinha: devolve null e a tela pede o número com DDD ou com "+".
 */
export function numeroParaWhatsapp(entrada: string): string | null {
  const internacional = entrada.trim().startsWith('+') || entrada.trim().startsWith('00');
  let digitos = entrada.replace(/\D/g, '');
  if (internacional) {
    if (digitos.startsWith('00')) digitos = digitos.slice(2);
    return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
  }
  if (digitos.startsWith('0')) digitos = digitos.replace(/^0+/, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return digitos;
  return null;
}
