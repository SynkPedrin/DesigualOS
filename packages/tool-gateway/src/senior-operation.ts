import { createTask, findMemberByEmail, getTask, type ClickUpConfig, type CreatedTask, type TaskDetail } from './clickup-client';
import { queryOperationTasks } from './clickup-operation';
import { findDuplicateTask } from './task-verification';
import { verifyTaskState, type ExpectedTaskState, type TaskVerification } from './task-verification';

export type SeniorAgent = 'bento' | 'otto';

export interface SeniorToolContext {
  executionId: string;
  userId: string;
  organizationId: string;
  permissions: ReadonlyArray<{ resource: string; action: string }>;
  agent: SeniorAgent;
}

export interface VerifiedTaskResult {
  success: true;
  resourceId: string;
  resourceUrl: string;
  verified: true;
  data: TaskDetail;
  assignedTo: { id: number; username: string } | null;
  /**
   * true quando esta chamada encontrou uma task já existente (mesma lista,
   * mesmo nome) e devolveu ela em vez de criar outra — nunca invenção, é o
   * próprio ramo de idempotência abaixo. Sem este campo o caller não tinha
   * como saber se acabou de CRIAR ou só CONFIRMOU algo que já existia, e a
   * resposta pro usuário dizia "criei a task" para uma task que já existia
   * há horas (achado real, 21/09/2026).
   */
  wasExisting: boolean;
}

export interface SeniorOperationError {
  success: false;
  errorCode: 'permission_denied' | 'mutation_budget_exceeded' | 'assignee_not_found' | 'assignee_ambiguous' | 'write_failed' | 'verification_failed';
  message: string;
  retryable: boolean;
  candidates?: Array<{ id: number; username: string; email: string }>;
}

export type SeniorTaskResult = VerifiedTaskResult | SeniorOperationError;

export function maxMutationsPerExecution(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.MAX_MUTATIONS_PER_EXECUTION ?? 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 10;
}

export class MutationBudget {
  private used = 0;
  constructor(private readonly limit = maxMutationsPerExecution()) {}
  consume(): boolean { if (this.used >= this.limit) return false; this.used += 1; return true; }
  get remaining(): number { return this.limit - this.used; }
}

export interface CreateSeniorTaskParams {
  listId: string;
  name: string;
  description: string;
  assigneeName?: string;
  assigneeEmail?: string;
  expected?: Omit<ExpectedTaskState, 'name' | 'assigneeIds'>;
  priority?: 1 | 2 | 3 | 4;
  dueDate?: number;
  tags?: string[];
}

function permitted(context: SeniorToolContext): boolean {
  return context.permissions.some((p) => p.resource === 'clickup' && p.action === 'write');
}

/**
 * Single write primitive for senior agents. Tenant identity is carried in the
 * trusted context for audit/caller policy; it is never read from model input.
 * The ClickUp workspace/list binding must be established by the caller before
 * invoking this primitive.
 */
export async function createVerifiedSeniorTask(
  config: ClickUpConfig,
  context: SeniorToolContext,
  params: CreateSeniorTaskParams,
  budget?: MutationBudget,
): Promise<SeniorTaskResult> {
  if (!permitted(context)) return { success: false, errorCode: 'permission_denied', message: 'clickup:write is required', retryable: false };
  if (budget && !budget.consume()) return { success: false, errorCode: 'mutation_budget_exceeded', message: 'Mutation budget exceeded for this execution', retryable: false };

  let assignee: { id: number; username: string; email: string } | null = null;
  if (params.assigneeEmail) {
    const member = await findMemberByEmail(config, params.assigneeEmail);
    if (!member) return { success: false, errorCode: 'assignee_not_found', message: `No ClickUp member matches ${params.assigneeEmail}`, retryable: false };
    assignee = member;
  }
  if (params.assigneeName) {
    // Name resolution is intentionally done through the typed resolver so an
    // ambiguous first name cannot silently select the wrong collaborator.
    const { resolveMemberByName } = await import('./clickup-client');
    const resolution = await resolveMemberByName(config, params.assigneeName);
    if (resolution.status === 'not_found') return { success: false, errorCode: 'assignee_not_found', message: `No ClickUp member matches ${params.assigneeName}`, retryable: false };
    if (resolution.status === 'ambiguous') return { success: false, errorCode: 'assignee_ambiguous', message: `More than one ClickUp member matches ${params.assigneeName}`, retryable: false, candidates: resolution.candidates };
    assignee = resolution.member;
  }

  // The retry can arrive after ClickUp committed the POST but before the
  // caller received its response. Resolve that window before creating again.
  // The list is already tenant-bound by the caller and the exact title is the
  // idempotency key for this senior operation.
  //
  // P1-01 (release readiness audit, 22/09/2026): a versão anterior tratava
  // FALHA da própria checagem de duplicata (`.catch(() => null)`) como
  // "nenhuma duplicata encontrada" — um timeout/rate-limit no ClickUp virava
  // silenciosamente uma SEGUNDA task real. "RECONCILE FIRST" antes de
  // repetir cegamente: sem conseguir provar que não existe duplicata, o
  // caller recebe um erro retryable, nunca uma criação no escuro.
  let existing: ReturnType<typeof findDuplicateTask>;
  try {
    const page = await queryOperationTasks(config, { listIds: [params.listId], includeClosed: false });
    existing = findDuplicateTask(page.tasks, params.name);
  } catch (error) {
    return {
      success: false,
      errorCode: 'write_failed',
      message: `Não consegui checar duplicata antes de criar: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    };
  }
  if (existing) {
    const actual = await getTask(config, existing.id);
    const expected: ExpectedTaskState = { name: params.name, ...(assignee ? { assigneeIds: [assignee.id] } : {}), ...(params.expected ?? {}) };
    if (params.dueDate !== undefined) {
      expected.dueDate = params.dueDate;
      expected.dueDateGranularity = 'day';
    }
    const verification = verifyTaskState(actual, expected);
    if (!verification.ok) return { success: false, errorCode: 'verification_failed', message: verification.mismatches.join('; '), retryable: true };
    return { success: true, resourceId: actual.id, resourceUrl: `https://app.clickup.com/t/${actual.id}`, verified: true, data: actual, assignedTo: assignee, wasExisting: true };
  }

  let created: CreatedTask;
  try {
    created = await createTask(config, { listId: params.listId, name: params.name, description: params.description,
      ...(assignee ? { assigneeId: assignee.id } : {}), ...(params.priority !== undefined ? { priority: params.priority } : {}),
      ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}), ...(params.tags !== undefined ? { tags: params.tags } : {}) });
  } catch (error) {
    return { success: false, errorCode: 'write_failed', message: error instanceof Error ? error.message : String(error), retryable: true };
  }

  let actual: TaskDetail;
  try { actual = await getTask(config, created.id); }
  catch (error) { return { success: false, errorCode: 'verification_failed', message: `Task created but could not be verified: ${error instanceof Error ? error.message : String(error)}`, retryable: true }; }
  const expected: ExpectedTaskState = { name: params.name, ...(assignee ? { assigneeIds: [assignee.id] } : {}), ...(params.expected ?? {}) };
  const expectedDue = params.dueDate ?? params.expected?.dueDate;
  if (expectedDue !== undefined) {
    expected.dueDate = expectedDue;
    expected.dueDateGranularity = 'day';
  }
  const verification = verifyTaskState(actual, expected);
  if (!verification.ok) return { success: false, errorCode: 'verification_failed', message: verification.mismatches.join('; '), retryable: true };
  return { success: true, resourceId: created.id, resourceUrl: created.url, verified: true, data: actual, assignedTo: assignee, wasExisting: false };
}

export function seniorResultSummary(result: SeniorTaskResult): string {
  return result.success
    ? `Task ${result.resourceId} criada e verificada${result.assignedTo ? ` para ${result.assignedTo.username}` : ''}.`
    : `Ação não confirmada: ${result.message}`;
}
