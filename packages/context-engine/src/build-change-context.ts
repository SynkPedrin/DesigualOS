import type { OperationalTaskLike } from './build-operational-context';
import { textoExternoSeguro } from './texto-externo';

/**
 * build-change-context.ts — "o que mudou?", que era irrespondível.
 *
 * O event store (`operational_events`) grava desde sempre cada task criada e
 * atualizada que o webhook do ClickUp entrega. Em 29/09/2026 havia 633 linhas
 * ali, todas processadas, e `eventsSince()` tinha ZERO chamadores em todo o
 * repositório: o histórico era gravado e nunca lido. Perguntado "o que mudou
 * nos últimos 7 dias?", o Bento respondia com a lista de tarefas que VENCEM na
 * janela — que é outra pergunta.
 *
 * Esta é a única vantagem que uma IA externa não consegue replicar: o Claude
 * ligado ao ClickUp vê o estado de agora, não a trajetória. Quem estava junto
 * quando aconteceu é que sabe o que mudou.
 *
 * ── O QUE O EVENTO SABE E O QUE NÃO SABE ──────────────────────────────────
 *
 * O payload do webhook traz `entity_id`, `list_id`, o tipo e a hora. NÃO traz
 * o nome da task, NÃO traz o autor e NÃO traz qual campo mudou. Então o nome
 * sai do cruzamento com a consulta ao vivo do mesmo turno, e o que não casa
 * fica declarado como não-casado em vez de sumir — uma task criada e concluída
 * dentro da janela não aparece entre as abertas, e isso é informação, não
 * lacuna a esconder.
 */

export interface ChangeEventLike {
  type: string;
  entityId: string | null;
  clientId: string | null;
  actor: string | null;
  occurredAt: Date | null;
}

export interface ChangeContext {
  /** Bloco pronto pro prompt. `null` quando não houve mudança na janela. */
  block: string | null;
  totalEventos: number;
  criadas: number;
  atualizadas: number;
  /** Tasks citadas por evento que não estão entre as abertas de agora. */
  naoResolvidas: number;
}

const ROTULO: Record<string, string> = {
  'task.created': 'criada',
  'task.updated': 'mexida',
  'task.completed': 'concluída',
  'task.overdue': 'venceu',
  'comment.created': 'comentada',
};

function formatarQuando(d: Date | null, now: Date): string {
  if (!d) return 'sem data';
  const dias = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

export interface ChangeContextInput {
  eventos: ChangeEventLike[];
  /** As tasks da consulta ao vivo deste turno — é de onde sai o NOME. */
  tasks: OperationalTaskLike[];
  /** clickup_list_id -> nome do cliente. */
  clientNameById: Map<string, string>;
  now?: Date;
  /** Descrição legível da janela, para o cabeçalho ("os últimos 7 dias"). */
  janelaLabel?: string | null;
}

/**
 * Monta o bloco de MUDANÇA. Puro: não consulta nada, recebe os eventos já
 * lidos e as tasks já buscadas — a mesma injeção do resto do context-engine.
 */
export function buildChangeContext(input: ChangeContextInput): ChangeContext {
  const now = input.now ?? new Date();
  const eventos = input.eventos.filter((e) => e.entityId);
  if (eventos.length === 0) {
    return { block: null, totalEventos: 0, criadas: 0, atualizadas: 0, naoResolvidas: 0 };
  }

  const taskPorId = new Map(input.tasks.map((t) => [t.id, t]));

  /**
   * UM EVENTO POR TASK, o mais recente. Uma task mexida 9 vezes no dia é uma
   * task que mudou, não nove mudanças — sem isto o bloco vira log de webhook e
   * o modelo lê volume onde não há.
   */
  const ultimoPorTask = new Map<string, ChangeEventLike>();
  let criadas = 0;
  let atualizadas = 0;
  const criadasIds = new Set<string>();
  for (const e of eventos) {
    const id = e.entityId!;
    if (e.type === 'task.created') criadasIds.add(id);
    const anterior = ultimoPorTask.get(id);
    if (!anterior || (e.occurredAt?.getTime() ?? 0) >= (anterior.occurredAt?.getTime() ?? 0)) {
      ultimoPorTask.set(id, e);
    }
  }
  for (const id of ultimoPorTask.keys()) {
    if (criadasIds.has(id)) criadas += 1;
    else atualizadas += 1;
  }

  const linhas: string[] = [];
  const janela = input.janelaLabel ? ` (${input.janelaLabel})` : '';
  linhas.push(`MUDANÇAS REGISTRADAS PELO DESIGUAL OS${janela} — histórico próprio, não é o estado de agora:`);
  linhas.push(
    `${ultimoPorTask.size} tarefa(s) se mexeram: ${criadas} criada(s) e ${atualizadas} alterada(s).`,
  );
  linhas.push(
    'Isto veio do registro de eventos do ClickUp que este sistema guarda desde que o webhook foi ligado. ' +
      'O evento NÃO diz QUAL campo mudou nem QUEM mexeu — então não afirme motivo nem autor de mudança a partir daqui.',
  );
  linhas.push('');

  const porCliente = new Map<string, Array<{ nome: string; rotulo: string; quando: string }>>();
  let naoResolvidas = 0;
  for (const [id, e] of ultimoPorTask) {
    const task = taskPorId.get(id);
    const rotulo = ROTULO[criadasIds.has(id) ? 'task.created' : e.type] ?? 'mexida';
    const quando = formatarQuando(e.occurredAt, now);
    if (!task) {
      naoResolvidas += 1;
      continue;
    }
    const cliente =
      (e.clientId ? input.clientNameById.get(e.clientId) : null) ?? task.listName ?? 'sem cliente vinculado';
    const lista = porCliente.get(cliente) ?? [];
    lista.push({ nome: textoExternoSeguro(task.name) || 'sem nome', rotulo, quando });
    porCliente.set(cliente, lista);
  }

  const ordenados = [...porCliente.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [cliente, itens] of ordenados) {
    linhas.push(`${textoExternoSeguro(cliente, 80)} (${itens.length}):`);
    for (const i of itens.slice(0, 15)) linhas.push(`- ${i.nome} — ${i.rotulo} ${i.quando}`);
    if (itens.length > 15) linhas.push(`(+${itens.length - 15} outras neste cliente)`);
    linhas.push('');
  }

  if (naoResolvidas > 0) {
    linhas.push(
      `${naoResolvidas} tarefa(s) se mexeram na janela e NÃO estão entre as abertas de agora — ` +
        'foram concluídas, fechadas ou saíram do escopo depois de mudar. Isso é informação sobre a janela, não falha de consulta.',
    );
  }

  return {
    block: linhas.join('\n').trimEnd(),
    totalEventos: eventos.length,
    criadas,
    atualizadas,
    naoResolvidas,
  };
}

/**
 * A pergunta é sobre MUDANÇA, e não sobre estado?
 *
 * "o que mudou?" e "o que está aberto?" pedem coisas diferentes, e até aqui as
 * duas recebiam a mesma resposta: a lista do que vence. Este detector é o que
 * separa as duas — e é deliberadamente estreito, porque o bloco de mudança só
 * faz sentido quando a pergunta é mesmo essa. Na dúvida, não entra.
 */
const MUDANCA_RE =
  /\b(o que mudou|que mudou|mudou (algo|alguma|na|no|desde)|o que aconteceu|que aconteceu|novidade|novidades|desde (ontem|a semana|o mes|o mês|sexta|segunda)|ultimos? \d+ dias|ultima semana|última semana|esta semana|nesta semana|hoje mudou|movimenta(c|ç)(a|ã)o recente|atividade recente|o que (foi|houve)|houve alguma)\b/i;

export function pedeMudanca(mensagem: string): boolean {
  const t = (mensagem ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return MUDANCA_RE.test(t);
}
