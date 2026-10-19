import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DEMAND_PRIORITIES, DEMAND_SOURCES, DEMAND_STATUSES } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { requireTenant } from '../lib/tenant-context';
import { hasClientAccess } from '../lib/access';
import { auditarAcao } from '../lib/auditoria';
import { deleteUserFile, uploadUserFile } from '../lib/storage';
import * as svc from './service';

const demandFileKindSchema = z.enum(svc.DEMAND_FILE_KINDS);

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function serializeDemandFile(f: { id: string; demandId: string; kind: string; filename: string; storageUrl: string; contentType: string; sizeBytes: number | null; uploadedBy: string | null; createdAt: Date }) {
  return {
    id: f.id,
    demand_id: f.demandId,
    kind: f.kind,
    filename: f.filename,
    storage_url: f.storageUrl,
    content_type: f.contentType,
    size_bytes: f.sizeBytes,
    uploaded_by: f.uploadedBy,
    created_at: f.createdAt.toISOString(),
  };
}

/** demands/routes.ts — P1-D (06/10/2026). */

const createDemandSchema = z.object({
  clientId: z.string().uuid(),
  conversationThreadId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  source: z.enum(DEMAND_SOURCES),
  priority: z.enum(DEMAND_PRIORITIES).optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

const listQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  status: z.enum(DEMAND_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

const updateStatusSchema = z.object({ status: z.enum(DEMAND_STATUSES) });

function presentDemand(d: { id: string; clientId: string; clientName?: string | null; ownerId: string | null; title: string; description: string | null; source: string; status: string; priority: string; requestedAt: Date; dueDate: Date | null; clickupTaskId?: string | null; clickupTaskUrl?: string | null }) {
  return {
    id: d.id,
    client_id: d.clientId,
    client_name: d.clientName ?? null,
    owner_id: d.ownerId,
    title: d.title,
    description: d.description,
    source: d.source,
    status: d.status,
    priority: d.priority,
    requested_at: d.requestedAt.toISOString(),
    due_date: d.dueDate?.toISOString() ?? null,
    clickup_task_url: d.clickupTaskUrl ?? null,
  };
}

export async function registerDemandRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireTenant(request, reply);
    if (reply.sent) return;
    // Workspace Builder (§79 do prompt de refinamento): esconder o item de
    // navegação não basta — a API tem que recusar também.
    await requireModule('demandas')(request, reply);
  });

  app.get('/demands', { preHandler: requirePermission('demands', 'read') }, async (request) => {
    const q = listQuerySchema.parse(request.query);
    const linhas = await svc.listDemands({
      organizationId: request.tenantContext!.organizationId,
      clientId: q.clientId,
      ownerId: q.ownerId,
      status: q.status,
      limit: q.limit,
      offset: q.offset,
    });
    return { demands: linhas.map(presentDemand) };
  });

  app.post('/demands', { preHandler: requirePermission('demands', 'write') }, async (request, reply) => {
    const body = createDemandSchema.parse(request.body);
    if (!(await hasClientAccess(request.authUser!, body.clientId))) {
      reply.code(404);
      return { error: `Client '${body.clientId}' not found` };
    }

    const demanda = await svc.createDemand({
      organizationId: request.tenantContext!.organizationId,
      clientId: body.clientId,
      conversationThreadId: body.conversationThreadId ?? null,
      createdBy: request.authUser!.id,
      title: body.title,
      description: body.description ?? null,
      source: body.source,
      priority: body.priority,
      dueDate: body.dueDate ?? null,
    });

    reply.code(201);
    return presentDemand(demanda);
  });

  app.get<{ Params: { id: string } }>('/demands/:id', { preHandler: requirePermission('demands', 'read') }, async (request, reply) => {
    const demanda = await svc.getDemand(request.tenantContext!.organizationId, request.params.id);
    if (!demanda) {
      reply.code(404);
      return { error: `Demand '${request.params.id}' not found` };
    }
    return presentDemand(demanda);
  });

  app.patch<{ Params: { id: string } }>('/demands/:id/status', { preHandler: requirePermission('demands', 'write') }, async (request, reply) => {
    const body = updateStatusSchema.parse(request.body);
    const atualizada = await svc.updateDemandStatus(request.tenantContext!.organizationId, request.params.id, body.status, request.authUser!.id);
    if (!atualizada) {
      reply.code(404);
      return { error: `Demand '${request.params.id}' not found` };
    }

    await auditarAcao(request, {
      action: 'demand.status_changed',
      resourceType: 'demand',
      resourceId: request.params.id,
      newValue: { status: body.status },
    });

    return presentDemand(atualizada);
  });

  // Mesmo cuidado do multipart de /projects: o campo `kind` precisa vir ANTES
  // do campo `file` no form pro @fastify/multipart já ter populado o valor.
  app.post<{ Params: { id: string } }>('/demands/:id/files', { preHandler: requirePermission('demands', 'write') }, async (request, reply) => {
    const demanda = await svc.getDemand(request.tenantContext!.organizationId, request.params.id);
    if (!demanda) {
      reply.code(404);
      return { error: `Demand '${request.params.id}' not found` };
    }

    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { error: 'No file sent' };
    }

    const fields = file.fields as Record<string, { value?: unknown } | undefined>;
    const kindParsed = demandFileKindSchema.safeParse(fields.kind?.value ?? 'outro');
    if (!kindParsed.success) {
      reply.code(400);
      return { error: `Invalid kind, expected one of: ${svc.DEMAND_FILE_KINDS.join(', ')}` };
    }

    const buffer = await file.toBuffer();
    const path = `demands/${demanda.clientId}/${demanda.id}/${Date.now()}-${randomUUID()}-${sanitizeFilename(file.filename)}`;
    const uploaded = await uploadUserFile(path, buffer, file.mimetype);

    const created = await svc.addDemandFile({
      demandId: demanda.id,
      clientId: demanda.clientId,
      kind: kindParsed.data,
      filename: file.filename,
      storageUrl: uploaded.url,
      contentType: file.mimetype,
      sizeBytes: buffer.byteLength,
      uploadedBy: request.authUser!.id,
      organizationId: request.tenantContext!.organizationId,
    });

    reply.code(201);
    return { file: serializeDemandFile(created) };
  });

  app.get<{ Params: { id: string } }>('/demands/:id/files', { preHandler: requirePermission('demands', 'read') }, async (request, reply) => {
    const demanda = await svc.getDemand(request.tenantContext!.organizationId, request.params.id);
    if (!demanda) {
      reply.code(404);
      return { error: `Demand '${request.params.id}' not found` };
    }
    const rows = await svc.listDemandFiles(demanda.id);
    return { files: rows.map(serializeDemandFile) };
  });

  app.delete<{ Params: { id: string; fileId: string } }>('/demands/:id/files/:fileId', { preHandler: requirePermission('demands', 'write') }, async (request, reply) => {
    const demanda = await svc.getDemand(request.tenantContext!.organizationId, request.params.id);
    if (!demanda) {
      reply.code(404);
      return { error: `Demand '${request.params.id}' not found` };
    }
    const fileRow = await svc.getDemandFile(demanda.id, request.params.fileId);
    if (!fileRow) {
      reply.code(404);
      return { error: `Demand file '${request.params.fileId}' not found` };
    }

    // Se o storage falhar a linha do banco NÃO é apagada: melhor sobrar
    // referência rastreável do que órfão invisível no bucket (mesmo padrão
    // de /projects/:id/files/:fileId).
    await deleteUserFile(fileRow.storageUrl);
    await svc.deleteDemandFileRow(fileRow.id);
    reply.code(204);
    return null;
  });
}
