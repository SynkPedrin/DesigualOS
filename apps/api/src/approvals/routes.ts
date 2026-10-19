import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APPROVAL_RESOURCE_TYPES, APPROVAL_STATUSES } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { requireTenant } from '../lib/tenant-context';
import * as svc from './service';

/**
 * approvals/routes.ts — P1-I/J (06/10/2026). Separado do tool-call approval
 * queue já existente (`/tool-calls`, apps/api/src/tool-calls/routes.ts) —
 * dois problemas diferentes, nunca misturados (plano de execução §P1.9).
 */

const createSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  resourceType: z.enum(APPROVAL_RESOURCE_TYPES),
  resourceId: z.string().trim().min(1),
  version: z.string().trim().optional(),
});

const listQuerySchema = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  mine: z.coerce.boolean().optional(),
  requestedByMe: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

const resolveSchema = z.object({
  status: z.enum(['approved', 'rejected', 'changes_requested']),
  comment: z.string().trim().max(2000).optional(),
});

function present(a: { id: string; clientId: string | null; resourceType: string; resourceId: string; version: string | null; requestedBy: string; approverId: string | null; status: string; comment: string | null; createdAt: Date; resolvedAt: Date | null }) {
  return {
    id: a.id,
    client_id: a.clientId,
    resource_type: a.resourceType,
    resource_id: a.resourceId,
    version: a.version,
    requested_by: a.requestedBy,
    approver_id: a.approverId,
    status: a.status,
    comment: a.comment,
    created_at: a.createdAt.toISOString(),
    resolved_at: a.resolvedAt?.toISOString() ?? null,
  };
}

export async function registerApprovalRequestRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireTenant(request, reply);
    if (reply.sent) return;
    // Workspace Builder (§79): esconder o item de navegação não basta.
    await requireModule('aprovacoes')(request, reply);
  });

  app.post('/approvals', { preHandler: requirePermission('approvals', 'write') }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const aprovacao = await svc.createApprovalRequest({
      organizationId: request.tenantContext!.organizationId,
      clientId: body.clientId ?? null,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      version: body.version ?? null,
      requestedBy: request.authUser!.id,
    });
    reply.code(201);
    return present(aprovacao);
  });

  app.get('/approvals', { preHandler: requirePermission('approvals', 'read') }, async (request) => {
    const q = listQuerySchema.parse(request.query);
    const linhas = await svc.listApprovals({
      organizationId: request.tenantContext!.organizationId,
      status: q.status,
      requestedBy: q.requestedByMe ? request.authUser!.id : undefined,
      approverId: q.mine ? request.authUser!.id : undefined,
      limit: q.limit,
      offset: q.offset,
    });
    return { approvals: linhas.map(present) };
  });

  app.get<{ Params: { id: string } }>('/approvals/:id', { preHandler: requirePermission('approvals', 'read') }, async (request, reply) => {
    const aprovacao = await svc.getApproval(request.tenantContext!.organizationId, request.params.id);
    if (!aprovacao) {
      reply.code(404);
      return { error: `Approval '${request.params.id}' not found` };
    }
    return present(aprovacao);
  });

  app.patch<{ Params: { id: string } }>('/approvals/:id', { preHandler: requirePermission('approvals', 'write') }, async (request, reply) => {
    const body = resolveSchema.parse(request.body);
    const resultado = await svc.resolveApproval({
      organizationId: request.tenantContext!.organizationId,
      id: request.params.id,
      approverId: request.authUser!.id,
      status: body.status,
      comment: body.comment ?? null,
    });

    if (!resultado.ok) {
      reply.code(resultado.reason === 'not_found' ? 404 : 409);
      return { error: resultado.reason === 'not_found' ? 'Approval not found' : 'This approval was already resolved by someone else.' };
    }

    return present(resultado.approval);
  });
}
