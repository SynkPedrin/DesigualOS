import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import * as demandSvc from '../demands/service';
import * as svc from './service';

/** briefs/routes.ts — P1-E/F/G (06/10/2026). */

const contentSchema = z
  .object({
    objective: z.string().trim().max(2000).optional(),
    deliverable: z.string().trim().max(500).optional(),
    channel: z.string().trim().max(200).optional(),
    format: z.string().trim().max(200).optional(),
    deadline: z.string().trim().max(200).optional(),
    references: z.array(z.string().trim()).optional(),
    direction: z.string().trim().max(2000).optional(),
    restrictions: z.string().trim().max(2000).optional(),
    assets: z.array(z.string().trim()).optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .strict();

const createBriefSchema = z.object({ demandId: z.string().uuid(), content: contentSchema });
const addVersionSchema = z.object({ content: contentSchema });
const approveSchema = z.object({ versionId: z.string().uuid() });
const sendToProductionSchema = z.object({ dueDate: z.coerce.date().nullable().optional() });

function presentBrief(b: { id: string; clientId: string; demandId: string; status: string; approvedVersionId: string | null; externalTaskId: string | null; externalTaskProvider: string | null }) {
  return {
    id: b.id,
    client_id: b.clientId,
    demand_id: b.demandId,
    status: b.status,
    approved_version_id: b.approvedVersionId,
    external_task_id: b.externalTaskId,
    external_task_provider: b.externalTaskProvider,
  };
}

function presentVersion(v: { id: string; briefId: string; version: number; content: unknown; source: string; createdAt: Date }) {
  return { id: v.id, brief_id: v.briefId, version: v.version, content: v.content, source: v.source, created_at: v.createdAt.toISOString() };
}

export async function registerBriefRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireTenant(request, reply);
    if (reply.sent) return;
    // Mesmo módulo de /demands: briefing não tem item de navegação próprio,
    // vive dentro da ficha da demanda (§79 do prompt de refinamento).
    await requireModule('demandas')(request, reply);
  });

  app.post('/briefs', { preHandler: requirePermission('briefs', 'write') }, async (request, reply) => {
    const body = createBriefSchema.parse(request.body);
    const demanda = await demandSvc.getDemand(request.tenantContext!.organizationId, body.demandId);
    if (!demanda) {
      reply.code(404);
      return { error: `Demand '${body.demandId}' not found` };
    }

    const { brief } = await svc.createBrief({
      organizationId: request.tenantContext!.organizationId,
      clientId: demanda.clientId,
      demandId: body.demandId,
      conversationThreadId: demanda.conversationThreadId,
      createdBy: request.authUser!.id,
      content: body.content,
      source: 'human_edit',
    });

    reply.code(201);
    return presentBrief(brief);
  });

  app.post<{ Params: { id: string } }>('/demands/:id/draft-brief', { preHandler: requirePermission('briefs', 'write') }, async (request, reply) => {
    const resultado = await svc.draftBriefFromDemand({
      organizationId: request.tenantContext!.organizationId,
      demandId: request.params.id,
      createdBy: request.authUser!.id,
    });
    if ('error' in resultado) {
      reply.code(resultado.error === 'demand_not_found' ? 404 : 409);
      return { error: resultado.error === 'demand_not_found' ? 'Demand not found' : 'Demand has no linked conversation to draft from.' };
    }

    reply.code(201);
    return { ...presentBrief(resultado.brief), draft_version: presentVersion(resultado.version) };
  });

  app.get<{ Params: { id: string } }>('/demands/:id/briefs', { preHandler: requirePermission('briefs', 'read') }, async (request) => {
    const briefs = await svc.listBriefsByDemand(request.tenantContext!.organizationId, request.params.id);
    return { briefs: briefs.map(presentBrief) };
  });

  app.get<{ Params: { id: string } }>('/briefs/:id', { preHandler: requirePermission('briefs', 'read') }, async (request, reply) => {
    const brief = await svc.getBrief(request.tenantContext!.organizationId, request.params.id);
    if (!brief) {
      reply.code(404);
      return { error: `Brief '${request.params.id}' not found` };
    }
    const versoes = await svc.listBriefVersions(brief.id);
    return { ...presentBrief(brief), versions: versoes.map(presentVersion) };
  });

  app.post<{ Params: { id: string } }>('/briefs/:id/versions', { preHandler: requirePermission('briefs', 'write') }, async (request, reply) => {
    const body = addVersionSchema.parse(request.body);
    const versao = await svc.addBriefVersion({
      organizationId: request.tenantContext!.organizationId,
      briefId: request.params.id,
      content: body.content,
      source: 'human_edit',
      createdBy: request.authUser!.id,
    });
    if (!versao) {
      reply.code(404);
      return { error: `Brief '${request.params.id}' not found` };
    }
    reply.code(201);
    return presentVersion(versao);
  });

  app.patch<{ Params: { id: string } }>('/briefs/:id/approve-version', { preHandler: requirePermission('briefs', 'write') }, async (request, reply) => {
    const body = approveSchema.parse(request.body);
    const brief = await svc.approveBriefVersion(request.tenantContext!.organizationId, request.params.id, body.versionId);
    if (!brief) {
      reply.code(404);
      return { error: 'Brief or version not found (version must belong to this brief).' };
    }

    await auditarAcao(request, {
      action: 'brief.version_approved',
      resourceType: 'brief',
      resourceId: request.params.id,
      newValue: { approvedVersionId: body.versionId },
    });

    return presentBrief(brief);
  });

  app.post<{ Params: { id: string } }>('/briefs/:id/send-to-production', { preHandler: requirePermission('briefs', 'write') }, async (request, reply) => {
    const body = sendToProductionSchema.parse(request.body);
    const resultado = await svc.sendBriefToProduction({
      organizationId: request.tenantContext!.organizationId,
      briefId: request.params.id,
      dueDate: body.dueDate ?? null,
    });

    if (!resultado.ok) {
      const mensagens: Record<string, { status: number; error: string }> = {
        brief_not_found: { status: 404, error: 'Brief not found' },
        no_approved_version: { status: 409, error: 'Brief has no approved version yet.' },
        provider_error: { status: 502, error: 'reason' in resultado && resultado.reason === 'provider_error' ? resultado.detail : 'Failed to create task.' },
      };
      const m = mensagens[resultado.reason];
      reply.code(m!.status);
      return { error: m!.error };
    }

    await auditarAcao(request, {
      action: 'brief.sent_to_production',
      resourceType: 'brief',
      resourceId: request.params.id,
      newValue: { externalTaskId: resultado.externalTaskId, externalTaskProvider: resultado.externalTaskProvider },
    });

    return presentBrief(resultado.brief);
  });
}
