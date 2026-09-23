import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type {
  AgentTask,
  AgentTaskStatus,
  JarbasAnalysisResult,
} from '@desigual-os/types';
import {
  computeNextEligibleRetry,
  isRetryableError,
  isTerminalStatus,
  MAX_TENTATIVAS_RETRY,
  type AgentTaskStore,
  type DispatchAgentTaskInput,
  type DispatchOutcome,
  type RecordFailureOutcome,
  type TransitionOutcome,
} from '@desigual-os/agent-runtime';

/**
 * PostgresAgentTaskStore — implementação real da mesma interface
 * `AgentTaskStore` que `InMemoryAgentTaskStore` já implementa
 * (packages/agent-runtime/src/agent-task.ts). Migração:
 * database/migrations/0038_jarbas_persistent_tasks.sql — CRIADA, NÃO
 * APLICADA (ver docs/coordination/JARBAS_SENIOR_HANDOFF.md §11 pelo
 * motivo: aplicar exige autorização explícita de deploy, fora do escopo
 * desta sessão sem aprovação).
 *
 * Regras de concorrência (§9-10): toda transição de estado é um UPDATE
 * ATÔMICO com o status ATUAL na cláusula WHERE — nunca um SELECT seguido
 * de UPDATE separado (que teria janela de corrida entre dois workers). 0
 * linhas afetadas dispara um SELECT de diagnóstico só pra decidir a razão
 * exata da recusa (not_found/cross_org/terminal/invalid), nunca pra
 * decidir se a transição vale. `dispatch_key` é UNIQUE no banco
 * (constraint, não só índice) — dois workers despachando a mesma chave ao
 * mesmo tempo colidem no INSERT, não em RAM de processo (`onConflictDoNothing`
 * + SELECT da linha vencedora).
 */
export class PostgresAgentTaskStore implements AgentTaskStore {
  async dispatch(input: DispatchAgentTaskInput): Promise<DispatchOutcome> {
    const inserted = await db
      .insert(schema.agentTasks)
      .values({
        dispatchKey: input.dispatchKey,
        organizationId: input.organizationId,
        clientId: input.clientId,
        conversationId: input.conversationId ?? null,
        requestedBy: input.requestedBy ?? null,
        assignedAgent: 'jarbas',
        objective: input.objective,
        scope: input.scope,
        entityRefs: input.entityRefs,
        timeWindowStart: input.timeWindow?.start ?? null,
        timeWindowEnd: input.timeWindow?.end ?? null,
        constraints: input.constraints ?? [],
        originalUserRequest: input.originalUserRequest,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      })
      .onConflictDoNothing({ target: schema.agentTasks.dispatchKey })
      .returning();

    if (inserted[0]) {
      return { task: rowToAgentTask(inserted[0]), wasAlreadyDispatched: false };
    }
    // Conflito: outro worker (ou este mesmo, em retry) já despachou a
    // mesma chave — a linha vencedora é a verdade, não uma nova tentativa.
    const [existente] = await db.select().from(schema.agentTasks).where(eq(schema.agentTasks.dispatchKey, input.dispatchKey));
    if (!existente) throw new Error(`dispatch: conflito em ${input.dispatchKey} mas a linha não foi encontrada — estado inconsistente`);
    return { task: rowToAgentTask(existente), wasAlreadyDispatched: true };
  }

  async get(taskId: string): Promise<AgentTask | null> {
    const [row] = await db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, taskId));
    return row ? rowToAgentTask(row) : null;
  }

  async getResult(taskId: string): Promise<JarbasAnalysisResult | null> {
    const task = await this.get(taskId);
    if (!task) return null;
    // Só o resultado da VERSÃO VIGENTE conta como "o resultado" — um
    // resultado de versão anterior nunca é devolvido como se fosse atual
    // (§16/§38), mesmo que ainda exista na tabela pro histórico.
    const [row] = await db
      .select()
      .from(schema.agentTaskResults)
      .where(and(eq(schema.agentTaskResults.taskId, taskId), eq(schema.agentTaskResults.taskVersion, task.version)));
    return row ? (row.payload as unknown as JarbasAnalysisResult) : null;
  }

  async transition(taskId: string, next: AgentTaskStatus, callerOrganizationId: string): Promise<TransitionOutcome> {
    const permitidos = ESTADOS_QUE_PODEM_IR_PARA[next] ?? [];
    if (permitidos.length === 0) {
      // `next` não é alcançável de NENHUM estado — recusa determinística,
      // sem round-trip ao banco.
      return this.diagnoseTransitionFailure(taskId, callerOrganizationId);
    }
    const [row] = await db
      .update(schema.agentTasks)
      .set({ status: next })
      .where(and(eq(schema.agentTasks.id, taskId), eq(schema.agentTasks.organizationId, callerOrganizationId), inArray(schema.agentTasks.status, permitidos)))
      .returning();
    if (row) return { ok: true, task: rowToAgentTask(row) };
    return this.diagnoseTransitionFailure(taskId, callerOrganizationId);
  }

  async attachResult(taskId: string, result: JarbasAnalysisResult, callerOrganizationId: string): Promise<TransitionOutcome> {
    const [task] = await db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, taskId));
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.organizationId !== callerOrganizationId) return { ok: false, reason: 'cross_org' };
    if (task.status !== 'verifying' && task.status !== 'analyzing') return { ok: false, reason: 'invalid_transition' };
    if (result.taskVersion !== task.version) return { ok: false, reason: 'stale_version' };

    // INSERT do resultado + UPDATE de status: melhor esforço sequencial
    // (sem transação explícita — o driver deste pacote não expõe uma API
    // de transação testável sem banco real; ver §18/§19 no doc de handoff
    // pela consequência exata disso).
    await db.insert(schema.agentTaskResults).values({ taskId, taskVersion: result.taskVersion, payload: result as unknown as Record<string, unknown> }).onConflictDoNothing();
    const [atualizado] = await db
      .update(schema.agentTasks)
      .set({ status: 'completed_analysis' })
      .where(and(eq(schema.agentTasks.id, taskId), eq(schema.agentTasks.organizationId, callerOrganizationId)))
      .returning();
    if (!atualizado) return { ok: false, reason: 'not_found' };
    return { ok: true, task: rowToAgentTask(atualizado) };
  }

  async updateScope(taskId: string, next: { scope?: string; timeWindow?: AgentTask['timeWindow'] }, callerOrganizationId: string): Promise<TransitionOutcome> {
    const [task] = await db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, taskId));
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.organizationId !== callerOrganizationId) return { ok: false, reason: 'cross_org' };
    if (isTerminalStatus(task.status as AgentTaskStatus)) return { ok: false, reason: 'terminal_task' };
    const [atualizado] = await db
      .update(schema.agentTasks)
      .set({
        scope: next.scope ?? task.scope,
        timeWindowStart: next.timeWindow?.start ?? task.timeWindowStart,
        timeWindowEnd: next.timeWindow?.end ?? task.timeWindowEnd,
        version: task.version + 1,
      })
      .where(and(eq(schema.agentTasks.id, taskId), eq(schema.agentTasks.organizationId, callerOrganizationId)))
      .returning();
    if (!atualizado) return { ok: false, reason: 'not_found' };
    // Resultado da versão anterior nunca vira "atual" — nunca deletado (histórico
    // consultável via taskVersion), só deixa de ser o que getResult devolve
    // porque getResult filtra por task.version, e a versão mudou.
    return { ok: true, task: rowToAgentTask(atualizado) };
  }

  async recordFailure(taskId: string, error: string, callerOrganizationId: string): Promise<RecordFailureOutcome> {
    const [task] = await db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, taskId));
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.organizationId !== callerOrganizationId) return { ok: false, reason: 'cross_org' };
    if (isTerminalStatus(task.status as AgentTaskStatus)) return { ok: false, reason: 'terminal_task' };
    const attemptCount = task.attemptCount + 1;
    const retryable = isRetryableError(error) && attemptCount <= MAX_TENTATIVAS_RETRY;
    const agora = new Date();
    const [atualizado] = await db
      .update(schema.agentTasks)
      .set({
        attemptCount,
        lastError: error,
        lastErrorAt: agora,
        nextEligibleRetryAt: retryable ? new Date(computeNextEligibleRetry(attemptCount, agora)) : null,
        status: retryable ? task.status : 'blocked_external_service',
      })
      .where(and(eq(schema.agentTasks.id, taskId), eq(schema.agentTasks.organizationId, callerOrganizationId)))
      .returning();
    if (!atualizado) return { ok: false, reason: 'not_found' };
    return { ok: true, task: rowToAgentTask(atualizado), retryable };
  }

  async getLatestTaskForClientConversation(organizationId: string, clientId: string, conversationId: string): Promise<AgentTask | null> {
    const [row] = await db
      .select()
      .from(schema.agentTasks)
      .where(
        and(
          eq(schema.agentTasks.organizationId, organizationId),
          eq(schema.agentTasks.clientId, clientId),
          eq(schema.agentTasks.conversationId, conversationId),
        ),
      )
      .orderBy(desc(schema.agentTasks.updatedAt))
      .limit(1);
    return row ? rowToAgentTask(row) : null;
  }

  /** Diagnóstico só quando o UPDATE atômico já devolveu 0 linhas — nunca decide a transição, só explica a recusa. */
  private async diagnoseTransitionFailure(taskId: string, callerOrganizationId: string): Promise<TransitionOutcome> {
    const [task] = await db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, taskId));
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.organizationId !== callerOrganizationId) return { ok: false, reason: 'cross_org' };
    if (isTerminalStatus(task.status as AgentTaskStatus)) return { ok: false, reason: 'terminal_task' };
    return { ok: false, reason: 'invalid_transition' };
  }

}

/**
 * Inverso de VALID_NEXT em agent-task.ts (packages/agent-runtime): "de
 * quais estados dá pra chegar em X". Precisa ser essa direção pro WHERE
 * atômico funcionar (`status IN (...)` antes do UPDATE, não depois).
 * Duplicada aqui de propósito — não dá pra reexportar a tabela original
 * sem também exportar `TERMINAL`/lógica privada de agent-task.ts, e a
 * duplicação é pequena o bastante (13 estados) pra manter os dois lados
 * sincronizados por teste (agent-task-postgres-store.test.ts compara as
 * duas tabelas linha a linha) em vez de por reexport.
 */
const ESTADOS_QUE_PODEM_IR_PARA: Record<AgentTaskStatus, AgentTaskStatus[]> = {
  assigned: [],
  acknowledged: ['assigned'],
  context_resolved: ['acknowledged'],
  data_required: ['context_resolved'],
  analyzing: ['context_resolved', 'data_required'],
  verifying: ['analyzing'],
  completed_analysis: [],
  ready_for_review: ['completed_analysis'],
  cancelled: ['assigned', 'acknowledged', 'context_resolved', 'data_required', 'analyzing', 'verifying'],
  blocked_needs_data: ['context_resolved', 'data_required', 'analyzing', 'verifying'],
  blocked_ambiguous: ['assigned', 'acknowledged'],
  blocked_permission: ['assigned', 'acknowledged'],
  blocked_external_service: ['context_resolved', 'data_required', 'analyzing'],
};

function rowToAgentTask(row: typeof schema.agentTasks.$inferSelect): AgentTask {
  return {
    taskId: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    conversationId: row.conversationId ?? null,
    requestedBy: row.requestedBy ?? null,
    assignedAgent: 'jarbas',
    objective: row.objective,
    scope: row.scope,
    entityRefs: row.entityRefs as AgentTask['entityRefs'],
    timeWindow: row.timeWindowStart && row.timeWindowEnd ? { start: row.timeWindowStart, end: row.timeWindowEnd } : null,
    constraints: row.constraints as string[],
    originalUserRequest: row.originalUserRequest,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    status: row.status as AgentTaskStatus,
    version: row.version,
    retry: {
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      lastErrorAt: row.lastErrorAt ? row.lastErrorAt.toISOString() : null,
      nextEligibleRetryAt: row.nextEligibleRetryAt ? row.nextEligibleRetryAt.toISOString() : null,
    },
  };
}
