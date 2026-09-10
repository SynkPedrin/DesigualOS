/**
 * Recuperação LÉXICA do JSON que o modelo local devolve embrulhado.
 *
 * Por que existe: no `chatJson`, uma falha de `JSON.parse` custava uma
 * SEGUNDA chamada de modelo inteira (a tentativa de correção). No hardware do
 * Otto isso não é um detalhe - a geração roda a ~10 tokens/s, então um plano
 * criativo malformado cobrava minutos de espera pra consertar coisa que não é
 * problema de conteúdo, e sim de embrulho: cerca de ``` no texto, um prefácio
 * antes da primeira chave, ou um bloco de raciocínio vazado junto.
 *
 * O que esta função NÃO faz, de propósito: não completa campo faltando, não
 * conserta JSON truncado, não adivinha valor. Ela só REMOVE embrulho em volta
 * de um JSON que já está inteiro. Se o modelo entregou conteúdo errado ou
 * incompleto, a correção com o modelo continua acontecendo e, se ela também
 * falhar, o erro sobe - a garantia de "nunca devolver um plano mais ou menos"
 * fica intacta.
 */

/** Bloco de raciocínio vazado no corpo da resposta (modelo com "thinking"). */
const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;
/** Cerca de markdown, com ou sem a dica de linguagem. */
const CODE_FENCE = /^\s*```(?:json|JSON)?\s*([\s\S]*?)\s*```\s*$/;

/**
 * Devolve o trecho que tem chance de ser o JSON da resposta, ou null quando
 * não há nada parecido com objeto/array no texto.
 */
export function extractJsonPayload(raw: string): string | null {
  let text = raw.replace(THINK_BLOCK, '').trim();

  const fenced = text.match(CODE_FENCE);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();

  if (text.length === 0) return null;

  const opensObject = text.startsWith('{') && text.endsWith('}');
  const opensArray = text.startsWith('[') && text.endsWith(']');
  if (opensObject || opensArray) return text;

  // Prefácio e/ou epílogo em prosa: recorta da primeira abertura até a última
  // fechadura do MESMO tipo. Pega o objeto/array mais externo, que é o que o
  // schema espera.
  const candidates = [
    { start: text.indexOf('{'), end: text.lastIndexOf('}') },
    { start: text.indexOf('['), end: text.lastIndexOf(']') },
  ].filter((range) => range.start !== -1 && range.end > range.start);

  if (candidates.length === 0) return null;
  // O que abrir primeiro no texto é o container externo.
  candidates.sort((a, b) => a.start - b.start);
  const chosen = candidates[0]!;
  return text.slice(chosen.start, chosen.end + 1).trim();
}

/**
 * `JSON.parse` tolerante a embrulho: tenta o texto cru primeiro (caminho
 * normal, custo zero) e só então a extração. Devolve o resultado E se houve
 * reparo, pra quem chama poder logar honestamente que o modelo não entregou
 * JSON puro.
 */
export function parseJsonLoose(
  raw: string,
): { ok: true; value: unknown; repaired: boolean } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw), repaired: false };
  } catch (directError) {
    const payload = extractJsonPayload(raw);
    if (payload === null || payload === raw.trim()) {
      return {
        ok: false,
        error: `invalid JSON: ${directError instanceof Error ? directError.message : String(directError)}`,
      };
    }
    try {
      return { ok: true, value: JSON.parse(payload), repaired: true };
    } catch (payloadError) {
      return {
        ok: false,
        error: `invalid JSON even after unwrapping: ${payloadError instanceof Error ? payloadError.message : String(payloadError)}`,
      };
    }
  }
}
