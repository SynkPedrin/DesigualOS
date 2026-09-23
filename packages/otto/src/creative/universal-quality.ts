/**
 * PISO UNIVERSAL DE QUALIDADE (Otto Senior V1 — "Universal Quality Floor").
 *
 * Achado ao vivo real (certificação não-vídeo, mesma sessão): carrossel
 * passa pelo critic; legenda, ad, static e feedback-rewrite passam pelo
 * caminho de chat ou pelo caminho de imagem, que NUNCA rodavam nenhuma
 * checagem — nem o detector de placeholder que esta mesma sessão construiu
 * (Otto Elite, Blocker 1/Non-Video Cert), nem checagem de linguagem
 * proibida por cliente. `[FOTO DA VISTA PANORÂMICA]` sobreviveu numa
 * legenda, e `#SonhosRealizadosComQualidade` sobreviveu com o cliente
 * dizendo explicitamente "sem exagero de 'sonho realizado'" no dossiê.
 *
 * Este arquivo é DELIBERADAMENTE pequeno e determinístico — não é um
 * motor de NLP (regra explícita da missão: "handle strong/clear cases",
 * "do not create a giant NLP system"). Cobre dois casos concretos e
 * generalizáveis:
 *
 * 1. LINGUAGEM PROIBIDA DECLARADA NO CONTEXTO: o dossiê do cliente diz
 *    "sem exagero de 'X'" / "evite 'X'" / "não use 'X'" — extrai a frase
 *    entre aspas e verifica se ela (ou uma variação morfológica óbvia:
 *    plural, hashtag concatenada, CamelCase) sobrevive na resposta final.
 *
 * 2. MUDANÇAS EXPLICITAMENTE PEDIDAS EM FEEDBACK: "tira X", "remove Y" —
 *    extrai o alvo de cada instrução de remoção e verifica se ele
 *    realmente sumiu do texto final, em vez de confiar que o modelo
 *    obedeceu só porque disse que obedeceu.
 */

/** Remove acento, baixa caixa, separa hashtag/CamelCase em palavras — a MESMA normalização pros dois lados da comparação. */
function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/#/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ');
}

/** Stemming ingênuo (só sufixo de plural) — o bastante pra "sonhos"~"sonho", "realizados"~"realizado"; não tenta ser um stemmer de verdade. */
function stem(word: string): string {
  return word.replace(/(oes|aes)$/, 'ao').replace(/s$/, '');
}

function significantStems(text: string): string[] {
  return normalizeForMatch(text)
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .map(stem);
}

/**
 * A frase proibida "sobrevive" no texto final se todas as suas palavras
 * significativas aparecem ADJACENTES, na mesma ordem, em algum ponto do
 * texto normalizado — tolera plural e hashtag/CamelCase concatenados
 * (que a normalização já separou em palavras antes desta checagem), mas
 * não tenta achar sinônimo nem paráfrase — isso exigiria julgamento
 * semântico, que é papel do critic (LLM), não desta checagem
 * determinística.
 */
export function containsForbiddenPhrase(answer: string, phrase: string): boolean {
  const phraseStems = significantStems(phrase);
  if (phraseStems.length === 0) return false;
  const answerStems = significantStems(answer);
  const haystack = ` ${answerStems.join(' ')} `;
  const needle = ` ${phraseStems.join(' ')} `;
  return haystack.includes(needle);
}

/**
 * "sem exagero de 'X'", "evite 'X'", "não use 'X'", "nunca use 'X'",
 * "proibido usar 'X'" — os padrões de dossiê já vistos ao vivo. Aspas
 * retas, curvas ou ausentes (frase até pontuação/quebra de linha) contam.
 */
const FORBIDDEN_PHRASE_MARKERS =
  /(?:sem exagero de|evite|n[ãa]o us[ea]|nunca us[ea]|proibido usar)\s*[""']?([^"""'\n.,;]{2,60})[""']?/gi;

export function extractForbiddenPhrases(contextText: string): string[] {
  const found: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(FORBIDDEN_PHRASE_MARKERS.source, FORBIDDEN_PHRASE_MARKERS.flags);
  while ((match = re.exec(contextText)) !== null) {
    const phrase = match[1]?.trim();
    if (phrase && phrase.length >= 3) found.push(phrase);
  }
  return found;
}

/** Combina extração + checagem: quais frases proibidas do contexto sobreviveram na resposta. */
export function detectForbiddenLanguage(answer: string, contextText: string): string[] {
  const phrases = extractForbiddenPhrases(contextText);
  return phrases.filter((phrase) => containsForbiddenPhrase(answer, phrase));
}

// ---------------------------------------------------------------------------
// CONFORMIDADE DE INSTRUÇÃO EXPLÍCITA (Otto Senior V1, Section 6-7 —
// "Feedback Rewrite Contract"). Achado ao vivo: feedback pedia DUAS coisas
// ("tira o clichê" E "tira o colchete de placeholder"), o modelo aplicou
// só uma. Sem verificação determinística, o sistema não tinha como saber
// que uma instrução explícita foi ignorada — dependia só do modelo dizer
// que fez.
// ---------------------------------------------------------------------------

export interface RequestedRemoval {
  /** O texto/expressão que o feedback pediu pra remover, como foi escrito. */
  target: string;
}

export interface RemovalVerification extends RequestedRemoval {
  /** true = o alvo não aparece mais (nem variação morfológica óbvia) no texto final. */
  applied: boolean;
}

/**
 * "tira X", "remove X", "tire o Y" — instruções de REMOÇÃO explícita
 * dentro de um texto de feedback. Só cobre remoção (o caso concreto
 * achado ao vivo); outras operações de feedback (adicionar, trocar tom)
 * ficam com o critic/julgamento humano, que já existem — replicar aqui
 * viraria o "motor de NLP geral" que a missão pede pra não construir.
 */
const REMOVAL_INSTRUCTION_PATTERN =
  /\b(?:tira|tire|remove|remova)\s+(?:o|a|os|as)?\s*([^,.;\n]{3,60}?)(?=\s+e\s+(?:tira|tire|remove|remova)\b|[,.;\n]|$)/gi;

export function extractRequestedRemovals(feedbackText: string): RequestedRemoval[] {
  const found: RequestedRemoval[] = [];
  const re = new RegExp(REMOVAL_INSTRUCTION_PATTERN.source, REMOVAL_INSTRUCTION_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(feedbackText)) !== null) {
    const target = match[1]?.trim();
    if (target) found.push({ target });
  }
  return found;
}

/**
 * Verifica cada remoção pedida contra o texto FINAL — reusa a mesma
 * checagem morfológica de `containsForbiddenPhrase` (mesmo problema: "o
 * alvo pedido ainda está aí, com variação óbvia de forma"). Se o alvo tem
 * uma frase entre aspas dentro dele (ex.: "o clichê de 'sonho
 * realizado'"), usa só o trecho entre aspas — mais preciso que o trecho
 * inteiro, que carrega palavras de enquadramento ("o clichê de").
 */
export function verifyRequestedRemovals(finalAnswer: string, removals: RequestedRemoval[]): RemovalVerification[] {
  return removals.map((removal) => {
    const quoted = /[""']([^"""']{2,60})[""']/.exec(removal.target);
    const effectiveTarget = quoted?.[1] ?? removal.target;
    const stillPresent = containsForbiddenPhrase(finalAnswer, effectiveTarget);
    return { ...removal, applied: !stillPresent };
  });
}
