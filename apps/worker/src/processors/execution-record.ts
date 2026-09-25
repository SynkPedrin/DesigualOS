import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * execution-record.ts — ESTADO DE EXECUÇÃO da conversa.
 *
 * O terceiro estado que o Bento perdia (medido ao vivo em 24/09/2026): depois
 * de executar (ou não) uma mutação no ClickUp, a pergunta "já lançou pro Pedro
 * no ClickUp?" caía no serviço remoto, que não tem memória nenhuma, e voltava
 * "De qual cliente você quer saber as tasks do ClickUp?" — como se nada tivesse
 * acontecido.
 *
 * O resultado de toda mutação do guard já é gravado na metadata da mensagem do
 * assistente (recordAssistantMessage). Isto aqui é a LEITURA estruturada desse
 * registro: YES / PARTIAL / NO com os ids reais, nunca uma resposta plausível.
 * Também é a trava de mutação duplicada: quem vai executar consulta aqui se a
 * MESMA operação sobre o MESMO conjunto já saiu.
 */

export interface ExecutionRecord {
  /** Id da execução registrada (uuid gerada no momento da mutação). */
  executionId: string;
  operation: string;
  taskIds: string[];
  targetPerson: { name: string; memberId: number | null; username: string | null } | null;
  successIds: string[];
  failedIds: Array<{ id: string; title: string; reason: string }>;
  /** ISO da conclusão (com read-back). */
  timestamp: string;
  verification: Array<{ taskId: string; assigneeVerified?: boolean; briefingVerified?: boolean }>;
  selectionReason?: string;
  /** Títulos por id, pra resposta humana. */
  titles?: Record<string, string>;
  /** Valores legíveis dos campos alterados ("📅 Prazo: 28/09/2026"). */
  changes?: string[];
}

export type ExecutionState =
  | { kind: 'executed'; record: ExecutionRecord }
  /** Pedido de escrita que NÃO executou — com a operação retida quando havia (tasks, pessoa). */
  | { kind: 'not_executed'; action: string; reason: string; taskCount?: number; targetName?: string | null };

/** Parse defensivo: metadata é jsonb livre; qualquer desvio vira null. */
export function parseExecutionRecord(raw: unknown): ExecutionRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<ExecutionRecord>;
  if (typeof r.executionId !== 'string' || typeof r.operation !== 'string') return null;
  if (!Array.isArray(r.taskIds) || !Array.isArray(r.successIds) || !Array.isArray(r.failedIds)) return null;
  if (typeof r.timestamp !== 'string') return null;
  return {
    executionId: r.executionId,
    operation: r.operation,
    taskIds: r.taskIds.filter((x): x is string => typeof x === 'string'),
    targetPerson:
      typeof r.targetPerson === 'object' && r.targetPerson !== null && typeof r.targetPerson.name === 'string'
        ? {
            name: r.targetPerson.name,
            memberId: typeof r.targetPerson.memberId === 'number' ? r.targetPerson.memberId : null,
            username: typeof r.targetPerson.username === 'string' ? r.targetPerson.username : null,
          }
        : null,
    successIds: r.successIds.filter((x): x is string => typeof x === 'string'),
    failedIds: r.failedIds
      .filter((x): x is { id: string; title: string; reason: string } => typeof x === 'object' && x !== null && typeof x.id === 'string')
      .map((x) => ({ id: x.id, title: typeof x.title === 'string' ? x.title : x.id, reason: typeof x.reason === 'string' ? x.reason : 'falha não detalhada' })),
    timestamp: r.timestamp,
    verification: Array.isArray(r.verification) ? (r.verification as ExecutionRecord['verification']) : [],
    ...(typeof r.selectionReason === 'string' ? { selectionReason: r.selectionReason } : {}),
    ...(typeof r.titles === 'object' && r.titles !== null ? { titles: r.titles as Record<string, string> } : {}),
    ...(Array.isArray(r.changes) ? { changes: r.changes.filter((c): c is string => typeof c === 'string') } : {}),
  };
}

interface GuardTaskRow {
  task_id?: string | null;
  title?: string;
  status?: string;
  assignee?: string | null;
  assignee_requested?: string | null;
  blocked_by?: string | null;
  error?: string | null;
}

/**
 * Traduz a metadata de UM recibo do guard pro estado de execução. Cobre tanto
 * o formato estruturado novo (`execucao`) quanto os recibos históricos
 * (`create_tasks`, updates singulares, bloqueios) — a pergunta "já lançou?"
 * vale pra qualquer um deles.
 */
export function executionStateFromGuardMetadata(metadata: Record<string, unknown>): ExecutionState | null {
  const estruturado = parseExecutionRecord(metadata.execucao);
  if (estruturado) return { kind: 'executed', record: estruturado };

  if (metadata.guard !== 'bento-action') return null;
  const action = typeof metadata.action === 'string' ? metadata.action : '';

  if (action === 'blocked_write_authz' || action === 'blocked_client_unresolved' || action === 'denied_cross_client_target') {
    /**
     * A operação BLOQUEADA fica retida (24/09/2026): "já fez?" depois de uma
     * recusa de permissão responde com o conjunto e a pessoa que continuam sem
     * alteração — nunca "de qual cliente?".
     */
    const bloqueada = metadata.blocked_operation as { taskIds?: unknown; targetPerson?: unknown } | undefined;
    const taskCount = Array.isArray(bloqueada?.taskIds) ? bloqueada.taskIds.length : undefined;
    const targetName = typeof bloqueada?.targetPerson === 'string' ? bloqueada.targetPerson : null;
    return {
      kind: 'not_executed',
      action,
      reason:
        action === 'blocked_write_authz'
          ? 'esta conta não tem permissão de escrita no ClickUp'
          : typeof metadata.write_reason === 'string'
            ? metadata.write_reason
            : 'escrita não autorizada neste turno',
      ...(taskCount ? { taskCount } : {}),
      ...(targetName ? { targetName } : {}),
    };
  }
  if (action === 'multi_action_plan_only') {
    return { kind: 'not_executed', action, reason: 'o plano foi montado mas a criação em lote estava represada; nada foi lançado' };
  }
  if (action === 'delete_pending_confirmation') {
    return { kind: 'not_executed', action, reason: 'a exclusão está esperando sua confirmação; nada foi apagado' };
  }

  if (action === 'create_tasks' && Array.isArray(metadata.tasks)) {
    const rows = metadata.tasks as GuardTaskRow[];
    const successIds = rows.filter((r) => r.status === 'created' || r.status === 'duplicate').map((r) => r.task_id).filter((x): x is string => Boolean(x));
    const failedIds = rows
      .filter((r) => r.status === 'failed' || r.status === 'blocked')
      .map((r) => ({ id: r.task_id ?? '', title: r.title ?? '(sem título)', reason: r.error ?? r.blocked_by ?? 'não criada' }));
    const titles: Record<string, string> = {};
    for (const r of rows) if (r.task_id && r.title) titles[r.task_id] = r.title;
    const firstAssignee = rows.find((r) => r.assignee)?.assignee ?? null;
    return {
      kind: 'executed',
      record: {
        executionId: typeof metadata.intent_classification === 'string' ? `guard:${metadata.intent_classification}` : 'guard:create_tasks',
        operation: 'create_tasks',
        taskIds: rows.map((r) => r.task_id).filter((x): x is string => Boolean(x)),
        targetPerson: firstAssignee ? { name: firstAssignee, memberId: null, username: firstAssignee } : null,
        successIds,
        failedIds,
        timestamp: new Date(0).toISOString(),
        verification: [],
        titles,
      },
    };
  }

  const singleActions = new Set(['update_assignee', 'update_due', 'update_status', 'update_brief', 'update_title', 'update_priority', 'comment', 'delete']);
  if (singleActions.has(action) && typeof metadata.task_id === 'string') {
    // Sucesso exige verified === true EXPLÍCITO: uma resposta de falha do
    // guard (ex: ClickUp recusou) não traz `verified`, e tratar ausência como
    // sucesso seria exatamente a falsa confirmação que este módulo existe pra
    // impedir.
    const ok = metadata.verified === true;
    return {
      kind: 'executed',
      record: {
        executionId: `guard:${action}`,
        operation: action,
        taskIds: [metadata.task_id],
        targetPerson: typeof metadata.assignee === 'string' ? { name: metadata.assignee, memberId: null, username: metadata.assignee } : null,
        successIds: ok ? [metadata.task_id] : [],
        failedIds: ok ? [] : [{ id: metadata.task_id, title: metadata.task_id, reason: 'a releitura não confirmou a alteração' }],
        timestamp: new Date(0).toISOString(),
        verification: [],
      },
    };
  }

  /**
   * QUALQUER outro recibo do guard sem escrita autorizada é um NÃO honesto:
   * pessoa não encontrada, referência sem alvo, operação não reconhecida.
   * Sem este fallback genérico, "já lançou pro Pedro no ClickUp?" depois de
   * um bloqueio desses caía no serviço remoto sem memória e voltava "De qual
   * cliente você quer saber as tasks?" — a falha de continuidade medida no
   * aceite ao vivo de 24/09/2026 (QA3).
   */
  if (metadata.write_authorized !== true) {
    const reason =
      typeof metadata.write_reason === 'string'
        ? metadata.write_reason
        : action === 'assignee_nao_encontrado'
          ? 'a pessoa não foi encontrada entre os membros do ClickUp'
          : action === 'assignee_ambiguo'
            ? 'o nome casou com mais de uma pessoa no ClickUp'
            : action === 'selection_assignee_missing'
              ? 'faltou o nome da pessoa pra quem atribuir'
              : action === 'selection_reference_unresolved'
                ? 'a referência não apontava pra nenhuma task da seleção'
                : 'a escrita não foi autorizada neste turno';
    return { kind: 'not_executed', action, reason };
  }

  return null;
}

/** O estado de execução MAIS RECENTE da conversa, lido dos recibos gravados. */
export async function loadLatestExecutionState(conversationId: string): Promise<ExecutionState | null> {
  const linhas = (await db
    .select({ metadata: schema.messages.metadata })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(20)
    .catch(() => [])) as Array<{ metadata: Record<string, unknown> | null }>;
  for (const linha of linhas) {
    if (!linha.metadata) continue;
    const estado = executionStateFromGuardMetadata(linha.metadata);
    if (estado) return estado;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* DETECÇÃO DA PERGUNTA DE STATUS                                      */
/* ------------------------------------------------------------------ */

function plano(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const STATUS_PATTERNS: RegExp[] = [
  // "já lançou pro pedro?", "já criou?", "já atribuiu?"
  /\bja\b[^?]{0,60}\b(lancou|criou|atribuiu|subiu|mandou|colocou|registrou|fez|encaminhou|lancaram|criaram|atribuiram|atualizou|alterou|mudou|trocou|editou|corrigiu)\b/,
  // "deu certo?", "deu erro?", "deu problema?"
  /\bdeu (certo|errado|erro|problema)\b/,
  // "conseguiu lançar?", "você conseguiu?"
  /\bconseguiu\b/,
  // "foi lançado?", "foi pro clickup?", "tá no clickup?"
  /\b(foi|ta|esta|estao|estão)\b[^?]{0,40}\b(lancad|criad|atribuid|registrad|no clickup|pro clickup)/,
  // "qual falhou?", "o que falhou?", "quais falharam?", "qual delas deu problema?"
  /\b(qual|quais|oque|o que)\b[^?]{0,30}\b(falhou|falharam|problema|errado)\b/,
  // "qual não foi?", "quais não foram?"
  /\b(qual|quais)\b[^?]{0,20}\b(nao foi|não foi|nao foram|não foram)\b/,
  // "quem ficou responsável?", "quem ficou com elas?", "quem tá responsável agora?"
  /\bquem (ficou|tá|ta|esta|está|eh|é)\b[^?]{0,30}\b(respons|com el)/,
  // "por que não foi?", "por que deu errado?"
  /\bpor (que|quê)\b[^?]{0,25}\b(falhou|nao foi|não foi|errado|problema)\b/,
  // "já fez?" / "já era?" — curtas demais pra ter outro sentido neste contexto
  /^(?:e\s+)?já (fez|era|foi)\s*\??$/,
  // "qual era a task que a gente alterou?" / "o que você mudou?" / "qual prazo ficou?"
  /\b(qual|que|o que)\b[^?]{0,40}\b(task|tarefa|prazo|status|responsavel|responsável)\b[^?]{0,30}\b(alter|mud|edit|troc|atualiz|mex|ficou|era|foi)\b/,
  /\bque a gente (alterou|mudou|editou|trocou|atualizou|mexeu)\b/,
  /\bo que (voce|você|vc) (alterou|mudou|fez|editou|trocou)\b/,
];

/**
 * Pergunta sobre o ESTADO de uma ação que o turno anterior devia ter
 * executado. Curta e interrogativa por desenho: frase longa com esses verbos
 * é quase sempre um pedido novo, não uma checagem.
 */
export function detectExecutionStatusQuestion(message: string): boolean {
  const t = plano((message.split(/\n-{3,}\n/)[0] ?? message).trim());
  if (t.length === 0 || t.length > 200) return false;
  return STATUS_PATTERNS.some((re) => re.test(t));
}

/* ------------------------------------------------------------------ */
/* RESPOSTA                                                            */
/* ------------------------------------------------------------------ */

function horarioLegivel(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return null;
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d);
  return `${data} às ${hora}`;
}

function tituloDe(rec: ExecutionRecord, id: string): string {
  return rec.titles?.[id] ?? rec.failedIds.find((f) => f.id === id)?.title ?? id;
}

function verboDaOperacao(rec: ExecutionRecord, plural = true): string {
  const nome = rec.targetPerson ? (rec.targetPerson.username ?? rec.targetPerson.name) : null;
  const alvo = nome ? (plural ? ` e atribuídas a ${nome}` : ` e atribuída a ${nome}`) : '';
  switch (rec.operation) {
    case 'briefing_assign':
      return plural ? `receberam briefing detalhado em comentário${alvo}` : `recebeu briefing detalhado em comentário${alvo}`;
    case 'assign':
      return plural ? `foram atribuídas a ${nome}` : `foi atribuída a ${nome}`;
    case 'create_tasks':
      return (plural ? 'foram criadas' : 'foi criada') + alvo;
    case 'update':
      return plural ? 'foram atualizadas' : 'foi atualizada';
    default:
      return plural ? 'foram alteradas' : 'foi alterada';
  }
}

/**
 * YES / PARTIAL / NO a partir do registro, nunca da intenção. A frase carrega
 * os números reais e, na falha, os motivos reais. Formato (adendo visual de
 * 24/09/2026): resposta PROPORCIONAL à pergunta — follow-up curto recebe
 * veredito de uma linha; falhas vêm nomeadas com emoji funcional, nunca dump.
 */
export function answerFromExecutionState(estado: ExecutionState, message: string): string {
  if (estado.kind === 'not_executed') {
    // A recusa retém a operação: a resposta diz O QUE continua igual, com a
    // contagem e a pessoa quando existem — nunca "de qual cliente?".
    const alvo = estado.taskCount
      ? `As ${estado.taskCount} tasks${estado.targetName ? ` (destino: ${estado.targetName})` : ''} continuam sem alteração`
      : 'Nada foi criado nem modificado no ClickUp';
    return `🔒 Não. ${alvo}: ${estado.reason}.`;
  }
  const rec = estado.record;
  const total = rec.successIds.length + rec.failedIds.length;
  const quando = horarioLegivel(rec.timestamp);
  const t = plano(message);

  // "qual falhou?" / "qual deu problema?" / "por que não foi?" merecem a
  // lista das falhas (com motivo), não o resumo.
  if (/\b(falhou|falharam|problema|errado)\b|\bpor (que|quê)\b|\b(nao|não) (foi|foram)\b/.test(t)) {
    if (rec.failedIds.length === 0) {
      return `✅ Nenhuma. As ${rec.successIds.length} tasks ${verboDaOperacao(rec)} no ClickUp, conferidas por releitura${quando ? ` em ${quando}` : ''}.`;
    }
    const lista = rec.failedIds.map((f) => `❌ "${f.title}" — ${f.reason}`).join('\n');
    return `⚠️ ${rec.failedIds.length} de ${total} com problema:\n\n${lista}\n\n✅ As outras ${rec.successIds.length} foram confirmadas por releitura.`;
  }

  // "qual era a task que a gente alterou?" / "como ficou?" — identidade e
  // campos do registro, com os valores legíveis gravados na execução.
  if (/\b(qual|que|o que)\b[^?]{0,40}\b(task|tarefa|prazo|status|responsavel)\b[^?]{0,30}\b(alter|mud|edit|troc|atualiz|mex|ficou|era|foi)\b|\bque a gente (alterou|mudou|editou|trocou|atualizou|mexeu)\b|\bo que (voce|vc) (alterou|mudou|fez|editou|trocou)\b/.test(t)) {
    const titulos = rec.taskIds.map((id) => `"${tituloDe(rec, id)}"`).join(', ');
    const campos = rec.changes?.length ? `\n\n${rec.changes.join('\n')}` : '';
    return `📌 ${rec.taskIds.length > 1 ? 'As tasks mexidas' : 'A task mexida'}: ${titulos}${campos}\n\n🔄 Conferido por releitura${quando ? ` em ${quando}` : ''}.`;
  }

  // "quem ficou responsável?" / "quem tá responsável agora?" apontam pra
  // pessoa, não pra contagem.
  if (/\bquem (ficou|tá|ta|esta|está|eh|é)\b/.test(t)) {
    if (!rec.targetPerson) return 'Nenhuma atribuição de responsável foi feita nesta conversa até agora.';
    const nome = rec.targetPerson.username ?? rec.targetPerson.name;
    return rec.failedIds.length === 0
      ? `👤 ${nome} — ${rec.successIds.length > 1 ? `pelas ${rec.successIds.length} tasks` : 'pela task'}, conferido por releitura no ClickUp${quando ? ` em ${quando}` : ''}.`
      : `👤 ${nome} em ${rec.successIds.length} de ${total} tasks.\n❌ Não consegui atribuir ${rec.failedIds.length}: ${rec.failedIds.map((f) => `"${f.title}"`).join(', ')}.`;
  }

  // O resumo: YES / PARTIAL / NO, proporcional à pergunta curta.
  if (rec.successIds.length === 0) {
    const lista = rec.failedIds.map((f) => `❌ "${f.title}" — ${f.reason}`).join('\n');
    return `❌ Não. Tentei executar, mas nenhuma das ${rec.failedIds.length} tasks foi alterada no ClickUp:\n\n${lista}`;
  }
  if (rec.failedIds.length === 0) {
    const plural = rec.successIds.length > 1;
    return `✅ Sim. ${plural ? `As ${rec.successIds.length} tasks` : 'A task'} ${verboDaOperacao(rec, plural)} no ClickUp e ${plural ? 'foram conferidas' : 'foi conferida'} por releitura${quando ? ` em ${quando}` : ''}.`;
  }
  const lista = rec.failedIds.map((f) => `❌ "${tituloDe(rec, f.id)}" — ${f.reason}`).join('\n');
  return `⚠️ Parcialmente.\n\n✅ ${rec.successIds.length} de ${total} ${verboDaOperacao(rec)} (conferidas por releitura)\n${lista}`;
}

/**
 * Mesma operação, mesmo conjunto, mesma pessoa, tudo confirmado: reexecutar
 * seria a mutação DUPLICADA que corrompe o histórico. O chamador responde do
 * registro em vez de escrever de novo.
 */
export function sameExecutionAlreadyDone(
  rec: ExecutionRecord,
  params: { operation: string; taskIds: string[]; memberId: number | null },
): boolean {
  if (rec.operation !== params.operation) return false;
  if (rec.failedIds.length > 0) return false;
  if (params.memberId !== null && rec.targetPerson?.memberId !== null && rec.targetPerson?.memberId !== params.memberId) return false;
  const feitos = new Set(rec.successIds);
  return params.taskIds.length > 0 && params.taskIds.every((id) => feitos.has(id));
}
