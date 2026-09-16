/**
 * preference-extraction.ts — transforma instrução do usuário em MEMÓRIA
 * SEMÂNTICA durável.
 *
 * O buraco que isto fecha: uma conversa só produzia `agent.episode` (objetivo
 * + estratégia vencedora). Ensinar "para o Cliente X, prefira headlines curtas
 * e sem emojis" não virava preferência nenhuma — a sessão seguinte devolvia
 * headline com emoji (medido ao vivo no release gate, 15/09/2026).
 *
 * DETERMINÍSTICO de propósito. Preferência de cliente é regra que vai moldar
 * toda peça futura: se um modelo "interpretar" errado uma frase casual, o erro
 * se propaga por meses. Aqui só vira memória o que tem forma explícita de
 * instrução, com o cliente nomeado. O resto NÃO é salvo — e não salvar é o
 * comportamento correto na dúvida.
 *
 * A supersessão sai de graça: o `subject` identifica o ASPECTO
 * (`cliente:<id>:headline`), e o memory-engine aposenta o fato anterior do
 * mesmo subject. Duas verdades sobre headline do mesmo cliente não coexistem.
 */

export type PreferenceScopeKind = 'client' | 'user';

export interface ExtractedPreference {
  scope: PreferenceScopeKind;
  /** Nome do cliente como foi falado (o caller resolve pro id real). */
  clientName: string | null;
  /** Aspecto que a preferência governa — vira parte do subject. */
  aspect: string;
  /** A regra, já limpa do enunciado ("prefira", "use", "para o cliente X,"). */
  value: string;
  /** Frase original, pra auditoria. */
  source: string;
}

/** Aspecto -> termos que o denunciam. Ordem importa: o primeiro que casar vence. */
/**
 * Exportado para a consolidação diária: agrupar episódio por ASPECTO é o que
 * separa "recorrência real" de "três feedbacks quaisquer". Dois pedidos sobre
 * headline são o mesmo assunto; um sobre headline e um sobre paleta não são,
 * por mais que ambos sejam feedback.
 */
export const ASPECTOS: Array<{ aspect: string; re: RegExp }> = [
  { aspect: 'headline', re: /\bheadlines?\b|\bt[íi]tulos?\b|\bchamadas?\b/i },
  { aspect: 'emoji', re: /\bemojis?\b/i },
  { aspect: 'tom-de-voz', re: /\btom de voz\b|\btom\b|\blinguagem\b|\bvoz da marca\b/i },
  { aspect: 'cta', re: /\bcta\b|\bchamada para a[çc][ãa]o\b/i },
  { aspect: 'legenda', re: /\blegendas?\b|\bcaptions?\b/i },
  { aspect: 'paleta', re: /\bpaletas?\b|\bcores?\b/i },
  { aspect: 'tipografia', re: /\btipografias?\b|\bfontes?\b/i },
  { aspect: 'formato', re: /\bformatos?\b|\bcarross[eé]is?\b|\bcarrossel\b|\breels\b|\bstories\b/i },
  { aspect: 'hashtag', re: /\bhashtags?\b/i },
];

/**
 * Verbos que marcam INSTRUÇÃO DURÁVEL. "gostei disso" não entra: elogio a uma
 * peça não é regra permanente, e tratar como regra é como memória vira ruído.
 */
const VERBO_INSTRUCAO =
  /\b(prefir[ao]|prefere|use|usar|utilize|evite|evitar|nunca use|nunca|sempre|n[ãa]o use|n[ãa]o usar|pode usar|passa a usar|adote|adotar|mantenha|priorize)\b/i;

/** "para o Cliente X," / "do cliente X:" / "Cliente X agora prefere" */
const CLIENTE_PREFIXO = /\bpara\s+(?:o\s+|a\s+)?cliente\s+([^,.;:]{2,60})\s*[,:;]/i;
const CLIENTE_SUJEITO = /\bcliente\s+([^,.;:]{2,60}?)\s+(?:agora\s+)?(?:prefere|quer|passa a|adota|usa)\b/i;
const CLIENTE_DO = /\b(?:d[oa]\s+)?cliente\s+([^,.;:]{2,60})\s*[,:;]/i;

function acharCliente(texto: string): { nome: string; resto: string } | null {
  for (const re of [CLIENTE_PREFIXO, CLIENTE_SUJEITO, CLIENTE_DO]) {
    const m = re.exec(texto);
    if (m?.[1]) {
      const nome = m[1].trim();
      const resto = (texto.slice(0, m.index) + texto.slice(m.index + m[0].length)).trim();
      return { nome, resto: resto || texto };
    }
  }
  return null;
}

function acharAspecto(texto: string): string | null {
  for (const { aspect, re } of ASPECTOS) if (re.test(texto)) return aspect;
  return null;
}

/** Tira o enunciado e deixa a regra: "prefira headlines curtas" -> "headlines curtas". */
function limparValor(texto: string): string {
  return texto
    .replace(/^\s*(e\s+)?(que\s+)?/i, '')
    .replace(/\b(por favor|pf|ok)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;:\-\s]+/, '')
    .replace(/[.\s]+$/, '')
    .trim();
}

const GUARDA_MEMORIA = /\b(guarde|lembre|memoriz|anote|registre)\b/i;

/**
 * Extrai preferências duráveis de UMA mensagem do usuário.
 *
 * Devolve lista vazia quando a frase não é instrução explícita — que é o caso
 * da esmagadora maioria das mensagens. Não salvar é o default.
 */
export function extractPreferences(message: string): ExtractedPreference[] {
  const texto = (message.split(/\n\s*\n/)[0] ?? message).trim();
  if (texto.length < 12 || texto.length > 400) return [];
  if (!VERBO_INSTRUCAO.test(texto)) return [];

  const cliente = acharCliente(texto);
  const aspecto = acharAspecto(texto);
  if (!aspecto) return [];

  // Sem cliente nomeado, só vira preferência se a pessoa pediu pra guardar —
  // senão "use headlines curtas" num pedido pontual viraria regra eterna.
  if (!cliente && !GUARDA_MEMORIA.test(texto)) return [];

  const base = cliente ? cliente.resto : texto;
  const valor = limparValor(base);
  if (valor.length < 3) return [];

  return [
    {
      scope: cliente ? 'client' : 'user',
      clientName: cliente?.nome ?? null,
      aspect: aspecto,
      value: valor,
      source: texto,
    },
  ];
}

/** Identidade do FATO: mesmo cliente + mesmo aspecto = mesma verdade. */
export function preferenceSubject(scopeId: string, aspect: string, scope: PreferenceScopeKind = 'client'): string {
  return `${scope === 'client' ? 'cliente' : 'usuario'}:${scopeId}:${aspect}`;
}

/** Texto que vai pro prompt e pra evidência. Curto e acionável. */
export function preferenceContent(pref: ExtractedPreference): string {
  return `Preferência de ${pref.aspect}: ${pref.value}`;
}

/** Aspecto de um texto livre, usando a MESMA tabela da extração. */
export function aspectoDoTexto(texto: string): string | null {
  return ASPECTOS.find((a) => a.re.test(texto))?.aspect ?? null;
}
