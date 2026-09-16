/**
 * client-knowledge-extraction.ts — transforma o que a equipe CONTA sobre um
 * cliente em conhecimento durável do cliente.
 *
 * O buraco que isto fecha: o dossiê e o brain entram no sistema por importação
 * (sync-brains / sync-dossies) e ficam CONGELADOS até alguém reimportar. Todo
 * dossiê tem seção de lacuna — "público-alvo a coletar", "decisor a coletar" —
 * e a lacuna é preenchida em conversa, não em arquivo. Sem isto, a operação
 * responde a mesma pergunta toda semana e o agente nunca aprende.
 *
 * DETERMINÍSTICO e de intenção EXPLÍCITA, pela mesma razão que a extração de
 * preferência é (ver preference-extraction.ts) e por uma razão mais forte:
 * dossiê errado é pior que dossiê vazio. Todo o resto do sistema existe pra
 * impedir o agente de inventar dado de cliente; deduzir "fato" de frase casual
 * seria a mesma invenção entrando pela porta dos fundos, com carimbo de
 * verdade. Por isso só vira conhecimento o que vem com verbo de registro
 * ("anota que", "registra que", "atualiza o brain"). Na dúvida, NÃO salva.
 */

export interface ExtractedClientFact {
  /** Nome do cliente como foi falado; o caller resolve pro id real. */
  clientName: string | null;
  /** Aspecto que o fato governa. Aspecto nomeado supersede o anterior. */
  aspect: string;
  /** O fato, já limpo do enunciado de registro. */
  value: string;
  /** Frase original, pra auditoria. */
  source: string;
}

/**
 * Verbo de REGISTRO. É o portão: sem um destes, nada vira conhecimento, por
 * mais que a frase pareça um fato. Contar algo de passagem não é pedir pra
 * gravar, e gravar o que não foi pedido envenena o dossiê em silêncio.
 */
const VERBO_REGISTRO =
  /\b(anot[ae]|anota[r]?|registr[ae]|registrar|guard[ae]|guardar|grav[ae]|gravar|atualiz[ae]|atualizar|corrig[ei]|corrigir|lembr[ae]|lembrar|fica registrado|para constar|fica[r]? valendo|toma nota)\b/i;

/** Marcador de locutor do historico: "- Usuario:", "Assistente:", "Bento:". */
const LOCUTOR = /^\s*[-*\u2022]?\s*(?:usu[\u00e1a]rio|assistente|agente|bento|otto|user|assistant)\s*:\s*/i;

/** Aspecto -> termos que o denunciam. O primeiro que casar vence. */
const ASPECTOS: Array<{ aspect: string; re: RegExp }> = [
  { aspect: 'decisor', re: /\bdecisor\b|\bquem aprova\b|\baprovador\b|\bquem decide\b|\bpalavra final\b/i },
  { aspect: 'contato', re: /\bcontato\b|\be-?mail\b|\btelefone\b|\bwhats(app)?\b/i },
  { aspect: 'publico', re: /\bp[úu]blico\b|\bpersonas?\b|\baudi[êe]ncia\b|\bquem compra\b/i },
  { aspect: 'ramo', re: /\bramo\b|\bsegmento\b|\bsetor\b|\bfabrica\b|\batua (com|em|no|na)\b/i },
  { aspect: 'produto', re: /\bprodutos?\b|\blinhas?\b|\bcarro-?chefe\b|\bservi[çc]os?\b/i },
  { aspect: 'praca', re: /\bpra[çc]a\b|\bregi[ãa]o\b|\bcidades?\b|\batende em\b|\bfilial\b/i },
  { aspect: 'concorrente', re: /\bconcorrentes?\b|\brival\b/i },
  { aspect: 'canal', re: /\binstagram\b|\bcanal\b|\bcanais\b|\bperfil\b|\bsite\b/i },
  { aspect: 'restricao', re: /\bn[ãa]o pode\b|\bproibid[oa]\b|\brestri[çc][ãa]o\b|\bregulament/i },
  { aspect: 'posicionamento', re: /\bposicionamento\b|\bpromessa\b|\bdiferencial\b|\bo que vende\b/i },
  { aspect: 'contrato', re: /\bcontrato\b|\bescopo\b|\bretainer\b|\bpacote\b|\bverba\b/i },
];

/** "do cliente X", "da D. Carvalho", "no brain da Yak" — o nome citado. */
const CLIENTE_PADROES: RegExp[] = [
  /\b(?:no|na)\s+(?:brain|dossi[êe]|ficha)\s+d[oa]\s+([^,.;:]{2,60}?)(?=\s*[,.;:]|\s+que\b|$)/i,
  /\bd[oa]\s+cliente\s+([^,.;:]{2,60}?)(?=\s*[,.;:]|\s+que\b|$)/i,
  /\bcliente\s+([^,.;:]{2,60}?)(?=\s*[,.;:]|\s+que\b|$)/i,
  /\bpara\s+(?:o|a)\s+([A-ZÀ-Ý][^,.;:]{1,60}?)(?=\s*[,.;:]|\s+que\b|$)/,
  // "o decisor da Colormaq e a Marina" — a forma mais natural de todas, e a que
  // faltava: ninguem escreve "do cliente Colormaq" no dia a dia. Exige inicial
  // maiuscula pra nao capturar "da empresa"/"da conta"; nome que nao resolver
  // na carteira faz o fato ser descartado, nunca gravado por aproximacao.
  /\bd[oa]\s+([A-ZÀ-Ý][\wÀ-ÿ.'-]*(?:\s+[A-ZÀ-Ý0-9][\wÀ-ÿ.'-]*){0,4})/,
];

function acharClienteCitado(texto: string): string | null {
  for (const re of CLIENTE_PADROES) {
    const m = re.exec(texto);
    if (m?.[1]) {
      const nome = m[1].trim().replace(/\s+/g, ' ');
      if (nome.length >= 2) return nome;
    }
  }
  return null;
}

function aspectoDe(texto: string): string {
  for (const a of ASPECTOS) if (a.re.test(texto)) return a.aspect;
  return 'geral';
}

/** Limpa o enunciado de registro, deixando só o fato. */
function limparEnunciado(frase: string): string {
  return frase
    .replace(VERBO_REGISTRO, ' ')
    .replace(/\b(a[ií]|l[áa]|isso|isto|ent[ãa]o|por favor|pfv|pra mim|pro? (brain|dossi[êe]|ficha))\b/gi, ' ')
    .replace(/^\s*(que|:|,|-|que\s+)/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,:;\-\s]+/, '')
    .trim();
}

/**
 * Extrai fatos duráveis de cliente de uma mensagem. Devolve vazio quando não há
 * intenção explícita de registro — que é o caso da esmagadora maioria dos
 * turnos, e é o resultado correto.
 */
export function extractClientFacts(message: string): ExtractedClientFact[] {
  if (!message || message.trim().length === 0) return [];

  // Quebra de frase CIENTE DE ABREVIACAO. O splitter ingenuo partia
  // "da D. Carvalho" ao meio no ponto da abreviacao, e o fato chegava a
  // extracao sem o nome do cliente — justamente nos clientes cujo nome carrega
  // abreviacao (D. Carvalho, Dra. Thais Bertelli).
  const frases = message
    .split(/(?<!\b[A-ZÀ-Ý]\.)(?<!\b(?:Sr|Sra|Dr|Dra|Ltda|Cia|Av|Jr|St|Prof)\.)(?<=[.!?\n])\s+|\n+/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  const fatos: ExtractedClientFact[] = [];
  const vistos = new Set<string>();
  const porAspecto = new Set<string>();

  for (const bruta of frases) {
    // A mensagem que chega ao turno carrega o historico formatado, entao a
    // MESMA frase aparece duas vezes: solta e como "- Usuario: <frase>". Sem
    // tirar o marcador, as duas viravam fato do mesmo aspecto e a versao suja
    // (com o prefixo colado no conteudo) aposentava a limpa. Medido ao vivo.
    const frase = bruta.replace(LOCUTOR, '').trim();
    if (frase.length === 0) continue;
    // Pergunta não é registro: "anota quem é o decisor?" está PEDINDO o dado,
    // não entregando. Gravar a pergunta como fato seria gravar a lacuna.
    if (frase.trimEnd().endsWith('?')) continue;
    if (!VERBO_REGISTRO.test(frase)) continue;

    const value = limparEnunciado(frase);
    // Curto demais depois de limpar = só o enunciado, sem fato dentro.
    if (value.length < 12) continue;

    const clientName = acharClienteCitado(frase);
    const aspect = aspectoDe(frase);
    const chave = `${clientName ?? ''}|${aspect}|${value.toLowerCase()}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    // UM fato por (cliente, aspecto) por mensagem. Dois fatos do mesmo aspecto
    // na mesma mensagem sao a mesma coisa dita duas vezes (eco do historico,
    // reformulacao); gravar os dois faria um supersedir o outro em silencio,
    // e quem vence seria o ultimo, nao o melhor.
    const chaveAspecto = `${clientName ?? ''}|${aspect}`;
    if (porAspecto.has(chaveAspecto)) continue;
    porAspecto.add(chaveAspecto);

    fatos.push({ clientName, aspect, value, source: frase.slice(0, 400) });
  }

  return fatos;
}

/**
 * Subject do fato. Aspecto NOMEADO supersede o anterior (corrigir o decisor
 * aposenta o decisor antigo). Aspecto 'geral' carrega um sufixo derivado do
 * próprio fato, senão cada fato novo apagaria o anterior — e perder
 * conhecimento silenciosamente é o oposto do que este módulo existe pra fazer.
 */
export function clientFactSubject(clientId: string, fact: ExtractedClientFact): string {
  if (fact.aspect !== 'geral') return `cliente:${clientId}:aprendizado:${fact.aspect}`;
  const slug = fact.value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
  return `cliente:${clientId}:aprendizado:geral:${slug}`;
}
