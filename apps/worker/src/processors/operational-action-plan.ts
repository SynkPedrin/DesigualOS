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
 */
const DESTINATARIO =
  /\b(?:pro|pra|para|ao|à|com)\s+(?:o\s+|a\s+)?([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)?)/g;
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
function destinatariosDe(clausula: string): string[] {
  const achados: string[] = [];
  for (const re of [DESTINATARIO, DESTINATARIO_DECLARATIVO]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clausula)) !== null) {
      const nome = (m[1] ?? m[2])?.trim();
      if (!nome) continue;
      const antes = clausula.slice(0, m.index);
      if (CONTEXTO_NAO_PESSOA.test(antes)) continue;
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
export function buildOperationalActionPlan(message: string): OperationalActionPlan {
  const turno = message.split(/\n-{3,}\n/)[0] ?? message;
  const instrucao = trechoDeInstrucao(turno);
  const flatInstrucao = dobra(instrucao);

  const splitRequested = /\b(separ[ae]|separar|divid[ae]|dividir|quebr[ae]|desmembr|em duas|em dois|uma pro|uma para o|outra pro|outra para)\b/.test(flatInstrucao);

  const tasks: PlannedTask[] = [];
  for (const c of clausulas(instrucao)) {
    // "o arquivo da arte eu mando depois" fala do que FALTA, não do que
    // despachar. Sem esta saída, virava uma segunda task chamada "arte", sem
    // dono e sem pedido — trabalho inventado a partir de uma ressalva.
    if (PENDENCIA_DECLARADA.some((pd) => pd.termo.test(c))) continue;
    const pessoas = destinatariosDe(c);
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
    const pessoa = destinatariosDe(instrucao)[0] ?? null;
    unicas.push({ deliverable: null, assigneeName: pessoa, excerpt: instrucao.slice(0, 200) });
  }

  const pendencies = PENDENCIA_DECLARADA.filter((p) => p.termo.test(turno)).map((p) => p.rotulo);

  return { tasks: unicas, pendencies: [...new Set(pendencies)], splitRequested, items: itensEnumerados(turno) };
}
