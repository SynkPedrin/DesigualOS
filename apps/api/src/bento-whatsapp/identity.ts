import { createHash, randomInt } from 'node:crypto';

/**
 * Identidade no canal: de onde veio a mensagem e o código que prova o vínculo.
 *
 * Nada aqui usa nome de contato, `pushName` ou foto. O único dado do WhatsApp
 * que conta é o número do remetente, e ele só vira pessoa depois do vínculo
 * provado pelos dois lados (código enviado PELO número + confirmação na
 * sessão web autenticada).
 */

/** Só dígitos de um JID `5518...@c.us` / `...@s.whatsapp.net`. `@lid` e `@g.us` não são telefone. */
export function telefoneDoJid(jid: string | undefined | null): string | null {
  if (!jid) return null;
  const [usuario, dominio] = jid.split('@');
  if (!usuario || !dominio) return null;
  if (dominio !== 'c.us' && dominio !== 's.whatsapp.net') return null;
  const digitos = usuario.split(':')[0]!.replace(/\D/g, '');
  return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
}

export function chatIdDoTelefone(telefone: string): string {
  return `${telefone}@c.us`;
}

/** `5518997987295` → `+55 18 99798-7295`. Para exibir; nunca para comparar. */
export function telefoneLegivel(telefone: string): string {
  const d = telefone.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    const corte = resto.length - 4;
    return `+55 ${ddd} ${resto.slice(0, corte)}-${resto.slice(corte)}`;
  }
  return `+${d}`;
}

/** Mascara para o painel administrativo: `+55 18 9****-7295`. */
export function telefoneMascarado(telefone: string): string {
  const legivel = telefoneLegivel(telefone);
  return legivel.replace(/(\d)(\d{3,4})(-\d{4})$/, (_m, primeiro: string, meio: string, fim: string) => `${primeiro}${'*'.repeat(meio.length)}${fim}`);
}

/**
 * Alfabeto sem caractere ambíguo (sem 0/O, 1/I/L). 31 símbolos × 8 posições
 * ≈ 39,6 bits. Com 10 minutos de vida, uso único, limite de tentativas por
 * número e confirmação humana na web, adivinhar não é ataque viável — e
 * mesmo acertando, o vínculo só nasce quando o DONO do código confirma o
 * número na tela dele.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAMANHO = 8;

export const VIDA_DO_CODIGO_MS = 10 * 60_000;

export function gerarCodigoDeVinculo(): string {
  let codigo = '';
  for (let i = 0; i < TAMANHO; i++) codigo += ALFABETO[randomInt(ALFABETO.length)];
  return `BENTO-${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

/** Normaliza o que a pessoa digitou/colou para a forma que é guardada em hash. */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/^BENTO/, '').replace(/[^A-Z0-9]/g, '');
}

export function hashDoCodigo(codigo: string): string {
  return createHash('sha256').update(`bento-whatsapp:${normalizarCodigo(codigo)}`).digest('hex');
}

/**
 * Acha um código de vínculo dentro da mensagem. Aceita com ou sem hífen, com
 * espaço, minúsculo, e com texto em volta ("oi, meu código é bento-ab3k-9xqp").
 */
export function extrairCodigoDeVinculo(texto: string): string | null {
  const achado = texto
    .toUpperCase()
    .match(new RegExp(`\\bBENTO[\\s-]*([${ALFABETO}]{4})[\\s-]*([${ALFABETO}]{4})\\b`));
  return achado ? `BENTO-${achado[1]}-${achado[2]}` : null;
}
