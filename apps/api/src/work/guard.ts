import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveDailyTasksAccess, type WorkContext } from '@desigual-os/work-engine';
import { requireAuth } from '../auth/middleware';
import { requireTenant } from '../lib/tenant-context';

/**
 * Guarda do Daily Tasks (Beta). Roda no BACKEND em toda rota /work/*: o front só esconde o menu, quem
 * barra de verdade é isto. Duas travas independentes (ver work-engine/access.ts): flag da empresa + lista
 * de autorizados, e papel de administrador. Falha com 403 e um motivo curto, sem revelar nada além.
 */
export async function requireDailyTasks(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  await requireTenant(request, reply);
  if (reply.sent) return;
  const decision = await resolveDailyTasksAccess({
    organizationId: request.tenantContext!.organizationId,
    userId: request.authUser!.id,
    platformRoles: request.authUser!.roles,
  });
  if (!decision.allowed) {
    reply.code(403).send({ error: 'O Daily Tasks (Beta) não está liberado para você.', reason: decision.reason });
  }
}

/** Contexto do motor a partir da requisição já autorizada. A empresa vem do tenant resolvido, NUNCA do corpo. */
export function workContext(request: FastifyRequest): WorkContext {
  return { organizationId: request.tenantContext!.organizationId, userId: request.authUser!.id, actorKind: 'user' };
}
