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
  /**
   * Todas as leituras possíveis do nome na frase, da mais específica para a
   * menos. `clientName` é a primeira delas, mantida para quem só quer uma.
   *
   * Existe porque regex nenhuma decide entre "Cliente Teste 7" e "Teste 7" sem
   * saber quem existe na carteira — e quem sabe isso é o resolvedor, não o
   * extrator. Ele tenta uma por uma e fica com a que for empresa de verdade.
   */
  clientNameCandidates: string[];
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

/**
 * ONDE O NOME ACABA E A FRASE COMEÇA.
 *
 * MEDIDO EM 01/10/2026, contra o sistema rodando: "Anota que o decisor do
 * Cliente Teste 7 é a Marina." não gravou nada. O turno completou em 10
 * segundos, o extrator rodou, e o nome que ele devolveu foi
 * `"Teste 7 é a Marina"` — a frase inteira até o ponto final.
 *
 * A causa: os padrões de "cliente X" capturam preguiçosamente até pontuação,
 * e numa frase de uma oração só a primeira pontuação é o ponto do fim. Com
 * nome de UMA palavra ("da Colormaq é a Marina") o padrão de palavras
 * capitalizadas salvava o caso; com nome de duas ou mais, não.
 *
 * E O MODO DE FALHAR É O PIOR POSSÍVEL: nome que não resolve na carteira é
 * descartado de propósito (gravar por aproximação envenenaria o dossiê), então
 * o fato sumia CALADO. Quem ensinou não recebe erro, e descobre semanas depois
 * que o agente nunca soube. Vinte e nove dos quarenta e nove clientes da
 * carteira têm nome de duas palavras ou mais.
 *
 * O corte abaixo é por VERBO e por ADVÉRBIO, nunca por palavra minúscula
 * qualquer: "Casa de Carnes" e "D. Carvalho" têm minúscula no meio e são nomes
 * legítimos. O que nenhum nome de empresa tem é um verbo de ligação.
 *
 * O limite usa `(?![\wÀ-ÿ])` e NÃO `\b`, e isso não é preciosismo: em
 * JavaScript `\b` é fronteira ASCII, então `é\b` nunca casa — `é` não conta
 * como caractere de palavra, e entre ele e o espaço seguinte não há transição
 * nenhuma. A primeira versão desta correção falhou exatamente por isso, e
 * falhou em silêncio: a regex simplesmente não encontrava nada.
 */
const CONECTOR_QUE_ENCERRA_NOME =
  /\s+(?:é|eh|são|sao|está|esta|estão|estao|fica|ficou|ficam|passa|passou|virou|vira|tem|têm|teve|deve|usa|usam|prefere|preferem|atende|atendem|mudou|muda|agora|não|nao|pode|podem|precisa|quer)(?![\wÀ-ÿ])/i;

function cortarNoConector(nome: string): string {
  const corte = CONECTOR_QUE_ENCERRA_NOME.exec(nome);
  return corte ? nome.slice(0, corte.index).trim() : nome;
}

/**
 * TODOS OS CANDIDATOS, não o primeiro que casar — e quem decide é a carteira.
 *
 * O primeiro padrão a casar nem sempre é o certo. "Anota que o decisor do
 * Cliente Teste 7 é a Marina": o padrão de `cliente X` devolve "Teste 7",
 * porque trata "cliente" como substantivo comum; o de palavras capitalizadas
 * devolve "Cliente Teste 7", que é o nome real. Os dois são leituras honestas
 * da frase, e nenhuma regex decide entre elas sem saber quem existe.
 *
 * Quem sabe é a carteira. Então aqui saem os candidatos, do mais específico
 * (mais longo) ao menos, e o resolvedor fica com o primeiro que for uma empresa
 * de verdade. A regra que não muda: nenhum resolveu, nada é gravado — jamais
 * por aproximação.
 */
function acharClientesCitados(texto: string): string[] {
  const vistos = new Set<string>();
  for (const re of CLIENTE_PADROES) {
    const m = re.exec(texto);
    if (!m?.[1]) continue;
    const nome = cortarNoConector(m[1].trim().replace(/\s+/g, ' '));
    if (nome.length >= 2) vistos.add(nome);
  }
  return [...vistos].sort((a, b) => b.length - a.length);
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

    const candidatos = acharClientesCitados(frase);
    const clientName = candidatos[0] ?? null;
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

    fatos.push({ clientName, clientNameCandidates: candidatos, aspect, value, source: frase.slice(0, 400) });
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
