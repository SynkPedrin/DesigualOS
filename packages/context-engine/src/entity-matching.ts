/**
 * entity-matching.ts — como o nome que a PESSOA fala encontra a entidade que a
 * FONTE registrou.
 *
 * Caso real (16/09/2026): a Tammy pediu conteúdo para a "campanha de aniversário
 * do Jardim Europa 5". A campanha existe, com 253 tasks, mas a fonte a escreve
 * "Europa V" no nome da task e "Jardim Europa V" na descrição. Nenhuma dessas
 * formas casa com "Jardim Europa 5" por igualdade de string, e o texto acabou
 * caindo no matcher de CLIENTE, que casou pela palavra solta "jardim" e entregou
 * a campanha de outro cliente (Jardim do Lago).
 *
 * Duas regras nascem daí, e valem para qualquer entidade nomeada:
 *
 * 1. NUMERAL É A MESMA COISA. "V" e "5" são o mesmo empreendimento. A operação
 *    escreve em romano, a pessoa fala em arábico, e nenhum dos dois está errado.
 *
 * 2. PALAVRA SOLTA NÃO BASTA quando o texto a estende. "jardim" casar
 *    "Jardim do Lago" dentro da frase "Jardim Europa 5" é o matcher ignorando a
 *    palavra que vinha logo depois, que era justamente a que diferenciava.
 */

/** Tira acento, emoji, pontuação e caixa. Mesma dobra para fonte e para texto. */
export function dobrar(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[™®]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ROMANO_PARA_ARABICO: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8',
  ix: '9', x: '10', xi: '11', xii: '12',
};
const ARABICO_PARA_ROMANO: Record<string, string> = Object.fromEntries(
  Object.entries(ROMANO_PARA_ARABICO).map(([r, a]) => [a, r]),
);

/**
 * Todas as formas de escrever o mesmo nome trocando numeral romano por arábico e
 * vice-versa. "europa v" -> ["europa v", "europa 5"]; "ibiza 2" -> ["ibiza 2",
 * "ibiza ii"]. Só converte TOKEN INTEIRO: "vi" dentro de "vila" não é numeral.
 */
export function variantesDeNumeral(nome: string): string[] {
  const tokens = dobrar(nome).split(' ').filter(Boolean);
  if (tokens.length === 0) return [];

  const posicoes = tokens
    .map((t, i) => ({ i, t }))
    .filter(({ t }) => ROMANO_PARA_ARABICO[t] !== undefined || ARABICO_PARA_ROMANO[t] !== undefined);
  if (posicoes.length === 0) return [tokens.join(' ')];

  // Um nome raramente tem mais de um numeral; ainda assim geramos o produto das
  // trocas, que para 1-2 posições é trivial e evita caso especial.
  let formas = [tokens];
  for (const { i, t } of posicoes) {
    const alternativa = ROMANO_PARA_ARABICO[t] ?? ARABICO_PARA_ROMANO[t]!;
    formas = formas.flatMap((f) => {
      const outra = [...f];
      outra[i] = alternativa;
      return [f, outra];
    });
  }
  return [...new Set(formas.map((f) => f.join(' ')))];
}

/**
 * Palavra que, sozinha, não identifica entidade nenhuma: termo de negócio que
 * aparece no nome de dezenas de campanhas e clientes. Serve para as duas
 * camadas (cliente e campanha) — a regra é a mesma, o dano é o mesmo.
 */
export const PALAVRA_FRACA = new Set([
  'campanha', 'campanhas', 'digitais', 'digital', 'video', 'videos', 'motion',
  'layout', 'layouts', 'conteudo', 'conteudos', 'texto', 'textos', 'edicao',
  'edicoes', 'apresentacao', 'aniversario', 'institucional', 'redes', 'sociais',
  'site', 'lancamento', 'geral', 'novo', 'nova', 'fase', 'material', 'materiais',
  'card', 'cards', 'post', 'posts', 'stories', 'reels', 'banner', 'cartaz',
  'jardim', 'residencial', 'condominio', 'parque', 'vila', 'centro', 'clube',
  'construtora', 'imobiliaria', 'incorporadora', 'clinica', 'grupo', 'empresa',
  'projeto', 'urbanismo', 'consultoria', 'agencia', 'desigual', 'cliente',
  'teste', 'case', 'enterprise', 'brasil', 'comercio', 'industria', 'servicos',
]);

export interface EntidadeNomeada {
  id: string;
  canonicalName: string;
  /** Formas alternativas já conhecidas pela fonte (descrição, apelido do time). */
  aliases?: string[];
  /** Escopo dono da entidade. Campanha pertence a cliente; cliente não tem dono. */
  ownerId?: string | null;
}

export interface CasamentoDeEntidade<T extends EntidadeNomeada> {
  entidade: T;
  /** Forma que casou, já dobrada. */
  forma: string;
  /** Quantos tokens a forma tem. Mais tokens = casamento mais específico. */
  tokens: number;
  /** 'exact' quando a forma casou inteira; 'numeral' quando exigiu troca de numeral. */
  via: 'exact' | 'numeral';
}

/** Todas as formas de busca de uma entidade: canônica, aliases, e numerais de ambos. */
export function formasDe(entidade: EntidadeNomeada): Array<{ forma: string; via: 'exact' | 'numeral' }> {
  const saida = new Map<string, 'exact' | 'numeral'>();
  const base = [entidade.canonicalName, ...(entidade.aliases ?? [])];
  for (const nome of base) {
    const dobrado = dobrar(nome);
    if (dobrado.length === 0) continue;
    saida.set(dobrado, 'exact');
    for (const v of variantesDeNumeral(nome)) {
      if (!saida.has(v)) saida.set(v, 'numeral');
    }
  }
  return [...saida.entries()].map(([forma, via]) => ({ forma, via }));
}

/** A forma aparece como sequência de tokens inteiros dentro do texto dobrado? */
function contemFrase(textoTokens: string[], forma: string): number {
  const alvo = forma.split(' ').filter(Boolean);
  if (alvo.length === 0) return -1;
  for (let i = 0; i + alvo.length <= textoTokens.length; i += 1) {
    let bate = true;
    for (let j = 0; j < alvo.length; j += 1) {
      if (textoTokens[i + j] !== alvo[j]) { bate = false; break; }
    }
    if (bate) return i;
  }
  return -1;
}

/**
 * Casa entidades citadas no texto. Devolve TODAS as que casaram, ordenadas da
 * mais específica (mais tokens) para a menos.
 *
 * A regra que impede o sequestro: uma forma de UM TOKEN só vale se
 * (a) o token não é palavra fraca, E
 * (b) o texto não o estende — se logo depois vem outro token que a entidade não
 *     tem, o texto está falando de outra coisa. É literalmente o caso
 *     "jardim" + "europa" contra o cliente "jardim do lago".
 */
export function casarEntidades<T extends EntidadeNomeada>(
  texto: string,
  entidades: T[],
): Array<CasamentoDeEntidade<T>> {
  const tokens = dobrar(texto).split(' ').filter(Boolean);
  if (tokens.length === 0) return [];

  const achados: Array<CasamentoDeEntidade<T>> = [];
  for (const entidade of entidades) {
    let melhor: CasamentoDeEntidade<T> | null = null;
    for (const { forma, via } of formasDe(entidade)) {
      const at = contemFrase(tokens, forma);
      if (at === -1) continue;
      const nTokens = forma.split(' ').length;

      if (nTokens === 1) {
        if (PALAVRA_FRACA.has(forma)) continue;
        // Token seguinte no texto que a entidade não possui => o texto nomeia
        // outra entidade que apenas começa igual.
        const proximo = tokens[at + 1];
        if (proximo && proximo.length >= 3) {
          const formasDaEntidade = formasDe(entidade).map((f) => f.forma).join(' ');
          if (!formasDaEntidade.split(' ').includes(proximo)) continue;
        }
      }

      if (!melhor || nTokens > melhor.tokens) melhor = { entidade, forma, tokens: nTokens, via };
    }
    if (melhor) achados.push(melhor);
  }

  return achados.sort((a, b) => b.tokens - a.tokens || a.entidade.canonicalName.localeCompare(b.entidade.canonicalName));
}

export interface ResolucaoDeEntidade<T extends EntidadeNomeada> {
  /** Única vencedora, ou null quando nada casou ou quando há empate real. */
  resolvida: T | null;
  /** Empate de especificidade: o chamador deve PERGUNTAR, nunca escolher. */
  ambiguas: T[];
  /**
   * Casou, mas pertence a OUTRO dono que não o escopo do turno. Nunca entra em
   * `resolvida`: usar a campanha de outro cliente como se fosse do cliente atual
   * e vazamento entre contas sao a mesma coisa. Fica visivel para o chamador
   * poder dizer "essa campanha e do cliente X" em vez de calar ou de inventar.
   */
  foraDoEscopo: T[];
  todas: Array<CasamentoDeEntidade<T>>;
}

/**
 * Resolve para UMA entidade. Vence o casamento mais específico; empate no topo
 * é ambiguidade declarada, não sorteio — foi o sorteio silencioso que entregou
 * a campanha do cliente errado.
 */
export function resolverEntidade<T extends EntidadeNomeada>(
  texto: string,
  entidades: T[],
  opcoes: { ownerId?: string | null } = {},
): ResolucaoDeEntidade<T> {
  const brutas = casarEntidades(texto, entidades);
  let todas = brutas;
  let foraDoEscopo: T[] = [];

  // Escopo conhecido (cliente do turno) desempata antes de qualquer pergunta —
  // e, quando o que casou e de outro dono, NAO resolve: reporta.
  if (opcoes.ownerId) {
    todas = brutas.filter((m) => m.entidade.ownerId === opcoes.ownerId);
    foraDoEscopo = brutas.filter((m) => m.entidade.ownerId !== opcoes.ownerId).map((m) => m.entidade);
  }
  if (todas.length === 0) return { resolvida: null, ambiguas: [], foraDoEscopo, todas: brutas };

  const topo = todas[0]!.tokens;
  const empatadas = todas.filter((m) => m.tokens === topo);
  if (empatadas.length > 1) {
    return { resolvida: null, ambiguas: empatadas.map((m) => m.entidade), foraDoEscopo, todas };
  }
  return { resolvida: todas[0]!.entidade, ambiguas: [], foraDoEscopo, todas };
}
