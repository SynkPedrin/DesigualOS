import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordOperationalEvent } from '@desigual-os/orchestrator';
import type { ApprovalResourceType, ApprovalStatus } from '@desigual-os/types';

/**
 * approvals/service.ts — P1-I (06/10/2026). Genérico por `resourceType`/
 * `resourceId` — separado do gate de tool-call da IA (packages/tool-gateway
 * gateway.ts), que é outro problema.
 */

type ApprovalRow = typeof schema.approvalRequests.$inferSelect;

export async function createApprovalRequest(input: {
  organizationId: string;
  clientId: string | null;
  resourceType: ApprovalResourceType;
  resourceId: string;
  version?: string | null;
  requestedBy: string;
}): Promise<ApprovalRow> {
  const [criado] = await db
    .insert(schema.approvalRequests)
    .values({
      organizationId: input.organizationId,
      clientId: input.clientId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      version: input.version ?? null,
      requestedBy: input.requestedBy,
    })
    .returning();

  await recordOperationalEvent({
    source: 'system',
    type: 'approval.requested',
    organizationId: input.organizationId,
    userId: input.requestedBy,
    clientId: input.clientId,
    entityType: input.resourceType,
    entityId: input.resourceId,
    summary: `Pediu aprovação de ${input.resourceType}.`,
  });

  return criado!;
}

export interface ListApprovalsFilter {
  organizationId: string;
  status?: ApprovalStatus | undefined;
  requestedBy?: string | undefined;
  /** Pendentes sem dono ainda, OU já reivindicadas por este usuário. */
  approverId?: string | undefined;
  limit: number;
  offset: number;
}

export async function listApprovals(filter: ListApprovalsFilter): Promise<ApprovalRow[]> {
  const condicoes = [eq(schema.approvalRequests.organizationId, filter.organizationId)];
  if (filter.status) condicoes.push(eq(schema.approvalRequests.status, filter.status));
  if (filter.requestedBy) condicoes.push(eq(schema.approvalRequests.requestedBy, filter.requestedBy));
  if (filter.approverId) condicoes.push(eq(schema.approvalRequests.approverId, filter.approverId));

  return db
    .select()
    .from(schema.approvalRequests)
    .where(and(...condicoes))
    .orderBy(desc(schema.approvalRequests.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);
}

export async function getApproval(organizationId: string, id: string): Promise<ApprovalRow | null> {
  const [linha] = await db
    .select()
    .from(schema.approvalRequests)
    .where(and(eq(schema.approvalRequests.id, id), eq(schema.approvalRequests.organizationId, organizationId)));
  return linha ?? null;
}

export type ResolveResult = { ok: true; approval: ApprovalRow } | { ok: false; reason: 'not_found' } | { ok: false; reason: 'already_resolved' };

/**
 * Resolução ATÔMICA — `UPDATE ... WHERE resolved_at IS NULL`, mesmo padrão
 * de `approveToolCall` (packages/tool-gateway/src/gateway.ts). Dois
 * aprovadores clicando ao mesmo tempo: só um vence, o outro recebe
 * `already_resolved`, nunca um 500 nem uma segunda resolução silenciosa.
 */
export async function resolveApproval(input: {
  organizationId: string;
  id: string;
  approverId: string;
  status: Exclude<ApprovalStatus, 'pending'>;
  comment?: string | null;
}): Promise<ResolveResult> {
  const [atualizado] = await db
    .update(schema.approvalRequests)
    .set({ status: input.status, approverId: input.approverId, comment: input.comment ?? null, resolvedAt: new Date() })
    .where(
      and(
        eq(schema.approvalRequests.id, input.id),
        eq(schema.approvalRequests.organizationId, input.organizationId),
        isNull(schema.approvalRequests.resolvedAt),
      ),
    )
    .returning();

  if (!atualizado) {
    const existente = await getApproval(input.organizationId, input.id);
    return existente ? { ok: false, reason: 'already_resolved' } : { ok: false, reason: 'not_found' };
  }

  await recordOperationalEvent({
    source: 'system',
    type: 'approval.resolved',
    organizationId: input.organizationId,
    userId: input.approverId,
    clientId: atualizado.clientId,
    entityType: atualizado.resourceType,
    entityId: atualizado.resourceId,
    summary: `Resolveu uma aprovação como ${input.status}.`,
  });

  return { ok: true, approval: atualizado };
}
