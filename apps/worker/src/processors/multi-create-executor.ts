import {
  createAttributedTask,
  createTaskComment,
  findDuplicateTask,
  getTask,
  getTaskComments,
  getTaskListId,
  queryOperationTasks,
  resolveMemberByName,
  updateTask,
  verifyTaskState,
  WriteScopeError,
  type ClickUpConfig,
  type ExpectedTaskState,
  type MemberResolution,
  type TaskVerification,
} from '@desigual-os/tool-gateway';
import type { PlannedTask } from './operational-action-plan';

/**
 * multi-create-executor.ts — PREPARE → PERMISSION → IDEMPOTÊNCIA → EXECUTE →
 * READ-BACK → VERIFY → OUTCOME, uma vez por task planejada.
 *
 * A regra que não se negocia: o Bento só diz "criei" depois de RELER. O POST
 * do ClickUp responder 200 não é prova de que a task existe com o responsável
 * certo na lista certa — é prova de que o POST foi aceito. Toda a diferença
 * entre um recibo e uma promessa está no read-back.
 *
 * A outra regra é sobre o que BLOQUEIA. Falta de asset não bloqueia: a task
 * nasce com a pendência escrita nela, porque o trabalho de montar a demanda
 * pode começar sem o arquivo-base e a pessoa que pediu já sabe disso. O que
 * bloqueia é o que tornaria a escrita ERRADA: pessoa citada e não resolvida,
 * cliente não resolvido, escopo de escrita fechado.
 */

export interface CreateOneInput {
  planned: PlannedTask;
  title: string;
  /** Markdown do briefing, quando houver. Vai como comentário na task. */
  briefing: string | null;
  description: string;
  dueDate: number | null;
}

export type CreateBlockReason = 'PERSON_NOT_FOUND' | 'PERSON_AMBIGUOUS';

export interface CreateOutcome {
  title: string;
  deliverable: string | null;
  /** created = existe e foi relida. Nada além disso pode ser chamado de feito. */
  status: 'created' | 'duplicate' | 'blocked' | 'failed';
  taskId: string | null;
  url: string | null;
  assigneeName: string | null;
  assigneeUsername: string | null;
  assigneeId: number | null;
  blockedBy: CreateBlockReason | null;
  /** Candidatos quando o nome é ambíguo — a pergunta de desambiguação sai daqui. */
  candidates: string[];
  briefingAttached: boolean;
  briefingVerified: boolean;
  verified: boolean;
  listAsserted: boolean;
  mismatches: string[];
  error: string | null;
  toolCalls: Array<{ tool: string; input_summary: string; ok: boolean; error?: string }>;
}

export interface CreateDeps {
  resolveMember: typeof resolveMemberByName;
  listTasks: typeof queryOperationTasks;
  createTask: typeof createAttributedTask;
  assign: typeof updateTask;
  comment: typeof createTaskComment;
  readTask: typeof getTask;
  readComments: typeof getTaskComments;
  readListId: typeof getTaskListId;
}

export const defaultCreateDeps: CreateDeps = {
  resolveMember: resolveMemberByName,
  listTasks: queryOperationTasks,
  createTask: createAttributedTask,
  assign: updateTask,
  comment: createTaskComment,
  readTask: getTask,
  readComments: getTaskComments,
  readListId: getTaskListId,
};

function vazio(title: string, planned: PlannedTask): CreateOutcome {
  return {
    title,
    deliverable: planned.deliverable,
    status: 'failed',
    taskId: null,
    url: null,
    assigneeName: planned.assigneeName,
    assigneeUsername: null,
    assigneeId: null,
    blockedBy: null,
    candidates: [],
    briefingAttached: false,
    briefingVerified: false,
    verified: false,
    listAsserted: false,
    mismatches: [],
    error: null,
    toolCalls: [],
  };
}

/**
 * Executa UMA criação com verificação. As dependências são injetáveis porque é
 * assim que a idempotência, o bloqueio por pessoa e a falha de read-back são
 * provados em teste — sem tocar no ClickUp de ninguém.
 */
export async function createOneTask(
  config: ClickUpConfig,
  listId: string,
  requester: { name: string; clickUpEmail: string | null },
  input: CreateOneInput,
  deps: CreateDeps = defaultCreateDeps,
): Promise<CreateOutcome> {
  const out = vazio(input.title, input.planned);
  const record = (tool: string, input_summary: string, ok: boolean, error?: string) => {
    out.toolCalls.push({ tool, input_summary, ok, ...(error ? { error } : {}) });
  };

  try {
    // 1. PESSOA. Citada e não resolvida é BLOQUEIO: criar sem responsável
    // depois de "lance pro Gui" entrega menos do que foi pedido e finge que
    // entregou tudo. Sem nome citado, segue sem responsável — é o que o
    // pedido disse.
    let membro: MemberResolution | null = null;
    if (input.planned.assigneeName) {
      membro = await deps.resolveMember(config, input.planned.assigneeName);
      record('clickup.resolve_member', input.planned.assigneeName, membro.status === 'resolved');
      if (membro.status === 'ambiguous') {
        out.status = 'blocked';
        out.blockedBy = 'PERSON_AMBIGUOUS';
        out.candidates = membro.candidates.map((c) => c.username);
        return out;
      }
      if (membro.status === 'not_found') {
        out.status = 'blocked';
        out.blockedBy = 'PERSON_NOT_FOUND';
        return out;
      }
      out.assigneeId = membro.member.id;
      out.assigneeUsername = membro.member.username;
    }

    // 2. IDEMPOTÊNCIA. Cobre o retry depois de timeout (o create anterior pode
    // ter gravado) e o mesmo pedido enviado duas vezes — que foi exatamente o
    // que a Tammy fez: três mensagens idênticas em 17/09. Falha de consulta
    // não impede criar; só perde a proteção neste turno.
    const existentes = await deps
      .listTasks(config, { listIds: [listId], includeClosed: false })
      .then((page) => page.tasks)
      .catch(() => []);
    const duplicada = findDuplicateTask(existentes, input.title);
    if (duplicada) {
      record('clickup.idempotency_hit', duplicada.id, true);
      out.status = 'duplicate';
      out.taskId = duplicada.id;
      out.url = `https://app.clickup.com/t/${duplicada.id}`;
      return out;
    }

    // 3. CRIA.
    const created = await deps.createTask(config, {
      listId,
      name: input.title,
      description: input.description,
      requesterName: requester.name,
      requesterClickUpEmail: requester.clickUpEmail,
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    });
    record('clickup.create_task', input.title, true);
    out.taskId = created.id;
    out.url = created.url;

    // 4. ATRIBUI.
    if (out.assigneeId != null) {
      await deps.assign(config, created.id, { addAssignees: [out.assigneeId] });
      record('clickup.update_task', `assign ${out.assigneeUsername}`, true);
    }

    // 5. BRIEFING como comentário.
    if (input.briefing && input.briefing.trim().length > 0) {
      await deps.comment(config, created.id, input.briefing);
      record('clickup.create_comment', `briefing -> ${created.id}`, true);
      out.briefingAttached = true;
    }

    // 6. READ-BACK. A partir daqui nada é afirmado sem leitura.
    const expected: ExpectedTaskState = {
      name: input.title,
      ...(out.assigneeId != null ? { assigneeIds: [out.assigneeId] } : {}),
      ...(input.dueDate ? { dueDate: input.dueDate, dueDateGranularity: 'day' as const } : {}),
    };
    let verif: TaskVerification | null = null;
    try {
      verif = verifyTaskState(await deps.readTask(config, created.id), expected);
    } catch (error) {
      record('clickup.get_task', `read-back ${created.id}`, false, error instanceof Error ? error.message : String(error));
    }
    out.verified = verif?.ok ?? false;
    out.mismatches = verif?.mismatches ?? ['não consegui reler a task pra confirmar'];
    if (verif) record('clickup.get_task', `read-back ${created.id}`, verif.ok, verif.mismatches.join('; ') || undefined);

    // A task nasceu MESMO na lista do cliente resolvido? Criar no lugar certo
    // é metade do trabalho; provar que caiu lá é a outra metade.
    try {
      const listaReal = await deps.readListId(config, created.id);
      out.listAsserted = listaReal === listId;
      record('clickup.assert_list', `lista ${listaReal} esperada ${listId}`, out.listAsserted);
    } catch {
      out.listAsserted = false;
      record('clickup.assert_list', 'não consegui reler a lista da task', false);
    }

    if (out.briefingAttached) {
      const comentarios = await deps.readComments(config, created.id).catch(() => []);
      out.briefingVerified = comentarios.length > 0;
      record('clickup.get_comments', `read-back comments ${created.id}`, out.briefingVerified);
    }

    out.status = 'created';
    return out;
  } catch (error) {
    if (error instanceof WriteScopeError) {
      out.status = 'blocked';
      out.error = `BLOQUEADA pela cerca de escopo: ${error.message}`;
      record('clickup.write_scope', error.message, false, error.message);
      return out;
    }
    out.status = 'failed';
    out.error = error instanceof Error ? error.message : String(error);
    record('clickup.create_task', input.title, false, out.error);
    return out;
  }
}

/**
 * EXECUÇÃO PARCIAL É SUCESSO PARCIAL, não fracasso total.
 *
 * Quando uma das duas tasks tem a pessoa resolvida e a outra não, a primeira é
 * criada e a segunda volta como pergunta. Responder "não posso fazer nada"
 * porque um item do pedido travou é o comportamento que fazia a operação
 * parar inteira por causa de um nome ambíguo.
 */
export async function createManyTasks(
  config: ClickUpConfig,
  listId: string,
  requester: { name: string; clickUpEmail: string | null },
  inputs: CreateOneInput[],
  deps: CreateDeps = defaultCreateDeps,
): Promise<CreateOutcome[]> {
  const outcomes: CreateOutcome[] = [];
  for (const input of inputs) {
    outcomes.push(await createOneTask(config, listId, requester, input, deps));
  }
  return outcomes;
}
