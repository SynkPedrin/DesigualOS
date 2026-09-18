import {
  createAttributedTask,
  createTaskComment,
  findDuplicateTask,
  getTask,
  normalizeTaskName,
  getTaskComments,
  getTaskListId,
  queryOperationTasks,
  resolveMemberByName,
  updateTask,
  uploadTaskAttachment,
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

/** Material que a solicitante mandou junto do pedido (print, PDF, referência). */
export interface TaskAttachment {
  url: string;
  filename: string;
  contentType: string | null;
  /** true quando veio de uma mensagem ANTERIOR ("o print que mandei"). */
  fromPreviousTurn?: boolean;
}

export interface CreateOneInput {
  planned: PlannedTask;
  title: string;
  /** Markdown do briefing, quando houver. Vai como comentário na task. */
  briefing: string | null;
  description: string;
  dueDate: number | null;
  /** Anexos da solicitação. SEMPRE viram referência; upload é best-effort. */
  attachments?: TaskAttachment[];
}

/**
 * O que aconteceu com CADA material — e a diferença importa na hora de falar.
 * `referenced` = o link está no corpo da task, conferido por leitura.
 * `uploaded`   = o arquivo está anexado no ClickUp, conferido por leitura.
 * Dizer "anexei" quando só houve link é mentir sobre o que a pessoa vai
 * encontrar quando abrir a task.
 */
export interface AttachmentOutcome {
  filename: string;
  url: string;
  referenced: boolean;
  uploaded: boolean;
  error: string | null;
}

/**
 * BLOCO DE REFERÊNCIAS. Vai no corpo da task porque é lá que quem executa
 * procura o material — e porque é texto, sobrevive a qualquer falha de upload.
 */
export function blocoDeReferencias(attachments: TaskAttachment[]): string {
  if (attachments.length === 0) return '';
  const linhas = ['REFERÊNCIAS / MATERIAIS'];
  for (const a of attachments) {
    const origem = a.fromPreviousTurn ? ' (enviado na solicitação anterior)' : '';
    linhas.push(`- ${a.filename}${origem} — ${a.url}`);
  }
  return linhas.join('\n');
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
  /**
   * A chave que decide se isto é a MESMA demanda de antes: título normalizado
   * dentro da lista de destino. Vai pro trace porque, quando a Tammy reenvia
   * "não foi, cria de novo", o que explica a decisão é ver a chave que casou.
   */
  idempotencyKey: string;
  briefingAttached: boolean;
  briefingVerified: boolean;
  /** Um resultado por material, com o que foi CONFIRMADO por leitura. */
  attachments: AttachmentOutcome[];
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
  uploadAttachment: typeof uploadTaskAttachment;
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
  uploadAttachment: uploadTaskAttachment,
  readTask: getTask,
  readComments: getTaskComments,
  readListId: getTaskListId,
};

function vazio(title: string, planned: PlannedTask, listId: string): CreateOutcome {
  return {
    title,
    idempotencyKey: `${listId}:${normalizeTaskName(title)}`,
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
    attachments: [],
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
  const out = vazio(input.title, input.planned, listId);
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

    // 2. IDEMPOTÊNCIA COM JANELA. Cobre o retry depois de timeout e a mesma
    // demanda reenviada em sequência — o caso real foram três envios em 73
    // minutos. FORA da janela, o mesmo título é uma demanda NOVA: "cria o
    // layout pro Gui" hoje e amanhã são trabalhos diferentes, e barrar o
    // segundo por causa do nome é o bug que a bateria de aceite pegou em
    // 18/09/2026 (dedup contra task de ontem bloqueou uma demanda legítima).
    // Task sem createdAt legível não entra na proteção: fail-open pra demanda
    // legítima, e o retry real sempre tem createdAt.
    const JANELA_IDEMPOTENCIA_MS = 2 * 60 * 60 * 1000;
    const agora = Date.now();
    const existentes = await deps
      .listTasks(config, { listIds: [listId], includeClosed: false })
      .then((page) => page.tasks)
      .catch(() => []);
    const recentes = existentes.filter((t) => t.createdAt !== null && agora - t.createdAt < JANELA_IDEMPOTENCIA_MS);
    const duplicada = findDuplicateTask(recentes, input.title);
    if (duplicada) {
      record('clickup.idempotency_hit', duplicada.id, true);
      out.status = 'duplicate';
      out.taskId = duplicada.id;
      out.url = `https://app.clickup.com/t/${duplicada.id}`;
      return out;
    }

    // 3. CRIA. O bloco de REFERÊNCIAS entra no corpo já na criação: é texto,
    // então sobrevive a qualquer falha de upload e é o que garante que o
    // material nunca se perde entre o chat e a task.
    const anexos = input.attachments ?? [];
    const referencias = blocoDeReferencias(anexos);
    const created = await deps.createTask(config, {
      listId,
      name: input.title,
      description: [input.description, referencias].filter((p) => p && p.length > 0).join('\n\n'),
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

    // 6. ANEXO DE VERDADE — best-effort, reusando o upload que já existe no
    // gateway. Falhar aqui NÃO é falha da task: a referência já está no corpo
    // e a pessoa chega no material do mesmo jeito. O que não pode acontecer é
    // o recibo dizer "anexei" por causa de uma tentativa.
    out.attachments = anexos.map((a) => ({ filename: a.filename, url: a.url, referenced: false, uploaded: false, error: null }));
    for (const alvo of out.attachments) {
      try {
        await deps.uploadAttachment(config, created.id, alvo.url, alvo.filename);
        record('clickup.attach_file', alvo.filename, true);
      } catch (error) {
        alvo.error = error instanceof Error ? error.message : String(error);
        record('clickup.attach_file', alvo.filename, false, alvo.error);
      }
    }

    // 7. READ-BACK. A partir daqui nada é afirmado sem leitura.
    const expected: ExpectedTaskState = {
      name: input.title,
      ...(out.assigneeId != null ? { assigneeIds: [out.assigneeId] } : {}),
      ...(input.dueDate ? { dueDate: input.dueDate, dueDateGranularity: 'day' as const } : {}),
    };
    let verif: TaskVerification | null = null;
    try {
      const relida = await deps.readTask(config, created.id);
      verif = verifyTaskState(relida, expected);
      // O que a task REALMENTE tem: link no corpo e/ou arquivo anexado. É
      // daqui, e só daqui, que sai a frase do recibo sobre material.
      for (const alvo of out.attachments) {
        alvo.referenced = relida.description.includes(alvo.url);
        alvo.uploaded = relida.attachments.some((x) => (x.title ?? '') === alvo.filename);
      }
      record('clickup.readback_attachments', `${out.attachments.filter((a) => a.referenced).length} referência(s), ${out.attachments.filter((a) => a.uploaded).length} anexo(s)`, true);
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
