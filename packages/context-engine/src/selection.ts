import type { OperationalScope } from './resolve-scope';
import { textoExternoSeguro } from './texto-externo';

/**
 * selection.ts — O CONJUNTO SELECIONADO DA CONVERSA.
 *
 * O bug que isto mata (medido ao vivo em 24/09/2026): o Bento listou as 10
 * tasks que vencem hoje; no turno seguinte ("crie um briefing de cada uma
 * DELAS e lança pro Pedro") a referência se perdeu — o turno caiu numa
 * consulta GLOBAL sem filtro (1209 tasks) e o trabalho gerado não tinha
 * relação com as 10. A conversa tinha memória de TEXTO, mas não de ENTIDADE:
 * nenhum lugar guardava QUAIS tasks "elas" eram.
 *
 * Isto é o estado estruturado do referente: quando um turno lista tasks,
 * um snapshot (ids, títulos, clientes, responsáveis, prazos, motivo da
 * seleção) é persistido na metadata da mensagem. Follow-ups como "delas",
 * "cada uma", "a segunda", "as mais urgentes" ou "lança elas pro Pedro"
 * resolvem contra ESTE conjunto antes de qualquer consulta nova — a busca
 * global só acontece quando o pedido novo realmente pede outra coisa (outro
 * cliente, outra janela de tempo).
 *
 * Tudo aqui é determinístico e puro: detecção de referência, resolução de
 * ordinal/foco e formatação do bloco. Quem tem banco/ClickUp (API, worker)
 * persiste e reidrata.
 */

export interface SelectedTaskRef {
  id: string;
  title: string;
  clientName: string | null;
  listId: string | null;
  assignees: string[];
  dueDate: number | null;
  status: string | null;
  priority: string | null;
  url: string | null;
}

export interface SelectionSnapshot {
  version: 1;
  /** Motivo estrutural da seleção, ex: 'tasks_due_today', 'tasks_overdue'. */
  reason: string;
  /** Motivo legível com datas reais, ex: 'tasks que vencem hoje (24/09/2026)'. */
  reasonLabel: string;
  source: 'clickup_operational_tasks';
  /** ISO do momento da captura (ou da última reconsulta). */
  capturedAt: string;
  /** Na ORDEM EXATA em que foram exibidas — "a segunda" é tasks[1]. */
  tasks: SelectedTaskRef[];
  /** A task em foco ("dela", "o prazo?") — setada quando um ordinal é resolvido. */
  focusTaskId: string | null;
}

/** Teto do snapshot: acima disto a listagem é panorama, não conjunto referenciável. */
export const SELECTION_MAX_TASKS = 40;

export type SelectionReference =
  | { kind: 'all' }
  | { kind: 'ordinal'; position: number | 'last' | 'penultimate' }
  | { kind: 'urgent'; mode: 'top' | 'subset' }
  | { kind: 'focus' }
  /** "todas menos a primeira", "menos a pronta" — conjunto menos um recorte. */
  | { kind: 'exclude'; position?: number | 'last' | 'penultimate'; status?: string }
  /** "a do Endrigo", "as da DCS", "aquela da Cosentino" — por responsável, cliente ou título. */
  | { kind: 'attribute'; term: string }
  /** Nome de task citado na frase — "(DC_DC Academy_Base Apresentações)", "a DC Academy". */
  | { kind: 'name'; term: string }
  /** "faz o mesmo nas outras", "faz igual nela" — repete a ÚLTIMA operação registrada. */
  | { kind: 'repeat'; scope: 'rest' | 'all' | 'focus' };

/* ------------------------------------------------------------------ */
/* DETECÇÃO DE REFERÊNCIA — determinística, sem LLM                    */
/* ------------------------------------------------------------------ */

const ORDINAIS: Record<string, number> = {
  primeira: 0, primeiro: 0,
  segunda: 1, segundo: 1,
  terceira: 2, terceiro: 2,
  quarta: 3, quarto: 3,
  quinta: 4, quinto: 4,
  sexta: 5, sexto: 5,
  sétima: 6, setima: 6, sétimo: 6, setimo: 6,
  oitava: 7, oitavo: 7,
  nona: 8, nono: 8,
  décima: 9, decima: 9, décimo: 9, decimo: 9,
};

const ORDINAL_RE =
  /\b(primeir[ao]|segund[ao]|terceir[ao]|quart[ao]|quint[ao]|sext[ao]|s[eé]tim[ao]|oitav[ao]|non[ao]|d[eé]cim[ao])\b/i;
// `\b` do JS é ASCII: não enxerga fronteira antes de "ú". Lookbehind com o
// alfabeto completo, senão "a última" nunca casa.
const ULTIMA_RE = /(?<![a-zà-ú])([uú]ltim[ao]|pen[uú]ltim[ao])(?![a-zà-ú])/i;
/** Palavras de TEMPO que tornam "segunda"/"última" data, não ordinal. Só
 * locativos/temporais (na/no/em/pra...): "da segunda" é POSSESSIVO — item 2
 * da lista ("muda o prazo DA SEGUNDA"), nunca data. */
const CONTEXTO_TEMPORAL_RE = /(?:^|\s)(na|no|em|pra|pro|para|at[eé])\s*$|-feira|\b(semana|m[eê]s|vez)\s*$/;

/**
 * Plural dêitico que aponta pro conjunto inteiro: "delas", "essas aí",
 * "cada uma", "todas elas", "lança elas pro Pedro".
 */
// "todas/todos" SOZINHOS não entram: "me liste todas as tasks q vencem hoje"
// é consulta NOVA (janela própria), não referência ao conjunto anterior. O
// conjunto é apontado por dêitico ("delas", "essas aí") ou por "cada uma".
const CONJUNTO_RE =
  /\b(del[ao]s|dess[ao]s|ess[ao]s|est[ao]s|ness[ao]s|aquel[ao]s|elas|eles|tudo)\b|\bcada (?:um|uma)\b|\btod[ao]s (elas|eles|essas|esses)\b/i;

/** Singular: "dela", "dessa", "nesta", e o pronome nu "ela"/"ele" —
 * "altere ela" é foco puro (25/09/2026: a frase do incidente Tammy perdeu o
 * alvo porque "ela" não estava aqui). */
const FOCO_RE = /\b(del[ae]|dess[ae]|dest[ae]|nest[ae]|ness[ae]|disso|disto|ela|ele)\b/i;

/**
 * Pergunta de atributo nua sobre o item em foco: "e o prazo?", "qual o
 * responsável?", "e o status?". Só resolve quando JÁ existe foco — sem foco
 * ela não é referência a item nenhum e o turno segue o caminho normal.
 */
const ATRIBUTO_NUO_RE =
  /^(?:e\s+)?(?:qual|quais)?\s*(?:o\s+|a\s+)?(?:prazo|vencimento|respons[áa]vel|status|prioridade|cliente)\b[^?]{0,30}\??$/i;
/** "quem é o responsável?", "quem tá responsável?" — atributo do item em foco. */
const QUEM_RESPONSAVEL_RE = /^(?:e\s+)?quem\b[^?]{0,40}\brespons/i;

const URGENTE_TOP_RE = /\b(?:qual|quais)\b[^?]{0,30}\bmais urgente\b|\b[ao] mais urgente\b/i;
const URGENTE_SUBSET_RE = /\b(?:s[óo]|somente|apenas)?\s*as mais urgentes\b|\b(?:s[óo]|somente|apenas) as urgentes\b|\bas urgentes\b/i;

/**
 * REPETIÇÃO da última operação: "faz o mesmo nas outras", "faz igual nela".
 * O QUE repetir vem do registro de execução — aqui só se detecta a intenção
 * e o recorte ("nas outras" = o que ainda não foi feito).
 */
const REPEAT_RE = /\b(faz|faça|faze|repete|repita|refaz|refaça)\b[^?]{0,40}\b(mesma coisa|mesmo|igual)\b/i;

/** EXCLUSÃO: "todas menos a primeira", "menos a pronta", "exceto a última". */
const EXCLUDE_RE = /\b(?:menos|exceto|tirando)\s+(?:a|as|o|os)?\s*([a-zà-ú]+)/i;
/** Palavras de STATUS usadas em exclusão ("menos a pronta"). */
const STATUS_WORDS = new Set(['pronta', 'pronto', 'prontas', 'prontos', 'concluida', 'concluída', 'concluido', 'concluído', 'feita', 'feito', 'aberta', 'aberto']);

/**
 * ATRIBUTO: "a do Endrigo", "as da DCS", "aquela da Cosentino". O termo é
 * resolvido contra os responsáveis/clientes/títulos DO SNAPSHOT — termo que
 * não casa com nada devolve null na resolução e vira resposta honesta, nunca
 * pessoa inventada.
 */
const ATTRIBUTE_RE = /(?<![a-zà-ú])(?:aquel[ao]s?|ess[ao]s|a|as)\s+(?:do|da|dos|das)\s+([A-Za-zÀ-ÿ][\wÀ-ÿ.]*)/i;

/**
 * ORDINAL NUMÉRICO (24/09/2026, incidente D. Carvalho): "item 11", "task 4",
 * "número 3", "o 2". A numeração é a da LISTA EXIBIDA — nunca outra entidade
 * do ClickUp, nunca um id.
 */
const NUMERIC_ORDINAL_RE = /(?<![a-zà-ú])(?:item|task|tarefa|demanda|n[úu]mero|n[º°])\s*#?\s*(\d{1,2})(?![\d/])/i;

/**
 * NOME DE TASK ENTRE PARÊNTESES: "(DC_DC Academy_Base Apresentações)" logo
 * depois de "item 11" é a pessoa CONFIRMANDO o alvo pelo nome — casa por
 * título contra o snapshot, não vira pessoa nem cliente.
 */
const NOME_PARENTESES_RE = /\(([^()]{6,120})\)/;

/**
 * Detecta referência ao conjunto selecionado. Não decide se a referência é
 * VÁLIDA (isso é de quem tem o snapshot); só diz que a frase aponta pra ele.
 *
 * Ordem importa: ordinal é o mais específico ("a segunda" também casa em
 * nada mais), depois urgência, depois conjunto, depois foco.
 */
export function detectSelectionReference(message: string): SelectionReference | null {
  const texto = (message ?? '').split(/\n-{3,}\n/)[0] ?? '';
  const t = texto.trim();
  if (t.length === 0 || t.length > 240) return null;
  // "segunda-feira" é dia da semana, nunca ordinal.
  const limpo = t.replace(/segunda[\s-]?feira/gi, ' ');

  // REPETIÇÃO antes de tudo: "faz o mesmo nas outras" não tem dêitico nenhum,
  // mas é a referência mais específica que existe — a última OPERAÇÃO.
  if (REPEAT_RE.test(limpo)) {
    const scope = /\b(nas|nos|nas outras|outras|outros|demais)\b/i.test(limpo)
      ? /\boutras?\b|\boutros?\b|\bdemais\b/i.test(limpo)
        ? 'rest'
        : 'all'
      : /\b(nela|nele|nessa|nesse|nesta|neste)\b/i.test(limpo)
        ? 'focus'
        : 'all';
    return { kind: 'repeat', scope };
  }

  // EXCLUSÃO antes de ordinal: "todas menos a primeira" TEM ordinal, mas a
  // leitura é o conjunto MENOS ele — nunca o item sozinho. "menos" sozinho já
  // implica o conjunto ("menos a pronta"), não precisa de dêitico junto.
  const exclusao = limpo.match(EXCLUDE_RE);
  if (exclusao) {
    const alvo = exclusao[1]!.toLowerCase();
    if (STATUS_WORDS.has(alvo)) return { kind: 'exclude', status: alvo };
    const posicao = ORDINAIS[alvo];
    if (posicao !== undefined) return { kind: 'exclude', position: posicao };
    if (/^[uú]ltim[ao]$/.test(alvo)) return { kind: 'exclude', position: 'last' };
    if (/^pen[uú]ltim[ao]$/.test(alvo)) return { kind: 'exclude', position: 'penultimate' };
  }

  const ordinal = limpo.match(ORDINAL_RE);
  if (ordinal) {
    const antes = limpo.slice(0, ordinal.index ?? 0);
    const depois = limpo.slice((ordinal.index ?? 0) + ordinal[0].length);
    // A guarda de preposição ("na segunda" = dia) só vale pra SEGUNDA — é a
    // única que é dia da semana. "volta na primeira" é posição, não data.
    const ehSegunda = /^segund[ao]$/i.test(ordinal[1]!);
    if ((!ehSegunda || !CONTEXTO_TEMPORAL_RE.test(antes)) && !/^\s+(passad|pr[óo]xim|que vem)/i.test(depois)) {
      const posicao = ORDINAIS[ordinal[1]!.toLowerCase()];
      if (posicao !== undefined) return { kind: 'ordinal', position: posicao };
    }
  }
  // "item 11" / "task 4" — ordinal numérico da lista exibida.
  const numerico = limpo.match(NUMERIC_ORDINAL_RE);
  if (numerico) {
    const pos = Number(numerico[1]) - 1;
    if (pos >= 0) {
      // Se o nome da task vem entre parênteses logo ao lado, a referência é
      // por NOME (mais forte que posição: prova contra lista reordenada).
      const nomeParenteses = limpo.match(NOME_PARENTESES_RE);
      if (nomeParenteses) return { kind: 'name', term: nomeParenteses[1]!.trim() };
      return { kind: 'ordinal', position: pos };
    }
  }
  const ultima = limpo.match(ULTIMA_RE);
  if (ultima) {
    const depois = limpo.slice((ultima.index ?? 0) + ultima[0].length);
    if (!/^\s+(semana|m[eê]s|vez|hora)/i.test(depois)) {
      return { kind: 'ordinal', position: /pen/i.test(ultima[1]!) ? 'penultimate' : 'last' };
    }
  }

  if (/(urgente|prioridade)/i.test(limpo) && (URGENTE_TOP_RE.test(limpo) || URGENTE_SUBSET_RE.test(limpo))) {
    return { kind: 'urgent', mode: URGENTE_TOP_RE.test(limpo) && !/urgentes\b/i.test(limpo) ? 'top' : 'subset' };
  }

  // ATRIBUTO ("as da DCS", "a do Endrigo"): depois de ordinal/urgência, antes
  // do conjunto — é um recorte nomeado, não o conjunto inteiro.
  const atributo = limpo.match(ATTRIBUTE_RE);
  if (atributo) return { kind: 'attribute', term: atributo[1]! };

  if (CONJUNTO_RE.test(limpo)) return { kind: 'all' };

  if (FOCO_RE.test(limpo)) return { kind: 'focus' };
  if (t.length <= 60 && (ATRIBUTO_NUO_RE.test(t) || QUEM_RESPONSAVEL_RE.test(t))) return { kind: 'focus' };

  return null;
}

/* ------------------------------------------------------------------ */
/* RESOLUÇÃO CONTRA O SNAPSHOT                                         */
/* ------------------------------------------------------------------ */

const PRIORIDADE_ORDEM: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function rankUrgencia(t: SelectedTaskRef): number {
  return PRIORIDADE_ORDEM[t.priority ?? 'normal'] ?? 2;
}

export interface ResolvedSelection {
  /** Tasks que o pedido toca (todas, um subconjunto, ou uma só). */
  tasks: SelectedTaskRef[];
  /** O item que vira foco a partir deste turno (ordinal/urgente-top), se houver. */
  newFocusTaskId: string | null;
}

/**
 * Resolve a referência contra o snapshot: "a segunda" vira tasks[1], "as
 * urgentes" vira o subconjunto com prioridade urgent, "dela" vira o foco.
 * Devolve null quando a referência não tem como se sustentar (ordinal fora
 * do range, foco inexistente) — o chamador então responde honestamente em
 * vez de agir sobre o conjunto errado.
 */
export function resolveSelectionReference(
  snapshot: SelectionSnapshot,
  ref: SelectionReference,
): ResolvedSelection | null {
  if (snapshot.tasks.length === 0) return null;
  switch (ref.kind) {
    case 'all':
      return { tasks: snapshot.tasks, newFocusTaskId: null };
    case 'ordinal': {
      const index =
        ref.position === 'last'
          ? snapshot.tasks.length - 1
          : ref.position === 'penultimate'
            ? snapshot.tasks.length - 2
            : ref.position;
      const task = snapshot.tasks[index];
      if (!task) return null;
      return { tasks: [task], newFocusTaskId: task.id };
    }
    case 'urgent': {
      const ordenadas = [...snapshot.tasks].sort((a, b) => {
        const pa = rankUrgencia(a);
        const pb = rankUrgencia(b);
        if (pa !== pb) return pa - pb;
        return (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER);
      });
      if (ref.mode === 'top') return { tasks: [ordenadas[0]!], newFocusTaskId: ordenadas[0]!.id };
      const urgentes = ordenadas.filter((t) => t.priority === 'urgent');
      // Sem nenhuma marcada "urgent" de fato, o subconjunto honesto são as
      // mais prioritárias existentes — declarado no bloco, nunca escondido.
      return { tasks: urgentes.length > 0 ? urgentes : ordenadas.slice(0, 3), newFocusTaskId: null };
    }
    case 'focus': {
      const foco = snapshot.focusTaskId ? snapshot.tasks.find((t) => t.id === snapshot.focusTaskId) : null;
      if (!foco) return null;
      return { tasks: [foco], newFocusTaskId: foco.id };
    }
    case 'exclude': {
      let restantes = snapshot.tasks;
      if (ref.position !== undefined) {
        const index =
          ref.position === 'last' ? snapshot.tasks.length - 1 : ref.position === 'penultimate' ? snapshot.tasks.length - 2 : ref.position;
        if (!snapshot.tasks[index]) return null;
        restantes = snapshot.tasks.filter((_, i) => i !== index);
      } else if (ref.status) {
        const wanted = ref.status.normalize('NFD').replace(/[̀-ͯ]/g, '');
        const alvo = snapshot.tasks.filter((t) =>
          (t.status ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(wanted.replace(/s$/, '').replace(/a$|o$/, '')),
        );
        if (alvo.length === 0) return null;
        restantes = snapshot.tasks.filter((t) => !alvo.includes(t));
      }
      if (restantes.length === 0) return null;
      return { tasks: restantes, newFocusTaskId: null };
    }
    case 'attribute': {
      const termo = ref.term.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const casam = snapshot.tasks.filter((t) => {
        const cliente = (t.clientName ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const titulo = t.title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const responsaveis = t.assignees.map((a) => a.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
        // Título também casa: "a DC Academy" é referência a task existente
        // tanto quanto "aquela da DCS" (cliente) ou "a do Endrigo" (pessoa).
        return cliente.includes(termo) || titulo.includes(termo) || responsaveis.some((r) => r.includes(termo));
      });
      if (casam.length === 0) return null;
      return { tasks: casam, newFocusTaskId: casam.length === 1 ? casam[0]!.id : null };
    }
    case 'name': {
      const termo = ref.term.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      // Exato primeiro, contido depois — nome entre parênteses é a confirmação
      // mais forte de alvo que o usuário dá.
      const exatas = snapshot.tasks.filter((t) => t.title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === termo);
      const contidas = exatas.length > 0
        ? exatas
        : snapshot.tasks.filter((t) => {
            const titulo = t.title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
            return titulo.includes(termo) || termo.includes(titulo);
          });
      if (contidas.length === 0) return null;
      return { tasks: contidas, newFocusTaskId: contidas.length === 1 ? contidas[0]!.id : null };
    }
    /**
     * REPEAT: o recorte pedido ("nas outras" = o que falta) depende do
     * registro de execução, que mora no worker. Aqui devolve o conjunto
     * inteiro; quem executa afina o alvo contra o último `execucao`.
     */
    case 'repeat':
      return { tasks: snapshot.tasks, newFocusTaskId: null };
  }
}

/* ------------------------------------------------------------------ */
/* CONSTRUÇÃO E PARSE DO SNAPSHOT                                      */
/* ------------------------------------------------------------------ */

function formatData(ms: number | null, timeZone = 'America/Sao_Paulo', comAno = false): string {
  if (!ms) return 'sem prazo';
  const opcoes: Intl.DateTimeFormatOptions = comAno
    ? { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }
    : { timeZone, day: '2-digit', month: '2-digit' };
  return new Intl.DateTimeFormat('pt-BR', opcoes).format(new Date(ms));
}

export function hojeLabel(now: Date, timeZone = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
}

/** Motivo estrutural + legível da seleção, derivado do escopo que a gerou. */
export function selectionReasonFor(scope: OperationalScope, now: Date): { reason: string; reasonLabel: string } {
  const temporal = scope.temporal?.label ?? null;
  const qualificador =
    scope.kind === 'PERSON' && scope.person
      ? ` de ${scope.person.resolvedAs ?? scope.person.name}`
      : scope.kind === 'CLIENT' && scope.clients.length === 1
        ? ` de ${scope.clients[0]!.name}`
        : '';
  switch (temporal) {
    case 'hoje':
      return { reason: 'tasks_due_today', reasonLabel: `tasks que vencem hoje, ${hojeLabel(now)}${qualificador}` };
    case 'amanha':
      return {
        reason: 'tasks_due_tomorrow',
        reasonLabel: `tasks que vencem amanhã, ${formatData(scope.temporal!.from, 'America/Sao_Paulo', true)}${qualificador}`,
      };
    case 'ontem':
      return { reason: 'tasks_due_yesterday', reasonLabel: `tasks que venciam ontem${qualificador}` };
    case 'atrasadas':
      return { reason: 'tasks_overdue', reasonLabel: `tasks atrasadas${qualificador}` };
    case 'esta-semana':
      return { reason: 'tasks_due_this_week', reasonLabel: `tasks que vencem esta semana${qualificador}` };
    case 'semana-passada':
      return { reason: 'tasks_due_last_week', reasonLabel: `tasks da semana passada${qualificador}` };
    case 'proximos-7-dias':
      return { reason: 'tasks_due_next_7_days', reasonLabel: `tasks dos próximos 7 dias${qualificador}` };
    case 'ultimos-7-dias':
      return { reason: 'tasks_last_7_days', reasonLabel: `tasks dos últimos 7 dias${qualificador}` };
    default:
      return { reason: 'operational_listing', reasonLabel: `tasks abertas${qualificador || ' da operação'}` };
  }
}

export function buildSelectionSnapshot(params: {
  tasks: SelectedTaskRef[];
  scope: OperationalScope;
  now: Date;
}): SelectionSnapshot | null {
  const tasks = params.tasks.slice(0, SELECTION_MAX_TASKS);
  if (tasks.length === 0) return null;
  const { reason, reasonLabel } = selectionReasonFor(params.scope, params.now);
  return {
    version: 1,
    reason,
    reasonLabel,
    source: 'clickup_operational_tasks',
    capturedAt: params.now.toISOString(),
    tasks,
    focusTaskId: null,
  };
}

/**
 * Parse defensivo da metadata gravada na mensagem. Qualquer coisa fora do
 * formato vira null — um snapshot corrompido não pode derrubar o turno.
 */
export function parseSelectionSnapshot(raw: unknown): SelectionSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Partial<SelectionSnapshot>;
  if (s.version !== 1 || s.source !== 'clickup_operational_tasks') return null;
  if (!Array.isArray(s.tasks) || typeof s.reason !== 'string' || typeof s.reasonLabel !== 'string') return null;
  const tasks: SelectedTaskRef[] = [];
  for (const item of s.tasks) {
    if (typeof item !== 'object' || item === null) return null;
    const t = item as Partial<SelectedTaskRef>;
    if (typeof t.id !== 'string' || typeof t.title !== 'string') return null;
    tasks.push({
      id: t.id,
      title: t.title,
      clientName: typeof t.clientName === 'string' ? t.clientName : null,
      listId: typeof t.listId === 'string' ? t.listId : null,
      assignees: Array.isArray(t.assignees) ? t.assignees.filter((a): a is string => typeof a === 'string') : [],
      dueDate: typeof t.dueDate === 'number' ? t.dueDate : null,
      status: typeof t.status === 'string' ? t.status : null,
      priority: typeof t.priority === 'string' ? t.priority : null,
      url: typeof t.url === 'string' ? t.url : null,
    });
  }
  if (tasks.length === 0) return null;
  return {
    version: 1,
    reason: s.reason,
    reasonLabel: s.reasonLabel,
    source: 'clickup_operational_tasks',
    capturedAt: typeof s.capturedAt === 'string' ? s.capturedAt : new Date(0).toISOString(),
    tasks,
    focusTaskId: typeof s.focusTaskId === 'string' ? s.focusTaskId : null,
  };
}

/* ------------------------------------------------------------------ */
/* BLOCO PRO AGENTE                                                    */
/* ------------------------------------------------------------------ */

/**
 * O bloco da seleção, numerado — é a numeração que dá sentido a "a segunda"
 * pro agente que sintetiza a resposta, e é a mesma ordem do snapshot, então
 * o ordinal resolve igual nos dois lados.
 *
 * O bloco diz ao agente, explicitamente, que a pergunta é sobre ESTAS tasks —
 * é a instrução que impede o fallback global no serviço remoto.
 */
export function formatSelectionBlock(params: {
  snapshot: SelectionSnapshot;
  focusTaskId: string | null;
  now: Date;
}): string {
  const { snapshot, focusTaskId, now } = params;
  const linhas: string[] = [];
  linhas.push('DADOS AO VIVO DO CLICKUP (seleção desta conversa, reconsultados agora):');
  linhas.push(`Hoje é ${hojeLabel(now)}. PRAZO é data de entrega da TAREFA, nunca data de evento.`);
  linhas.push(
    `A pergunta é sobre EXATAMENTE estas ${snapshot.tasks.length} tasks (${snapshot.reasonLabel}). ` +
      '"delas", "essas", "cada uma" = esta lista; "a segunda" = item 2; "a última" = o último item. ' +
      'NÃO busque nem cite tasks fora desta lista.',
  );
  linhas.push('');
  snapshot.tasks.forEach((t, i) => {
    const partes = [
      `${i + 1}. ${textoExternoSeguro(t.title) || 'sem nome'}`,
      `cliente: ${textoExternoSeguro(t.clientName ?? 'sem cliente vinculado', 80)}`,
      `status: ${textoExternoSeguro(t.status) || 'sem status'}`,
      `prazo: ${formatData(t.dueDate, 'America/Sao_Paulo', true)}`,
      t.assignees.length
        ? `resp: ${t.assignees.map((a) => textoExternoSeguro(a, 60)).filter(Boolean).join(', ') || 'ninguém'}`
        : 'resp: ninguém',
    ];
    if (t.priority) partes.push(`prioridade: ${t.priority}`);
    if (t.url) partes.push(t.url);
    linhas.push(partes.join(' | '));
  });
  const foco = focusTaskId ? snapshot.tasks.findIndex((t) => t.id === focusTaskId) : -1;
  if (foco >= 0) {
    linhas.push('');
    linhas.push(
      `REFERENTE ATUAL: item ${foco + 1} — "${textoExternoSeguro(snapshot.tasks[foco]!.title)}". ` +
        'Quando o usuário disser "dela", "essa", "o prazo", "o responsável", é DESTA task que ele está falando.',
    );
  }
  linhas.push('');
  linhas.push(...APRESENTACAO_HUMANA);
  return linhas.join('\n');
}

/**
 * COMO APRESENTAR (adendo visual de 24/09/2026): o dado operacional vira
 * comunicação humana. Vale pra QUALQUER resposta baseada neste bloco.
 */
export const APRESENTACAO_HUMANA = [
  'COMO APRESENTAR (obrigatório): fale como uma pessoa competente da operação, nunca como banco de dados ("Encontrei 11 tasks com vencimento hoje", não "o sistema retornou 11 registros").',
  'Lista de tasks: heading curto por cliente, itens numerados, metadados de cada item (👤 responsável, 📅 prazo, ⚠️ prioridade alta/urgente) em linhas INDENTADAS abaixo dele, com linha em branco entre itens. Nunca despeje campos separados por "|" numa linha só.',
  'Emojis só funcionais: 🚨 crítico, ⚠️ atenção, ✅ concluído, ❌ falhou, 📅 prazo, 👤 responsável, 🏢 cliente, 📝 briefing, 📌 importante, 🔄 em andamento. Um por heading ou metadado basta; nenhum por decoração.',
  'Pergunta curta de follow-up ("e a segunda?", "qual o prazo dela?", "já lançou?") = resposta CURTA, só sobre o que foi perguntado, sem repetir a lista inteira.',
  'Nunca exponha JSON, ids internos, nomes de ferramenta ou trace — só o que ajuda quem lê.',
];
