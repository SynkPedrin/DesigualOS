import type { OperationalTaskLike } from './build-operational-context';
import { zonedDayStart, OPERATION_TIMEZONE } from './resolve-temporal';

/**
 * briefing-engine.ts — monta briefing operacional a partir de dado REAL, com cada campo
 * classificado por procedência.
 *
 * Serviço reutilizável (§52): Bento usa pra operação, Otto pra criação, Jarbas pra
 * campanha, Suzy pra comunicação. A estrutura de seções segue o
 * `Template_Briefing_Corporativo_ClickUp_Agencia_IA` fornecido pelo dono.
 *
 * A REGRA QUE GOVERNA ESTE MÓDULO: campo sem dado não é preenchido com texto plausível.
 * Cada item sai marcado como:
 *   KNOWN   — veio de fonte real (ClickUp, banco), com a fonte nomeada;
 *   DERIVED — calculado a partir de dado real (ex: "3 bloqueadas" contado das tasks);
 *   MISSING — não existe fonte pra isso; aparece como lacuna explícita a preencher.
 * O objetivo é o oposto de um briefing bonito: é um briefing em que dá pra confiar,
 * porque ele mostra onde ele próprio não sabe.
 */

export type FieldProvenance = 'KNOWN' | 'DERIVED' | 'MISSING';

export interface BriefingField {
  label: string;
  value: string | null;
  provenance: FieldProvenance;
  /** De onde veio, quando KNOWN/DERIVED (ex: 'ClickUp: task 86bbx...'). */
  source?: string;
}

export interface BriefingSection {
  title: string;
  fields: BriefingField[];
}

export interface OperationalBriefing {
  title: string;
  /** Números derivados do dado real. */
  overview: {
    totalTasks: number;
    overdue: number;
    dueToday: number;
    unassigned: number;
    blocked: number;
    awaitingApproval: number;
    inProduction: number;
    /** Distribuição pelos status REAIS em uso no ClickUp da agência. É a verdade do dado;
     * as categorias semânticas acima são interpretação e podem não existir no funil dele. */
    byStatus: Array<{ status: string; count: number }>;
    byClient: Array<{ clientName: string; count: number }>;
  };
  sections: BriefingSection[];
  /** Lacunas: tudo que ficou MISSING, agrupado pra virar pedido de informação. */
  gaps: string[];
  /** Riscos concretos detectados no dado (não hipóteses genéricas). */
  risks: string[];
  /** Sugestões de adiantamento: o que dá pra puxar pra frente hoje. */
  opportunities: string[];
  /** Ranking de prioridade com o MOTIVO por trás de cada posição (§50). */
  priorityRanking: PriorityRankingItem[];
  /** Próxima melhor ação por risco detectado (§52): cada risco vira um passo concreto. */
  nextBestActions: NextBestAction[];
}

export interface PriorityRankingItem {
  taskId: string;
  name: string;
  clientName: string | null;
  /** Pontuação transparente (sem ML): soma das contribuições em `reasons`. */
  score: number;
  /** Por que está nesta posição, em linguagem de gestor (§50, §64). */
  reasons: string[];
  status: string | null;
  dueDate: number | null;
  assignees: string[];
}

export interface NextBestAction {
  /** O passo concreto a executar. */
  action: string;
  /** O risco/estado que motiva o passo (rastreável ao dado). */
  because: string;
}

export interface BriefingInput {
  /** Nome do cliente, ou null pra briefing da operação inteira. */
  clientName: string | null;
  tasks: OperationalTaskLike[];
  /** Nome de cliente por listId, pra agrupar briefing global. */
  clientNameByListId?: Map<string, string>;
  /** Dossiê consolidado do cliente (memória `client.profile`), se houver. */
  clientProfile?: string | null;
  /** Arquivos do projeto com texto extraído, se houver. */
  projectFiles?: Array<{ filename: string; kind: string }>;
  /** Tom de voz cadastrado no brand kit, se houver. */
  toneOfVoice?: string | null;
  /** Janela do briefing, pro título e pros cálculos de prazo. */
  temporalLabel?: string | null;
  now?: Date;
  /** true quando a consulta de origem foi truncada — o briefing precisa dizer isso. */
  truncated?: boolean;
}

/** Status que, na operação real da agência, significam cada estado do funil de entrega. */
const BLOCKED_HINTS = ['bloquead', 'blocked', 'impedid', 'travad'];
const APPROVAL_HINTS = ['aprova', 'approval', 'revisao', 'revisão', 'review', 'aguardando cliente', 'cliente'];
const PRODUCTION_HINTS = ['produc', 'produç', 'andamento', 'progress', 'fazendo', 'doing', 'execuc'];

function statusMatches(status: string | null, hints: string[]): boolean {
  if (!status) return false;
  const flat = status
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return hints.some((h) => flat.includes(h.normalize('NFD').replace(/[̀-ͯ]/g, '')));
}

function formatDate(ms: number | null): string {
  if (!ms) return 'sem prazo';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: OPERATION_TIMEZONE, day: '2-digit', month: '2-digit' }).format(
    new Date(ms),
  );
}

function known(label: string, value: string, source: string): BriefingField {
  return { label, value, provenance: 'KNOWN', source };
}
function derived(label: string, value: string, source: string): BriefingField {
  return { label, value, provenance: 'DERIVED', source };
}
function missing(label: string): BriefingField {
  return { label, value: null, provenance: 'MISSING' };
}

/** Nomes de tarefa, um por linha e entre aspas — ver nota sobre vírgula dentro do nome. */
function listaDeNomes(tasks: { name: string }[], max = 3): string {
  const mostradas = tasks.slice(0, max).map((t) => `\n  · "${t.name}"`);
  const resto = tasks.length - mostradas.length;
  return mostradas.join('') + (resto > 0 ? `\n  · ... e mais ${resto} tarefa(s)` : '');
}

const MS_PER_DAY = 86_400_000;

/**
 * Pontuação de prioridade TRANSPARENTE (§50): sem ML, sem caixa-preta. Cada
 * fator soma um peso documentado e entra em `reasons`, então o ranking sempre
 * explica a si mesmo. Tarefa concluída não é prioridade (score 0).
 */
export function scoreTaskPriority(
  task: OperationalTaskLike,
  now: Date,
): { score: number; reasons: string[] } {
  const concluida = task.statusType === 'done' || task.statusType === 'closed';
  if (concluida) return { score: 0, reasons: [] };

  const inicioDeHoje = zonedDayStart(now, 0);
  const fimDeHoje = zonedDayStart(now, 1) - 1;
  const reasons: string[] = [];
  let score = 0;

  if (task.dueDate !== null && task.dueDate < inicioDeHoje) {
    const dias = Math.max(1, Math.floor((inicioDeHoje - task.dueDate) / MS_PER_DAY));
    const contrib = 40 + Math.min(dias, 30);
    score += contrib;
    reasons.push(`vencida há ${dias} dia(s)`);
  } else if (task.dueDate !== null && task.dueDate <= fimDeHoje) {
    score += 25;
    reasons.push('vence hoje');
  } else if (task.dueDate !== null && task.dueDate <= fimDeHoje + 2 * MS_PER_DAY) {
    score += 15;
    reasons.push('vence nos próximos 2 dias');
  }

  if (task.priority === 'urgent') {
    score += 20;
    reasons.push('prioridade urgente');
  } else if (task.priority === 'high') {
    score += 12;
    reasons.push('prioridade alta');
  } else if (task.priority === 'normal') {
    score += 4;
  }

  if (statusMatches(task.status, BLOCKED_HINTS)) {
    score += 18;
    reasons.push('em status de bloqueio (pode estar segurando outras)');
  }
  if (task.assignees.length === 0) {
    score += 10;
    reasons.push('sem responsável definido');
  }
  if (statusMatches(task.status, APPROVAL_HINTS)) {
    score += 8;
    reasons.push('aguardando aprovação (destrava a fila)');
  }

  return { score, reasons };
}

/**
 * Ranking de prioridade (§50, §64): ordena as tarefas por pontuação
 * transparente e devolve o motivo por trás de cada posição. Empate desempata
 * pelo prazo mais próximo. Só entra o que tem pontuação positiva (algo a fazer).
 */
export function rankPriorities(
  input: { tasks: OperationalTaskLike[]; clientNameByListId?: Map<string, string>; clientName?: string | null; now?: Date; max?: number },
): PriorityRankingItem[] {
  const now = input.now ?? new Date();
  const max = input.max ?? 8;
  return input.tasks
    .map((task) => {
      const { score, reasons } = scoreTaskPriority(task, now);
      const clientName =
        input.clientName ??
        (task.listId ? input.clientNameByListId?.get(task.listId) : undefined) ??
        task.listName ??
        null;
      return { taskId: task.id, name: task.name, clientName, score, reasons, status: task.status, dueDate: task.dueDate, assignees: task.assignees };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || ((a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER)))
    .slice(0, max);
}

/**
 * Próxima melhor ação por risco (§52): cada estado problemático detectado no
 * dado vira UM passo concreto, com o motivo rastreável. Não é conselho
 * genérico — é derivado das tarefas reais deste turno.
 */
export function computeNextBestActions(input: {
  overdue: OperationalTaskLike[];
  unassigned: OperationalTaskLike[];
  blocked: OperationalTaskLike[];
  awaitingApproval: OperationalTaskLike[];
  prioritariasParadas: OperationalTaskLike[];
}): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const primeiro = (list: OperationalTaskLike[]): string => (list[0] ? `"${list[0].name}"` : '');

  if (input.overdue.length > 0) {
    actions.push({
      action: `Resolver hoje as ${input.overdue.length} tarefa(s) vencidas, começando por ${primeiro(input.overdue)}: concluir ou repactuar o prazo.`,
      because: `${input.overdue.length} tarefa(s) já passaram do prazo e continuam abertas`,
    });
  }
  if (input.blocked.length > 0) {
    actions.push({
      action: `Destravar as ${input.blocked.length} bloqueada(s): identificar o impedimento de ${primeiro(input.blocked)} e escalar quem resolve.`,
      because: `${input.blocked.length} tarefa(s) em status de bloqueio podem estar segurando outras`,
    });
  }
  if (input.unassigned.length > 0) {
    actions.push({
      action: `Designar responsável para as ${input.unassigned.length} tarefa(s) sem dono antes que virem atraso.`,
      because: `${input.unassigned.length} tarefa(s) não têm ninguém designado para executar`,
    });
  }
  if (input.prioritariasParadas.length > 0) {
    actions.push({
      action: `Colocar em produção as ${input.prioritariasParadas.length} tarefa(s) prioritária(s) ainda paradas, a partir de ${primeiro(input.prioritariasParadas)}.`,
      because: `${input.prioritariasParadas.length} tarefa(s) de prioridade alta/urgente não estão em produção`,
    });
  }
  if (input.awaitingApproval.length > 0) {
    actions.push({
      action: `Cobrar retorno das ${input.awaitingApproval.length} tarefa(s) aguardando aprovação para destravar a fila.`,
      because: `${input.awaitingApproval.length} tarefa(s) esperam aprovação`,
    });
  }
  return actions;
}

/**
 * Monta o briefing. Função PURA: recebe o dado já buscado e não faz I/O — é o que permite
 * testá-la inteira sem rede e reusá-la nos quatro agentes.
 */
export function buildOperationalBriefing(input: BriefingInput): OperationalBriefing {
  const now = input.now ?? new Date();
  const inicioDeHoje = zonedDayStart(now, 0);
  const fimDeHoje = zonedDayStart(now, 1) - 1;

  const tasks = input.tasks;
  // Tarefa CONCLUÍDA não está atrasada, mesmo com prazo no passado. Achado com dado de
  // produção (10/09/2026): de 1085 tarefas, 728 tinham prazo vencido — mas 690 estavam com
  // status `pronto`. Sem este filtro o briefing anunciava "728 atrasadas", um número
  // alarmante e falso; o real é a fatia que venceu E continua aberta.
  const concluida = (t: OperationalTaskLike): boolean =>
    t.statusType === 'done' || t.statusType === 'closed';
  const overdue = tasks.filter((t) => t.dueDate !== null && t.dueDate < inicioDeHoje && !concluida(t));
  const dueToday = tasks.filter(
    (t) => t.dueDate !== null && t.dueDate >= inicioDeHoje && t.dueDate <= fimDeHoje && !concluida(t),
  );
  const unassigned = tasks.filter((t) => t.assignees.length === 0);
  const blocked = tasks.filter((t) => statusMatches(t.status, BLOCKED_HINTS));
  const awaitingApproval = tasks.filter((t) => statusMatches(t.status, APPROVAL_HINTS));
  const inProduction = tasks.filter((t) => statusMatches(t.status, PRODUCTION_HINTS));

  // Distribuição pelos status reais. Motivo (achado com dado de produção em 10/09/2026):
  // as categorias que eu havia inventado ("em produção") NÃO existem no funil desta
  // agência — os status reais são `aberto`, `pronto`, `aguardando aprovação`, `pendente`.
  // O briefing dizia "0 em produção" entre 1085 tarefas, o que é tecnicamente verdadeiro e
  // completamente enganoso. Reportar o status real resolve isso sem adivinhar semântica.
  const porStatus = new Map<string, number>();
  for (const t of tasks) {
    const k = t.status ?? 'sem status';
    porStatus.set(k, (porStatus.get(k) ?? 0) + 1);
  }
  const byStatus = [...porStatus.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const porCliente = new Map<string, number>();
  for (const t of tasks) {
    const nome =
      input.clientName ??
      (t.listId ? input.clientNameByListId?.get(t.listId) : undefined) ??
      t.listName ??
      'sem cliente vinculado';
    porCliente.set(nome, (porCliente.get(nome) ?? 0) + 1);
  }
  const byClient = [...porCliente.entries()]
    .map(([clientName, count]) => ({ clientName, count }))
    .sort((a, b) => b.count - a.count);

  const escopo = input.clientName ?? 'OPERAÇÃO';
  const janela = input.temporalLabel ? ` — ${input.temporalLabel.replace('-', ' ').toUpperCase()}` : '';

  // --- Seções do template corporativo, preenchidas só com o que existe ---
  const sections: BriefingSection[] = [];

  sections.push({
    title: 'Identificação',
    fields: [
      input.clientName
        ? known('Cliente', input.clientName, 'banco: clients')
        : derived('Escopo', `${byClient.length} cliente(s) com entrega na janela`, 'ClickUp'),
      derived('Tarefas na janela', String(tasks.length), 'ClickUp (consulta ao vivo)'),
      // O template pede solicitante/aprovador; o ClickUp não expõe isso de forma
      // confiável por task, então fica MISSING em vez de virar chute.
      missing('Solicitante'),
      missing('Aprovador'),
    ],
  });

  // Prioridade CONCLUÍDA não é prioridade: sem este filtro o briefing global abria
  // listando cinco tarefas `pronto` como as prioridades do momento (visto com dado real).
  const prioritarias = [...tasks]
    .filter((t) => (t.priority === 'urgent' || t.priority === 'high') && !concluida(t))
    .sort((a, b) => (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER));

  sections.push({
    title: 'Prioridades',
    fields:
      prioritarias.length > 0
        ? prioritarias.slice(0, 8).map((t) =>
            known(
              t.name,
              [
                `status: ${t.status ?? 'sem status'}`,
                `prazo: ${formatDate(t.dueDate)}`,
                t.assignees.length ? `resp: ${t.assignees.join(', ')}` : 'resp: NINGUÉM',
                `prioridade: ${t.priority}`,
              ].join(' | '),
              `ClickUp: task ${t.id}`,
            ),
          )
        : [derived('Prioridades', 'nenhuma tarefa alta/urgente ABERTA na janela', 'ClickUp')],
  });

  const estadoFields: BriefingField[] = [
    // Status reais primeiro: é o que o ClickUp de fato diz.
    known('Por status (real)', byStatus.map((s) => `${s.status}: ${s.count}`).join(' | ') || 'nenhuma tarefa', 'ClickUp: campo status'),
    derived('Atrasadas (vencidas e ainda abertas)', String(overdue.length), 'ClickUp: due_date < hoje e status não concluído'),
    derived('Sem responsável', String(unassigned.length), 'ClickUp: assignees vazio'),
  ];
  // Categorias semânticas só entram quando de fato casaram com algum status desta operação;
  // reportar "0 bloqueadas" quando o funil não tem status de bloqueio sugere ausência de
  // problema onde na verdade há ausência de informação.
  if (awaitingApproval.length > 0) {
    estadoFields.push(derived('Aguardando aprovação', String(awaitingApproval.length), 'ClickUp: status'));
  }
  if (blocked.length > 0) estadoFields.push(derived('Bloqueadas', String(blocked.length), 'ClickUp: status'));
  if (inProduction.length > 0) estadoFields.push(derived('Em produção', String(inProduction.length), 'ClickUp: status'));
  sections.push({ title: 'Estado da entrega', fields: estadoFields });

  sections.push({
    title: 'Contexto do cliente',
    fields: [
      input.clientProfile?.trim()
        ? known('Dossiê', input.clientProfile.trim().slice(0, 600), 'memória: client.profile')
        : missing('Dossiê do cliente'),
      input.toneOfVoice?.trim()
        ? known('Tom de voz', input.toneOfVoice.trim(), 'banco: client_brand_kits')
        : missing('Tom de voz'),
      input.projectFiles?.length
        ? known('Materiais', input.projectFiles.map((f) => `${f.filename} (${f.kind})`).join(', '), 'banco: project_files')
        : missing('Materiais de referência'),
      // O template pede público/oferta/mensagem: nada disso é derivável de task.
      missing('Público-alvo'),
      missing('Oferta'),
      missing('Mensagem principal'),
      missing('Indicadores de sucesso'),
    ],
  });

  // --- Lacunas, riscos e oportunidades derivados do dado real ---
  // Nome de tarefa no ClickUp real TEM VÍRGULA dentro ("3Net, Criação Layout (850 Mega
  // R$89,99), SETEMBRO"). Listar esses nomes numa linha só, separados por ";", produziu um erro
  // de leitura medido ao vivo em 10/09/2026: o Bento respondeu "Dois clientes têm problemas,
  // pois passaram da data marcada" para DUAS TAREFAS de um único cliente — porque não havia
  // como distinguir a vírgula de dentro do nome da que separava os itens. Uma por linha, entre
  // aspas, elimina a ambiguidade na origem em vez de pedir ao modelo que adivinhe certo.
  const gaps = sections
    .flatMap((s) => s.fields.filter((f) => f.provenance === 'MISSING').map((f) => `${s.title}: ${f.label}`))
    .slice(0, 12);

  const risks: string[] = [];
  if (overdue.length > 0) {
    risks.push(`${overdue.length} tarefa(s) já passaram do prazo:${listaDeNomes(overdue)}`);
  }
  if (unassigned.length > 0) {
    risks.push(`${unassigned.length} tarefa(s) sem responsável — ninguém foi designado para executar`);
  }
  if (blocked.length > 0) {
    risks.push(`${blocked.length} tarefa(s) em status de bloqueio:${listaDeNomes(blocked)}`);
  }
  const prioritariasParadas = prioritarias.filter((t) => !statusMatches(t.status, PRODUCTION_HINTS));
  if (prioritariasParadas.length > 0) {
    risks.push(
      `${prioritariasParadas.length} tarefa(s) de prioridade alta/urgente ainda NÃO estão em produção:${listaDeNomes(prioritariasParadas)}`,
    );
  }
  if (input.truncated) {
    risks.push('A consulta bateu no teto de páginas: os números deste briefing são MÍNIMOS, não totais.');
  }

  const opportunities: string[] = [];
  const semPrazo = tasks.filter((t) => t.dueDate === null);
  if (semPrazo.length > 0) {
    opportunities.push(`${semPrazo.length} tarefa(s) sem prazo definido — dá para puxar para frente sem atrasar nada`);
  }
  const prontas = tasks.filter((t) => statusMatches(t.status, ['pronto', 'ready', 'concluid', 'done']));
  if (prontas.length > 0) {
    opportunities.push(`${prontas.length} tarefa(s) marcadas como prontas — cabe revisar e fechar`);
  }
  if (awaitingApproval.length > 0) {
    opportunities.push(`${awaitingApproval.length} aguardando aprovação — cobrar retorno destrava a fila`);
  }

  // PRIORIZAÇÃO E PRÓXIMA AÇÃO (§50, §52): o ranking transparente e as ações
  // por risco são calculados a partir das MESMAS tarefas reais já classificadas.
  const priorityRanking = rankPriorities({
    tasks,
    clientName: input.clientName,
    ...(input.clientNameByListId ? { clientNameByListId: input.clientNameByListId } : {}),
    now,
  });
  const nextBestActions = computeNextBestActions({
    overdue,
    unassigned,
    blocked,
    awaitingApproval,
    prioritariasParadas,
  });

  return {
    title: `${escopo}${janela} — BRIEFING OPERACIONAL`,
    overview: {
      totalTasks: tasks.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      unassigned: unassigned.length,
      blocked: blocked.length,
      awaitingApproval: awaitingApproval.length,
      inProduction: inProduction.length,
      byStatus,
      byClient,
    },
    sections,
    gaps,
    risks,
    opportunities,
    priorityRanking,
    nextBestActions,
  };
}

/**
 * Briefing -> texto pro prompt do agente. Marca a procedência de cada campo de forma
 * explícita, e as lacunas como lacunas, pra que o agente NÃO preencha com invenção.
 */
export function formatBriefingForPrompt(briefing: OperationalBriefing): string {
  const linhas: string[] = [];
  linhas.push(`BRIEFING MONTADO COM DADO AO VIVO — ${briefing.title}`);
  // Instrução REESCRITA em 10/09/2026 depois de teste com o time: a versão anterior
  // ("NUNCA preencha um [MISSING] com suposição") era defensiva demais e o Bento passou a
  // RECUSAR o pedido — respondeu "não consigo atender, alguns dados estão marcados como
  // [MISSING]" para um pedido de briefing que ele tinha dado de sobra pra montar. O objetivo
  // do marcador sempre foi impedir invenção, não impedir trabalho. Agora a ordem é explícita:
  // monte o briefing rico com o que existe, e trate a lacuna como pendência no fim.
  linhas.push(
    [
      'COMO USAR ISTO: monte o briefing MAIS COMPLETO possível com tudo que está marcado',
      '[KNOWN] e [DERIVED] — nomeie tarefas, responsáveis, prazos e números, agrupe por',
      'cliente ou por prioridade, aponte risco e o que dá pra adiantar. Escreva como um',
      'gestor de operação escreve, não como relatório de sistema.',
      'Os campos [MISSING] não têm fonte: NÃO invente conteúdo pra eles, mas também NUNCA',
      'recuse o pedido por causa deles — liste no fim, em uma linha, o que falta pra',
      'completar. Um briefing com lacunas declaradas é entrega; recusar é não entregar.',
    ].join('\n'),
  );
  linhas.push('');

  const o = briefing.overview;
  linhas.push('VISÃO GERAL');
  linhas.push(`${o.totalTasks} tarefa(s) | ${o.overdue} atrasada(s) | ${o.unassigned} sem responsável`);
  if (o.byStatus.length) {
    linhas.push(`Status reais: ${o.byStatus.map((s) => `${s.status} (${s.count})`).join(', ')}`);
  }
  if (o.byClient.length > 1) {
    linhas.push(`Por cliente: ${o.byClient.map((c) => `${c.clientName} (${c.count})`).join(', ')}`);
  }
  linhas.push('');

  if (briefing.priorityRanking.length) {
    linhas.push('PRIORIZAÇÃO (ranking com o motivo — use esta ordem pra dizer o que atacar primeiro)');
    briefing.priorityRanking.forEach((item, i) => {
      const cliente = item.clientName ? `${item.clientName} — ` : '';
      const resp = item.assignees.length ? item.assignees.join(', ') : 'sem responsável';
      linhas.push(`${i + 1}. ${cliente}"${item.name}" [${resp}] — motivo: ${item.reasons.join('; ') || 'prioridade base'}`);
    });
    linhas.push('');
  }

  for (const section of briefing.sections) {
    linhas.push(section.title.toUpperCase());
    for (const f of section.fields) {
      if (f.provenance === 'MISSING') {
        linhas.push(`- [MISSING] ${f.label}: não há fonte para isto`);
      } else {
        linhas.push(`- [${f.provenance}] ${f.label}: ${f.value}${f.source ? ` (fonte: ${f.source})` : ''}`);
      }
    }
    linhas.push('');
  }

  if (briefing.risks.length) {
    linhas.push('RISCOS DETECTADOS NO DADO');
    for (const r of briefing.risks) linhas.push(`- ${r}`);
    linhas.push('');
  }
  if (briefing.nextBestActions.length) {
    linhas.push('PRÓXIMAS AÇÕES (uma por risco detectado — cada passo é rastreável ao dado)');
    for (const nba of briefing.nextBestActions) linhas.push(`- ${nba.action} (porque: ${nba.because})`);
    linhas.push('');
  }
  if (briefing.opportunities.length) {
    linhas.push('OPORTUNIDADES DE ADIANTAMENTO');
    for (const op of briefing.opportunities) linhas.push(`- ${op}`);
    linhas.push('');
  }
  if (briefing.gaps.length) {
    linhas.push('PENDÊNCIAS PRA COMPLETAR DEPOIS (mencione em uma linha no fim, sem travar a entrega)');
    linhas.push(briefing.gaps.join('; '));
  }

  return linhas.join('\n').trimEnd();
}
