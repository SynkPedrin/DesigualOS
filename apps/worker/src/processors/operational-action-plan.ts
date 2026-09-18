import { trechoDeInstrucao } from './action-intent';

/**
 * operational-action-plan.ts — UMA MENSAGEM, N AÇÕES.
 *
 * O guard sabia executar exatamente uma criação por turno, e o "alvo" dela era
 * uma pessoa e um nome. A operação não fala assim: ela despacha vários
 * entregáveis de uma vez e cada um vai pra uma pessoa diferente — "layout fica
 * com o Gui e o texto com a Sofia", "cria uma pro layout e outra pro texto".
 * Sem esta camada, metade do pedido virava silêncio: o Bento criava a primeira
 * e não contava que tinha ignorado a segunda.
 *
 * O plano é DETERMINÍSTICO. Ação que muda a operação de uma agência não nasce
 * de texto livre de modelo: nasce de pares (entregável, destinatário) lidos do
 * que a pessoa escreveu, e o que não foi escrito NÃO é preenchido por dedução —
 * vira `[CONFIRMAR]` na pendência ou uma pergunta.
 *
 * Aqui não se resolve pessoa nem cliente contra o ClickUp: isso é da camada de
 * resolução, que sabe dizer "achei três Gui". Aqui só se lê o pedido.
 */

/**
 * Entregáveis que a agência nomeia antes de existir task.
 *
 * "briefing" NÃO entra: briefing não é uma demanda paralela, é o conteúdo que
 * viaja DENTRO da task. Tratá-lo como entregável fazia "cria os dois com
 * briefing" virar três tasks, uma delas chamada "briefing" e sem dono.
 */
const ENTREGAVEIS: Array<{ termo: RegExp; rotulo: string }> = [
  { termo: /\blayouts?\b/, rotulo: 'layout' },
  { termo: /\bartes?\b/, rotulo: 'arte' },
  { termo: /\bpe[cç]as?\b/, rotulo: 'peças' },
  { termo: /\bplacas?\b/, rotulo: 'placas' },
  { termo: /\b(copy|textos?|reda[cç][aã]o|legendas?)\b/, rotulo: 'texto' },
  { termo: /\b(v[ií]deos?|edi[cç][aã]o|montagem)\b/, rotulo: 'vídeo' },
  { termo: /\b(reels?|stories|posts?|carross[eé]l|carrossel)\b/, rotulo: 'conteúdo social' },
  { termo: /\broteiros?\b/, rotulo: 'roteiro' },
  { termo: /\b(landing ?page|lp|site)\b/, rotulo: 'landing page' },
  { termo: /\bmapas?\b/, rotulo: 'mapa' },
];

/**
 * Nome próprio precedido de preposição de destino. Lê o texto COM CAIXA: é a
 * maiúscula que separa "pro Gui" de "pra frente".
 *
 * O grupo `(?:[A-Z][a-z]+)*` existe pra CamelCase: sem ele "no ClickUp"
 * capturava "Click", que não casa com a lista de não-pessoas e fazia o Bento
 * perguntar quem é o Click.
 */
const DESTINATARIO =
  /\b(?:pro|pra|para|ao|à|com|n[ao])\s+(?:o\s+|a\s+)?([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:[A-Z][a-záàâãéêíóôõúç]+)*(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)?)/g;
/**
 * Atribuição declarativa: "layout fica com o Gui", "o texto é do Matheus".
 *
 * O `é` fica FORA do `\b` de propósito: em JavaScript sem a flag `u`, a letra
 * acentuada não é caractere de palavra, então `\bé` nunca casa e "essa demanda
 * é do Matheus" saía sem responsável nenhum.
 */
const DESTINATARIO_DECLARATIVO =
  /(?:\b(?:fica|ficam|vai)\s+(?:com|pro|pra|para)|(?:\b(?:e|sera|serao)\b|é|são)\s+(?:do|da|de))\s+(?:o\s+|a\s+)?([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)/g;

/**
 * Palavra que vem logo ANTES do nome e prova que ele não é uma pessoa:
 * "na lista da D Carvalho" é destino de LISTA, não destinatário de trabalho.
 * Sem este filtro, "D Carvalho" virava candidato a responsável e o Bento
 * perguntaria quem é — sobre o nome do próprio cliente.
 */
const CONTEXTO_NAO_PESSOA = /\b(lista|cliente|conta|pasta|board|projeto|campanha|espa[cç]o|workspace)\s+(?:d[aeo]s?\s+)?$/i;

/**
 * Nome próprio que nunca é pessoa. "coloca isso no ClickUp" aponta a
 * FERRAMENTA, e a preposição "no" é a mesma de "bota essa no Gui" — sem esta
 * lista, o Bento perguntaria quem é o ClickUp.
 */
const NAO_E_PESSOA = new Set([
  'clickup', 'trello', 'asana', 'jira', 'notion', 'drive', 'slack', 'whatsapp', 'instagram',
  'facebook', 'meta', 'google', 'canva', 'figma', 'desigual', 'bento', 'otto', 'jarbas', 'suzy',
]);

/** Material que a pessoa avisou que ainda não mandou. */
const PENDENCIA_DECLARADA: Array<{ termo: RegExp; rotulo: string }> = [
  { termo: /\b(?:vou|irei)\s+(?:encaminhar|mandar|enviar|passar|subir)\b/i, rotulo: 'material que a solicitante vai encaminhar' },
  { termo: /\b(?:mando|envio|encaminho|passo)\s+(?:isso\s+)?(?:depois|mais tarde|em seguida|amanh[ãa])\b/i, rotulo: 'material que a solicitante vai encaminhar' },
  { termo: /\bassim que (?:eu )?(?:tiver|receber|conseguir)\b/i, rotulo: 'material condicionado a recebimento' },
  { termo: /\b(?:ainda )?n[ãa]o (?:tenho|recebi|chegou|foi anexad)/i, rotulo: 'material declarado como ainda ausente' },
  { termo: /\bfalta(?:m|ndo)?\s+(?:o\s+|a\s+|os\s+|as\s+)?(?:arquivo|material|refer[êe]ncia|base|mapa|foto|imagem)/i, rotulo: 'material declarado como faltante' },
];

export interface PlannedTask {
  /** Entregável que dá nome ao trabalho ("layout"), ou null quando genérico. */
  deliverable: string | null;
  /** Item enumerado que ORIGINOU esta task, quando o pedido veio em lista. */
  item?: string;
  /** Nome FALADO do responsável ("Gui"). Ainda não resolvido no ClickUp. */
  assigneeName: string | null;
  /** Trecho do pedido que originou esta task — vai pro briefing. */
  excerpt: string;
}

export interface OperationalActionPlan {
  tasks: PlannedTask[];
  /** Material citado como ausente. Vira pendência na task, NUNCA bloqueio. */
  pendencies: string[];
  /** A pessoa pediu para separar/dividir a demanda. */
  splitRequested: boolean;
  /** Itens enumerados na solicitação colada (lista de placas, de peças...). */
  items: string[];
}

function dobra(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Quebra a instrução nas fronteiras onde a operação separa um pedido do outro. */
function clausulas(texto: string): string[] {
  return texto
    .split(/[;\n]|(?<=[a-zà-ú)"”])\s*,\s*|\s+\be\b\s+|\.\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/** Nomes próprios apontados como destino nesta cláusula, sem os que são lista/cliente. */
function destinatariosDe(clausula: string, excluir: Set<string> = new Set()): string[] {
  const achados: string[] = [];
  for (const re of [DESTINATARIO, DESTINATARIO_DECLARATIVO]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clausula)) !== null) {
      const nome = (m[1] ?? m[2])?.trim();
      if (!nome) continue;
      const antes = clausula.slice(0, m.index);
      if (CONTEXTO_NAO_PESSOA.test(antes)) continue;
      const flat = dobra(nome);
      if (NAO_E_PESSOA.has(flat)) continue;
      // O extrator captura uma ou duas palavras ("Clinica" ou "Clinica
      // Teste"), então igualdade exata não basta: o capturado pode ser
      // PREFIXO do nome excluído. Sem isto, "na Clinica Teste Fase 7" deixava
      // "Clinica Teste" passar como um segundo responsável.
      if ([...excluir].some((e) => e === flat || e.startsWith(`${flat} `))) continue;
      if (!achados.includes(nome)) achados.push(nome);
    }
  }
  return achados;
}

/** Entregáveis nomeados nesta cláusula, na ordem em que aparecem. */
function entregaveisDe(clausula: string): string[] {
  const flat = dobra(clausula);
  // Ordenado pela POSIÇÃO no texto, não pela ordem da tabela: o pareamento
  // com as pessoas é posicional, então "layout pro Gui e texto pra Sofia" só
  // fica certo se os entregáveis saírem na ordem em que foram ditos.
  return ENTREGAVEIS.map((e) => ({ rotulo: e.rotulo, at: flat.search(e.termo) }))
    .filter((e) => e.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((e) => e.rotulo);
}

/**
 * LISTA DE ITENS — "separa essas quatro pro Gui" são QUATRO demandas.
 *
 * O parser antigo enxergava uma ordem só e jogava os itens no briefing. Para
 * quem executa, isso é uma task chamada "placas" que só fica pronta quando as
 * quatro ficarem: some o progresso parcial, some a divisão entre pessoas e
 * some a possibilidade de uma placa travar sem travar as outras. A operação
 * trabalha item a item; o plano precisa refletir isso.
 *
 * Quatro formas, porque são as quatro que a equipe usa:
 *   - bullets   ("- Placa X")
 *   - numerada  ("1. Placa X")
 *   - linhas soltas que repetem o mesmo substantivo ("Placa X" / "Placa Y")
 *   - inline depois de dois-pontos ("...: A, B, C e D")
 */
function media(linhas: string[]): number {
  return linhas.reduce((n, l) => n + l.length, 0) / Math.max(1, linhas.length);
}

export function extractListItems(turno: string): string[] {
  const linhas = turno.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  // 1. Marcadores explícitos mandam: bullet e numeração não deixam dúvida.
  const marcados = linhas
    .filter((l) => /^(?:[-*•]|\d+[.)])\s+\S/.test(l))
    .map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/[;,]$/, '').trim())
    .filter((l) => l.length >= 2 && l.length <= 160);
  if (marcados.length >= 2) return marcados.slice(0, 20);

  // 2. Linhas soltas que começam com a MESMA palavra: "Placa X" / "Placa Y".
  //    Exigir a repetição é o que impede um parágrafo qualquer de virar lista.
  // Sem filtrar por pontuação final: um item legítimo pode terminar em ponto
  // ("Placa de orientação em formato de mapa, usando o mapa em arquivo."), e
  // descartá-lo fazia a quarta placa do caso real sumir do plano. Quem segura
  // o falso positivo aqui é a REPETIÇÃO do substantivo-cabeça, não a
  // pontuação. Linha terminada em ":" é CABEÇALHO da lista ("Precisamos das
  // seguintes placas:"), nunca um item dela.
  const curtas = linhas.filter((l) => l.length <= 160 && !l.endsWith(':'));
  const porCabeca = new Map<string, string[]>();
  for (const l of curtas) {
    const cabeca = dobra(l).split(/\s+/)[0] ?? '';
    if (cabeca.length < 3) continue;
    porCabeca.set(cabeca, [...(porCabeca.get(cabeca) ?? []), l.replace(/[;,]$/, '').trim()]);
  }
  // O MAIOR grupo vence, não o primeiro: no caso real o texto começa com duas
  // linhas de prosa iniciadas por "precisamos", e pegar a primeira repetição
  // que aparecesse fazia a prosa virar a lista e as quatro placas sumirem.
  // Empate resolve pelo grupo de linhas mais curtas — item é curto, prosa não.
  const candidatos = [...porCabeca.values()]
    .filter((g) => g.length >= 2)
    .filter((g) => g.reduce((n, l) => n + l.length, 0) / g.length <= 120)
    .sort((a, b) => b.length - a.length || media(a) - media(b));
  if (candidatos[0]) return candidatos[0].slice(0, 20);

  // 3. Inline depois de dois-pontos. Só com dois-pontos, de propósito: sem
  //    ele, "cria o layout pro Gui e o texto pra Sofia" viraria lista de dois
  //    itens e perderia o pareamento com as duas pessoas.
  const aposDoisPontos = /:\s*([^\n]{6,300})$/m.exec(turno)?.[1];
  if (aposDoisPontos) {
    const partes = aposDoisPontos
      .split(/\s*,\s*|\s+e\s+/i)
      .map((p) => p.replace(/[.;]$/, '').trim())
      .filter((p) => p.length >= 2 && p.length <= 160);
    if (partes.length >= 3) return partes.slice(0, 20);
  }

  return [];
}

/**
 * Itens enumerados na solicitação (uma linha por item, ou separados por ";").
 * É o que precisa aparecer no briefing pra quem vai executar não ter que
 * voltar no chat: no caso real eram quatro placas nomeadas uma a uma.
 */
function itensEnumerados(turno: string): string[] {
  return turno
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•\d]+[.)]?\s*/, '').replace(/;$/, '').trim())
    .filter((l) => l.length >= 4 && l.length <= 140)
    .filter((l) => /^(placa|pe[cç]a|layout|arte|v[ií]deo|post|banner|card|item|criativo)/i.test(l) || /^[“"].{3,}/.test(l))
    .slice(0, 20);
}

/**
 * Lê o pedido e devolve o plano. Nunca lança: pedido que não nomeia entregável
 * nem pessoa vira UMA task genérica, que a camada de cima titula e valida.
 */
/**
 * Nomes que NÃO podem virar responsável, ainda que a frase os aponte como
 * destino. Na prática é o cliente: "separa pro Gui na Clinica Teste Fase 7"
 * tem dois nomes próprios depois de preposição, e só um é pessoa. Sem isto o
 * cliente virava um segundo "responsável", o pedido parecia ter dois donos e
 * o parser de lista desistia de dividir os itens — quatro placas viravam duas
 * tasks, uma delas sem dono.
 *
 * Vem de fora porque quem sabe o nome do cliente é o guard, que já o resolveu
 * contra a carteira antes de planejar.
 */
export interface PlanOptions {
  excludeNames?: Array<string | null | undefined>;
}

function chavesDeExclusao(nomes: Array<string | null | undefined>): Set<string> {
  const chaves = new Set<string>();
  for (const n of nomes) {
    if (!n) continue;
    const flat = dobra(n).trim();
    chaves.add(flat);
    // O extrator captura só a primeira palavra do nome composto ("Clinica"),
    // então a primeira palavra também precisa estar na exclusão.
    const primeira = flat.split(/\s+/)[0];
    if (primeira && primeira.length >= 3) chaves.add(primeira);
  }
  return chaves;
}

export function buildOperationalActionPlan(message: string, options: PlanOptions = {}): OperationalActionPlan {
  const excluir = chavesDeExclusao(options.excludeNames ?? []);
  const turno = message.split(/\n-{3,}\n/)[0] ?? message;
  const instrucao = trechoDeInstrucao(turno);
  const flatInstrucao = dobra(instrucao);

  const splitRequested = /\b(separ[ae]|separar|divid[ae]|dividir|quebr[ae]|desmembr|em duas|em dois|uma pro|uma para o|outra pro|outra para)\b/.test(flatInstrucao);

  /**
   * LISTA TEM PRECEDÊNCIA sobre o pareamento entregável x pessoa.
   *
   * Quando o pedido enumera itens ("separa essas quatro pro Gui"), o trabalho
   * é um por item — e o destinatário da ordem vale pra todos. O pareamento
   * posicional continua servindo pro outro formato ("layout pro Gui e texto
   * pra Sofia"), onde cada entregável já tem dono próprio.
   */
  const itensDaLista = extractListItems(turno);
  const pessoasDaInstrucao = destinatariosDe(instrucao, excluir);
  if (itensDaLista.length >= 2 && pessoasDaInstrucao.length <= 1) {
    const dono = pessoasDaInstrucao[0] ?? null;
    return {
      tasks: itensDaLista.map((item) => ({
        deliverable: entregaveisDe(item)[0] ?? null,
        item,
        assigneeName: dono,
        excerpt: item.slice(0, 200),
      })),
      pendencies: [...new Set(PENDENCIA_DECLARADA.filter((p) => p.termo.test(turno)).map((p) => p.rotulo))],
      splitRequested,
      items: itensDaLista,
    };
  }

  const tasks: PlannedTask[] = [];
  for (const c of clausulas(instrucao)) {
    // "o arquivo da arte eu mando depois" fala do que FALTA, não do que
    // despachar. Sem esta saída, virava uma segunda task chamada "arte", sem
    // dono e sem pedido — trabalho inventado a partir de uma ressalva.
    if (PENDENCIA_DECLARADA.some((pd) => pd.termo.test(c))) continue;
    const pessoas = destinatariosDe(c, excluir);
    const entregaveis = entregaveisDe(c);
    if (entregaveis.length === 0 && pessoas.length === 0) continue;

    if (entregaveis.length > 0) {
      // Um entregável por task. Com uma pessoa só na cláusula, ela recebe
      // todos; com várias, o pareamento é posicional — que é a ordem em que
      // quem escreveu falou ("layout pro Gui e texto pra Sofia").
      entregaveis.forEach((d, i) => {
        tasks.push({ deliverable: d, assigneeName: pessoas[i] ?? pessoas[0] ?? null, excerpt: c.slice(0, 200) });
      });
    } else {
      tasks.push({ deliverable: null, assigneeName: pessoas[0] ?? null, excerpt: c.slice(0, 200) });
    }
  }

  // Mesma dupla (entregável, pessoa) dita duas vezes é UMA demanda, não duas.
  const unicas: PlannedTask[] = [];
  for (const t of tasks) {
    const igual = unicas.find((u) => u.deliverable === t.deliverable && u.assigneeName === t.assigneeName);
    if (igual) continue;
    unicas.push(t);
  }

  // Nenhum par legível: o pedido existe (o classificador já autorizou), então
  // é UMA task. Deixar zero seria transformar ordem em silêncio — exatamente o
  // que este arquivo existe pra impedir.
  if (unicas.length === 0) {
    const pessoa = destinatariosDe(instrucao, excluir)[0] ?? null;
    unicas.push({ deliverable: null, assigneeName: pessoa, excerpt: instrucao.slice(0, 200) });
  }

  const pendencies = PENDENCIA_DECLARADA.filter((p) => p.termo.test(turno)).map((p) => p.rotulo);

  return { tasks: unicas, pendencies: [...new Set(pendencies)], splitRequested, items: itensEnumerados(turno) };
}
