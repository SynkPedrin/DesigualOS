/**
 * action-intent-v2.ts — ENTENDER O PEDIDO ANTES DE AGIR.
 *
 * A V1 respondia a uma pergunta só: "existe verbo de ação no texto?". Isso
 * resolve o caso fácil e erra os dois caros, em direções opostas:
 *
 *   - "bota essa no Gui"  -> não agia (verbo fora da lista)
 *   - "não cria ainda"    -> AGIA (achava o verbo e ignorava o "não")
 *
 * O segundo é o grave, e estava em produção: medido no corpus versionado,
 * quatro construções de negação/hipótese autorizavam escrita. Nenhuma delas
 * tinha teste, porque a V1 nunca foi medida contra adversariais.
 *
 * A V2 troca "procurar verbo" por LER A FRASE, em quatro passos:
 *
 *   SEGMENTAR   — a mensagem vira trechos; citação e lista são marcadas.
 *   CLASSIFICAR — cada trecho é julgado sozinho, com seus próprios sinais.
 *   CONSOLIDAR  — o turno é ACT se ALGUM trecho ordena e NENHUM proíbe.
 *   AUTORIZAR   — só ACT com confiança escreve; AMBIGUOUS nunca escreve.
 *
 * A assimetria é de propósito, e é a regra da casa: não agir custa uma frase
 * repetida; agir sem ordem custa uma task errada na conta de um cliente e a
 * confiança de quem depende do sistema. Na dúvida, o Bento pergunta.
 */

export type IntentV2 = 'ACT' | 'ANALYZE' | 'AMBIGUOUS';

export interface SegmentSignals {
  /** Famílias de ação encontradas: create, route, update. */
  families: string[];
  /** Este trecho PROÍBE a ação (negação, restrição). */
  negations: string[];
  /** Este trecho não é executável: citação, passado, hipótese, pergunta. */
  blockers: string[];
  /** Objeto/alvo operacional presente (task, demanda, layout, pessoa, lista). */
  hasTarget: boolean;
  /** Verbo em forma de ORDEM (imperativo/presente), não infinitivo nem passado. */
  imperative: boolean;
}

export interface Segment {
  text: string;
  index: number;
  kind: 'normal' | 'quote' | 'list_item';
  signals: SegmentSignals;
  /** Trecho ordena uma escrita, por si só. */
  acts: boolean;
}

export interface ActionIntentV2 {
  intent: IntentV2;
  writeAuthorized: boolean;
  confidence: number;
  /** O trecho EXATO que carrega a ordem — é o que torna a decisão auditável. */
  sourceSpan: string | null;
  signals: string[];
  negations: string[];
  segments: Segment[];
}

/* ------------------------------------------------------------------ */
/* NORMALIZAÇÃO                                                        */
/* ------------------------------------------------------------------ */

/**
 * Três formas do mesmo texto, montadas uma vez.
 *
 * `normalized` tira acento e caixa — é onde as regras casam. O texto ORIGINAL
 * continua disponível porque a maiúscula é sinal: "pro Gui" é pessoa, "pra
 * frente" não. E `tokens` existe pra regra que precisa de palavra INTEIRA:
 * era por prefixo que "criação" virava "cria" e um substantivo abstrato
 * disparava escrita.
 */
export interface TextForms {
  original: string;
  normalized: string;
  tokens: string[];
}

export function formsOf(text: string): TextForms {
  const normalized = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return { original: text, normalized, tokens: normalized.split(/[^a-z0-9]+/).filter(Boolean) };
}

/** A palavra aparece INTEIRA? (não como prefixo de outra) */
function hasToken(f: TextForms, ...palavras: string[]): boolean {
  return palavras.some((p) => f.tokens.includes(p));
}

/**
 * Substantivo não é imperativo, e quem desambigua é o determinante.
 *
 * Medido no aceite pelo frontend (18/09/2026): a solicitação real da cliente
 * "...seguindo o padrão visual da marca" foi classificada como ORDEM DE
 * ESCRITA, porque "marca" está na família update ("marca isso pro Gui"). Mas
 * "da marca" fala DA MARCA — artigo antes vira nome, não verbo. O mesmo vale
 * pra "a troca de óleo" (substantivo) contra "troca o título" (ordem).
 *
 * Sem esse filtro a solicitação da cliente era descartada como material e a
 * conversa em volta virava conteúdo da task — foi assim que nasceram tasks
 * chamadas "Criar Bento, não cria nada ainda, só analisa...".
 */
const SUBSTANTIVO_AMBIGUO = new Set(['marca', 'troca']);
const DETERMINANTE = new Set([
  'a', 'o', 'da', 'do', 'na', 'no', 'uma', 'um',
  'essa', 'esse', 'esta', 'este', 'nossa', 'nosso', 'sua', 'seu', 'minha', 'meu',
]);

/** Tokens válidos pra casar FORMAS DE ORDEM: substantivo com artigo não ordena. */
function tokensDeOrdem(tokens: string[]): string[] {
  return tokens.filter((t, i) => !(SUBSTANTIVO_AMBIGUO.has(t) && i > 0 && DETERMINANTE.has(tokens[i - 1]!)));
}

/* ------------------------------------------------------------------ */
/* LÉXICO — famílias semânticas, não dezenas de regex soltas           */
/* ------------------------------------------------------------------ */

/**
 * Cada família é um conjunto de FORMAS DE ORDEM (imperativo/presente da 3ª
 * pessoa, que em português coincidem no uso falado) e as formas que NÃO são
 * ordem (infinitivo, particípio, passado). Separar as duas listas é o que
 * permite "cria" ordenar e "criar"/"criei" não.
 */
interface Familia {
  nome: string;
  /** Formas que, ditas a alguém, são ordem. */
  ordem: string[];
  /** Mesmo verbo sem força de ordem: infinitivo, gerúndio, passado. */
  naoOrdem: string[];
  /** A família precisa de objeto/alvo pra virar escrita? */
  exigeAlvo: boolean;
}

const FAMILIAS: Familia[] = [
  {
    nome: 'create',
    ordem: ['cria', 'crie', 'criem', 'abre', 'abra', 'adiciona', 'adicione', 'cadastra', 'cadastre', 'registra', 'registre', 'lanca', 'lance', 'lancem'],
    naoOrdem: ['criar', 'criando', 'criei', 'criou', 'criamos', 'criaram', 'criada', 'criado', 'criacao', 'abrir', 'abriu', 'abri', 'adicionar', 'adicionei', 'cadastrar', 'registrar', 'registrei', 'lancar', 'lancou', 'lancei', 'lancado'],
    // "cria isso" basta: o verbo de criação já é inequívoco.
    exigeAlvo: false,
  },
  {
    nome: 'route',
    ordem: ['separa', 'separe', 'passa', 'passe', 'manda', 'mande', 'joga', 'jogue', 'coloca', 'coloque', 'bota', 'bote', 'poe', 'ponha', 'deixa', 'deixe', 'divide', 'divida', 'quebra', 'quebre', 'distribui', 'distribua', 'encaminha', 'encaminhe', 'atribui', 'atribua', 'designa', 'designe', 'delega', 'delegue'],
    naoOrdem: ['separar', 'separou', 'separei', 'passar', 'passou', 'mandar', 'mandou', 'mandei', 'jogar', 'jogou', 'colocar', 'colocou', 'coloquei', 'botar', 'botou', 'por', 'deixar', 'deixou', 'dividir', 'dividiu', 'distribuir', 'encaminhar', 'encaminhando', 'atribuir', 'atribuiu', 'designar', 'delegar'],
    // "separa" sozinho é ambíguo demais; "separa essa demanda" não é.
    exigeAlvo: true,
  },
  {
    nome: 'update',
    ordem: ['muda', 'mude', 'altera', 'altere', 'atualiza', 'atualize', 'troca', 'troque', 'reagenda', 'reagende', 'renomeia', 'renomeie', 'comenta', 'comente', 'anexa', 'anexe', 'marca', 'marque'],
    naoOrdem: ['mudar', 'mudou', 'mudei', 'alterar', 'alterou', 'atualizar', 'atualizou', 'trocar', 'trocou', 'reagendar', 'renomear', 'comentar', 'comentou', 'anexar', 'anexou', 'marcar', 'marcou', 'marquei'],
    exigeAlvo: true,
  },
  {
    // AUTONOMIA: "organize a operação e resolva o que puder". Não é uma
    // escrita pontual, é um mandato — e o planner adaptativo tem um caminho
    // próprio pra ele. Sem esta família, o mandato virava conversa.
    nome: 'autonomous',
    ordem: ['organiza', 'organize', 'resolve', 'resolva', 'executa', 'execute', 'cuida', 'cuide'],
    naoOrdem: ['organizar', 'organizou', 'resolver', 'resolveu', 'executar', 'executou', 'cuidar'],
    exigeAlvo: true,
  },
  {
    nome: 'make',
    // "faz" é o verbo mais genérico do português falado: só vira ordem com
    // alvo operacional. "me faz uma análise" tem "faz" e não é escrita.
    ordem: ['faz', 'faca', 'faze', 'monta', 'monte'],
    naoOrdem: ['fazer', 'fez', 'fiz', 'fazendo', 'feito', 'montar', 'montou'],
    exigeAlvo: true,
  },
];

/** Alvo operacional: o que uma ordem de despacho pode estar tocando. */
const ALVO_OPERACIONAL = new Set([
  'task', 'tasks', 'tarefa', 'tarefas', 'demanda', 'demandas', 'card', 'cards',
  'briefing', 'brief', 'clickup', 'lista', 'listas', 'layout', 'layouts',
  'copy', 'texto', 'textos', 'arte', 'artes', 'peca', 'pecas', 'placa', 'placas',
  'video', 'videos', 'reels', 'stories', 'post', 'posts', 'carrossel',
  'campanha', 'entrega', 'entregas', 'roteiro', 'roteiros', 'legenda', 'legendas',
  'responsavel', 'prazo', 'descricao', 'comentario', 'anexo', 'status', 'subtask', 'checklist',
  // Escopo amplo: o que um mandato de autonomia toma conta.
  'operacao', 'fila', 'agenda', 'backlog', 'semana', 'dia', 'pendencias', 'pendencia',
]);

/**
 * Destino nomeado: "pro Gui", "pra Sofia", "na D Carvalho". Lido no texto COM
 * CAIXA — a maiúscula é o que separa nome próprio de preposição solta, e é o
 * que impede "passa pra frente" de virar despacho.
 */
const DESTINO_NOMEADO =
  /\b(?:pro|pra|para|ao|à|a|com|do|da|dos|das|n[ao]|em)\s+(?:o\s+|a\s+)?[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ](?:[a-záàâãéêíóôõúç]+|\.?\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)/;

/** Atribuição declarativa: "essa fica pra Sofia", "a demanda é do Matheus". */
const ATRIBUICAO_DECLARATIVA =
  /\b(?:essa|esse|esta|este|a demanda|a task|a tarefa|o layout|o texto|a arte|a copy|a parte|a peca)\b[^.;\n]{0,40}?(?:(?:fica|ficam|vai)\s+(?:com|pro|pra|para)|(?:e|sera|serao)\s+(?:do|da|de))\s+/;

/* ------------------------------------------------------------------ */
/* NEGAÇÃO E BLOQUEADORES — avaliados ANTES do verbo                   */
/* ------------------------------------------------------------------ */

/**
 * NEGAÇÃO TEM PRIORIDADE. "não cria ainda" contém "cria"; a V1 via o verbo,
 * autorizava, e o "não" não participava da decisão. Aqui a negação é lida
 * primeiro e cala o trecho inteiro.
 *
 * O escopo é o TRECHO, não a mensagem: "não mexe no ClickUp, mas me diz o que
 * faria" nega a escrita e deixa a análise viva.
 */
const NEGACAO: Array<{ re: RegExp; rotulo: string }> = [
  { re: /\b(nao|nunca|jamais)\s+(?:se\s+)?(?:\w+\s+){0,2}?(cria|crie|separa|separe|lanca|lance|abre|abra|mexe|mexa|atribui|atribua|coloca|coloque|poe|ponha|manda|mande|joga|jogue|bota|bote|adiciona|adicione|muda|mude|altera|altere|faz|faca|monta|monte|precisa|precisamos)\b/, rotulo: 'negação direta do verbo' },
  { re: /\bnem\s+\w+\s+nem\s+\w+/, rotulo: 'dupla negação (nem ... nem ...)' },
  { re: /\bsem\s+(criar|cria|lancar|lancando|abrir|separar|atribuir|mexer|alterar|adicionar|comentar)\b/, rotulo: 'restrição "sem + verbo"' },
  { re: /\b(so|somente|apenas)\s+(analis|avali|revis|olh|le|le\b|verific|confer|me\s+(diz|diga|fala|fale))/, rotulo: 'restrição "só analisa"' },
  { re: /\bnao\s+precisa\s+(criar|lancar|abrir|separar|atribuir|mexer)\b/, rotulo: 'dispensa explícita' },
  { re: /\b(por enquanto nao|ainda nao|agora nao)\b/, rotulo: 'adiamento explícito' },
];

/**
 * Contextos onde um verbo de ação NÃO é uma ordem para o Bento. Cada um é um
 * jeito real de a frase falar sobre a ação em vez de pedi-la.
 */
const BLOQUEADORES: Array<{ re: RegExp; rotulo: string }> = [
  { re: /\b(se|caso|casoa)\s+(?:eu|a gente|nos|voce|ele|ela|o|a)?\s*\w*\s*(criar|cria|separar|separe|lancar|lance|abrir|atribuir)\b/, rotulo: 'hipótese/condicional' },
  { re: /\b(seria|seriam|ficaria|daria)\s+(melhor|bom|certo|possivel)\b/, rotulo: 'hipótese avaliativa' },
  { re: /\b(ontem|semana passada|mes passado|outro dia|antes|ja)\s+(\w+\s+){0,2}?(criei|criou|criamos|criaram|lancei|lancou|separei|separou|abri|abriu|atribui|atribuiu|coloquei|colocou|mandei|mandou)\b/, rotulo: 'relato no passado' },
  { re: /\b(criei|criou|criamos|criaram|lancei|lancou|lancaram|separei|separou|abriu|atribuiu|colocou|mandou)\b/, rotulo: 'verbo no passado' },
  { re: /\b(me explica|me explique|explica como|como (?:eu )?(?:faco|criar|crio|lanco)|como funciona|o que significa)\b/, rotulo: 'pedido de explicação' },
  { re: /\b(por que|porque|pq)\s+(voce|vc|o bento)?\s*(criou|lancou|separou|atribuiu|colocou|abriu)\b/, rotulo: 'pergunta sobre ação passada' },
  { re: /\b(quem|qual|quais|quanto|quantos|quantas|quando|onde)\b.*\?/, rotulo: 'pergunta factual' },
  { re: /\b(deveria|deveriam|deveriamos|devemos|podemos|poderia|vale a pena|faz sentido|acha que|acham que)\b/, rotulo: 'deliberação' },
  { re: /\b(pediu|pedira|solicitou|mandou dizer|falou)\s+(pra|para|que)\b/, rotulo: 'relato de pedido de terceiro' },
  // "me atualiza", "me informa", "traz pra mim" — o alvo da ação é o FALANTE:
  // é pedido de informação, não escrita. Medido em 18/09/2026: "me atualiza
  // aí" classificou como UPDATE e quase criou task num panorama da operação.
  { re: /\b(me|nos)\s+(atualiz|inform|conta|conte|mostra|mostre|resume|resuma|traz|traga|explica|explique|detalh)/, rotulo: 'pedido de informação ao falante' },
  { re: /\b(atualiza|atualize|informa|informe|conta|conte|mostra|mostre|resume|resuma|traz|traga|explica|explique)\s+(pra|para)\s+(mim|nos|nós|a gente)\b/, rotulo: 'pedido de informação ao falante' },
];

/** Pedido explícito de análise — não bloqueia por si só, mas pesa. */
const ANALISE =
  /\b(analis[ae]|analisar|analise|avali[ae]|avaliar|revis[ae]|revisar|diagnostic|o que voce acha|o que voces acham|me diga|me diz|me fala|sua opiniao|da uma olhada|de uma olhada|olha isso|veja isso|checa|confere|conferir|compara)\b/;

/**
 * LIBERAÇÃO — o "sinal verde" depois de um freio.
 *
 * Caso real do fluxo de trabalho: a pessoa segura ("não cria ainda, faz o
 * briefing primeiro") e, dois turnos depois, libera ("agora pode criar"). Pela
 * regra do infinitivo isso não era ordem — "criar" depois de "pode" parecia
 * deliberação — e o pedido morria justamente no momento em que a pessoa tinha
 * acabado de autorizar. Ela já disse não uma vez; ouvir "não" de novo quando
 * disse sim é o pior jeito de perder confiança.
 *
 * O que separa liberação de pergunta é o ponto de interrogação: "pode criar?"
 * consulta, "pode criar" manda. E `NEGACAO` continua vindo antes, então "ainda
 * não pode criar" segue sendo freio.
 */
const LIBERACAO =
  /\b(?:agora\s+)?(?:ja\s+)?(?:pode|podem|liberado|liberada|autorizado|autorizada|confirmado|confirmada)\s+(?:ja\s+)?(?:criar|lancar|abrir|separar|atribuir|registrar|adicionar|cadastrar|comentar|mandar|subir|seguir|tocar)\b|\b(?:pode|podem)\s+(?:ir|mandar ver|seguir em frente)\b/;

/* ------------------------------------------------------------------ */
/* SEGMENTAÇÃO                                                         */
/* ------------------------------------------------------------------ */

/** Trecho entre aspas: conteúdo citado nunca é ordem pro Bento. */
const CITACAO = /["“”'']([^"“”'']{4,200})["“”'']/g;

/**
 * Quebra a mensagem em trechos analisáveis.
 *
 * O problema que isto mata: a V1 lia `split(/\n\s*\n/)[0]` — o primeiro
 * parágrafo — e depois passou a ler o parágrafo que endereça o agente. As duas
 * heurísticas perdem a ordem quando ela está no meio: "contexto... o Gui já
 * terminou? então separa essas quatro pra ele". Aqui NADA é descartado: cada
 * trecho é julgado, e a decisão sai da soma.
 */
export function segmentMessage(message: string): Array<{ text: string; index: number; kind: Segment['kind'] }> {
  // O bloco de contexto do Orchestrator não é fala de ninguém.
  const turno = message.split(/\n-{3,}\n/)[0] ?? message;

  const citados: string[] = [];
  CITACAO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITACAO.exec(turno)) !== null) {
    if (m[1]) citados.push(m[1]);
  }

  const bruto = turno
    .split(/\n+|(?<=[.!?;:])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return bruto.map((text, index) => {
    const ehItem = /^\s*(?:[-*•]|\d+[.)])\s+/.test(text) || /^["“][^"”]{3,80}["”]\s*;?\s*$/.test(text);
    // Trecho cujo miolo é uma citação vira 'quote': ordem dentro de aspas é
    // relato do que ALGUÉM disse, não pedido de quem está falando agora.
    const ehCitacao = citados.some((c) => text.includes(c) && c.length > text.length * 0.5);
    return { text, index, kind: ehItem ? ('list_item' as const) : ehCitacao ? ('quote' as const) : ('normal' as const) };
  });
}

/* ------------------------------------------------------------------ */
/* CLASSIFICAÇÃO POR TRECHO                                            */
/* ------------------------------------------------------------------ */

function classifySegment(raw: { text: string; index: number; kind: Segment['kind'] }): Segment {
  // Nome entre aspas é rótulo (da task, da campanha), não instrução: sem tirar
  // isso, `cria a task "Revisar peças"` virava pedido de análise.
  const semNomes = raw.text.replace(/["“''][^"”'']{3,120}["”'']/g, ' ');
  const f = formsOf(semNomes);

  const negations = NEGACAO.filter((n) => n.re.test(f.normalized)).map((n) => n.rotulo);
  const blockers = BLOQUEADORES.filter((b) => b.re.test(f.normalized)).map((b) => b.rotulo);

  const families: string[] = [];
  let imperative = false;
  const fOrdem: TextForms = { ...f, tokens: tokensDeOrdem(f.tokens) };
  for (const fam of FAMILIAS) {
    if (hasToken(fOrdem, ...fam.ordem)) {
      families.push(fam.nome);
      imperative = true;
    } else if (hasToken(f, ...fam.naoOrdem)) {
      families.push(`${fam.nome}:nao-ordem`);
    }
  }

  // "isso/essa" apontam pro que foi dito antes e valem alvo. "aí/lá" são
  // LOCATIVOS ("me atualiza aí" = "me atualiza, por favor") — tratá-los como
  // referente fez um pedido de panorama virar ordem de escrita.
  const deictico = /\b(isso|isto|essa|esse|essas|esses|aquilo|aquela)\b/.test(f.normalized);
  const alvoOperacional = f.tokens.some((t) => ALVO_OPERACIONAL.has(t)) || DESTINO_NOMEADO.test(semNomes);
  const hasTarget = alvoOperacional || deictico;

  const declarativa = ATRIBUICAO_DECLARATIVA.test(f.normalized) && DESTINO_NOMEADO.test(semNomes);
  // Liberação só vale como ordem em AFIRMAÇÃO: "pode criar?" é consulta.
  const liberacao = LIBERACAO.test(f.normalized) && !raw.text.trim().endsWith('?');

  // Uma ORDEM precisa de: verbo em forma de ordem, alvo quando a família
  // exige, nenhuma negação e nenhum contexto não-executável. Citação e item de
  // lista não ordenam nada — item de lista é o QUE fazer, não o pedido.
  let acts = false;
  if (raw.kind === 'normal' && negations.length === 0 && blockers.length === 0) {
    const familiaOrdem = FAMILIAS.find((fam) => families.includes(fam.nome));
    if (familiaOrdem) {
      // UPDATE e MAKE são ambíguos demais com um dêitico: "me atualiza aí"
      // não é "atualiza a task". Essas famílias exigem objeto operacional ou
      // destino nomeado de verdade — o dêitico só basta pra CREATE/ROUTE,
      // onde "cria isso" é o jeito normal de pedir.
      const alvoForte = familiaOrdem.nome === 'update' || familiaOrdem.nome === 'make' ? alvoOperacional : hasTarget;
      acts = !familiaOrdem.exigeAlvo || alvoForte;
    }
    if (declarativa) {
      acts = true;
      families.push('assign:declarativo');
      imperative = true;
    }
    if (liberacao) {
      acts = true;
      families.push('create:liberacao');
      imperative = true;
    }
  }

  return { text: raw.text, index: raw.index, kind: raw.kind, acts, signals: { families, negations, blockers, hasTarget, imperative } };
}

/* ------------------------------------------------------------------ */
/* CONSOLIDAÇÃO                                                        */
/* ------------------------------------------------------------------ */

/**
 * Decide o turno a partir dos trechos.
 *
 * A regra que carrega o peso: NEGAÇÃO EM QUALQUER TRECHO cala a mensagem
 * inteira. "só analisa, não cria task" tem um trecho de restrição e outro de
 * negação; nenhum deles ordena, e nenhum outro trecho pode ressuscitar a
 * escrita. Quem escreve "não cria" e vê uma task criada não confia mais no
 * sistema — e com razão.
 */
export function classifyActionIntentV2(message: string): ActionIntentV2 {
  const segments = segmentMessage(message).map(classifySegment);

  const negations = [...new Set(segments.flatMap((s) => s.signals.negations))];
  const acting = segments.filter((s) => s.acts);
  const signals = [...new Set(segments.flatMap((s) => s.signals.families))];

  const base = {
    signals,
    negations,
    segments,
  };

  // 1. NEGAÇÃO GANHA DE TUDO.
  if (negations.length > 0) {
    return { intent: 'ANALYZE', writeAuthorized: false, confidence: 0.95, sourceSpan: null, ...base };
  }

  // 2. Nenhum trecho ordena.
  if (acting.length === 0) {
    // Havia verbo de ação, mas só em contexto não executável (citação,
    // passado, hipótese). Isso NÃO é ambíguo — é claramente conversa sobre a
    // ação. Dizer "ambíguo" aqui só geraria pergunta desnecessária.
    return { intent: 'ANALYZE', writeAuthorized: false, confidence: 0.9, sourceSpan: null, ...base };
  }

  // 3. Há ordem. O span é o primeiro trecho que ordena — é o que a auditoria lê.
  const span = acting[0]!;

  // 4. AMBÍGUO: a única ordem está numa pergunta. "cria isso pro Gui?" pode ser
  // pedido ou consulta; escrever no palpite é o erro que não dá pra desfazer.
  const soPergunta = acting.every((s) => s.text.trim().endsWith('?'));
  if (soPergunta) {
    return { intent: 'AMBIGUOUS', writeAuthorized: false, confidence: 0.5, sourceSpan: span.text, ...base };
  }

  // 5. Confiança: ordem com alvo explícito e família inequívoca vale mais que
  // ordem genérica. Entra no trace, não em decisão binária.
  const alvo = span.signals.hasTarget ? 0.1 : 0;
  const create = span.signals.families.includes('create') ? 0.05 : 0;
  const confidence = Math.min(0.99, 0.8 + alvo + create);

  return { intent: 'ACT', writeAuthorized: true, confidence, sourceSpan: span.text, ...base };
}
