import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createLogger } from '@desigual-os/logging';
import { requireAuth, requireRole } from '../auth/middleware';
import { resolveEnabledModulesCached } from '../auth/require-module';
import { requireTenant } from '../lib/tenant-context';
import { escopoDeOrganizacao } from '../lib/escopo-de-organizacao';
import { auditarAcao } from '../lib/auditoria';
import * as svc from './service';

const logger = createLogger({ service: 'api:announcements' });

/**
 * ANÚNCIOS DE FUNCIONALIDADE.
 *
 *   GET  /announcements              — os elegíveis para quem pergunta, com o estado dela
 *   POST /announcements/:key/events  — shown | dismissed | started | step | completed
 *   GET  /admin/announcements        — todos, com visualizações e conclusões (Desigual)
 *   PATCH /admin/announcements/:key  — ativar, rollout, público, prioridade (Desigual)
 *
 * A administração é da Desigual (master no escopo de provedor), não do master de
 * uma empresa cliente: um anúncio vale para todas as empresas.
 */

function apresentar(a: svc.Anuncio, e: svc.EstadoDoAnuncio | null) {
  return {
    id: a.id,
    key: a.key,
    type: a.type,
    title: a.title,
    subtitle: a.subtitle,
    description: a.description,
    version: a.version,
    preview_image_url: a.previewImageUrl,
    primary_cta: a.primaryCta,
    secondary_cta: a.secondaryCta,
    tutorial_id: a.tutorialId,
    tutorial_version: a.tutorialVersion,
    priority: a.priority,
    icon: a.display?.icon ?? null,
    auto_open: svc.deveAbrirSozinho(a, e),
    state: e?.state ?? 'not_seen',
    tutorial_step: e?.tutorialStep ?? null,
    completed_at: e?.completedAt?.toISOString() ?? null,
  };
}

async function pessoa(request: FastifyRequest): Promise<svc.Pessoa> {
  const user = request.authUser!;
  const { modules } = await resolveEnabledModulesCached(user.id);
  return { id: user.id, roles: user.roles, modulos: modules, organizationId: request.tenantContext?.organizationId ?? null };
}

async function requireDesigual(request: FastifyRequest, reply: FastifyReply) {
  await requireRole('master')(request, reply);
  if (reply.sent) return;
  const escopo = await escopoDeOrganizacao(request.authUser!);
  if (!escopo.ehProvider) reply.code(403).send({ error: 'Anúncios são administrados pela Desigual.' });
}

const eventoSchema = z.object({
  event: z.enum(['shown', 'dismissed', 'started', 'step', 'completed']),
  step: z.number().int().min(0).max(50).nullable().optional(),
});

const alteracaoSchema = z.object({
  active: z.boolean().optional(),
  rollout: z.enum(svc.ROLLOUTS).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  qa_user_ids: z.array(z.string().uuid()).max(50).optional(),
  audience: z.object({
    modules: z.array(z.string().min(1).max(60)).max(20).optional(),
    roles: z.array(z.string().min(1).max(40)).max(10).optional(),
    organization_ids: z.array(z.string().uuid()).max(200).optional(),
  }).optional(),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function registerAnnouncementRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (rotas) => {
    rotas.addHook('preHandler', async (request, reply) => {
      await requireAuth(request, reply);
      if (reply.sent) return;
      await requireTenant(request, reply);
    });

    rotas.get('/announcements', async (request) => {
      const p = await pessoa(request);
      const lista = await svc.anunciosDaPessoa(p);
      return { announcements: lista.map((l) => apresentar(l.anuncio, l.estado)) };
    });

    rotas.post<{ Params: { key: string } }>('/announcements/:key/events', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
      const body = eventoSchema.safeParse(request.body);
      if (!body.success) { reply.code(400); return { error: 'Evento inválido.' }; }
      const p = await pessoa(request);
      // Quem não é público do anúncio não grava estado nele (e não ganha aviso no sino).
      const achado = await svc.anuncioElegivel(p, request.params.key);
      if (!achado) { reply.code(404); return { error: 'Anúncio não encontrado.' }; }
      const r = await svc.registrarEvento(achado.anuncio, p, body.data.event, body.data.step ?? null);
      // O aviso no sino nasce na primeira apresentação — e também quando a pessoa entra pelo tutorial sem ter visto o modal.
      if (r.primeira || (body.data.event !== 'shown' && !achado.estado)) {
        await svc.criarNotificacao(achado.anuncio, p).catch((error) => logger.warn({ error }, 'Falha ao criar o aviso do anúncio'));
      }
      return { first: r.primeira, announcement: apresentar(achado.anuncio, r.estado ?? achado.estado) };
    });

    rotas.get('/admin/announcements', { preHandler: requireDesigual }, async () => {
      const lista = await svc.anunciosComNumeros();
      return {
        announcements: lista.map(({ anuncio: a, numeros }) => ({
          key: a.key, type: a.type, title: a.title, active: a.active, rollout: a.rollout, priority: a.priority,
          audience: a.audience, qa_user_ids: a.qaUserIds, published_at: a.publishedAt.toISOString(), expires_at: a.expiresAt?.toISOString() ?? null,
          tutorial_id: a.tutorialId, stats: numeros,
        })),
      };
    });

    rotas.patch<{ Params: { key: string } }>('/admin/announcements/:key', { preHandler: requireDesigual }, async (request, reply) => {
      const body = alteracaoSchema.safeParse(request.body);
      if (!body.success) { reply.code(400); return { error: body.error.issues.map((i) => i.message).join('; ') }; }
      const b = body.data;
      const r = await svc.alterarAnuncio(request.params.key, {
        ...(b.active !== undefined ? { active: b.active } : {}),
        ...(b.rollout !== undefined ? { rollout: b.rollout } : {}),
        ...(b.priority !== undefined ? { priority: b.priority } : {}),
        ...(b.qa_user_ids !== undefined ? { qaUserIds: b.qa_user_ids } : {}),
        ...(b.audience !== undefined ? { audience: JSON.parse(JSON.stringify(b.audience)) as svc.Anuncio['audience'] } : {}),
        ...(b.expires_at !== undefined ? { expiresAt: b.expires_at ? new Date(b.expires_at) : null } : {}),
      });
      if (!r) { reply.code(404); return { error: 'Anúncio não encontrado.' }; }
      await auditarAcao(request, {
        action: 'announcement.updated', resourceType: 'feature_announcement', resourceId: r.depois.id,
        oldValue: { active: r.antes.active, rollout: r.antes.rollout, priority: r.antes.priority, qa_user_ids: r.antes.qaUserIds, audience: r.antes.audience },
        newValue: { active: r.depois.active, rollout: r.depois.rollout, priority: r.depois.priority, qa_user_ids: r.depois.qaUserIds, audience: r.depois.audience },
      }).catch(() => undefined);
      return { key: r.depois.key, active: r.depois.active, rollout: r.depois.rollout, priority: r.depois.priority, qa_user_ids: r.depois.qaUserIds, audience: r.depois.audience };
    });
  });
}
