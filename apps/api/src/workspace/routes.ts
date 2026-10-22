import type { FastifyInstance } from 'fastify';
import { forgetEnabledModules, resolveEnabledModulesCached } from '../auth/require-module';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { WORKSPACE_MODULES, WORKSPACE_TEMPLATES, WORKSPACE_TEMPLATE_IDS, isWorkspaceModule } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireTenant, userBelongsToTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import { resolveEnabledModules } from './access';

/**
 * workspace/routes.ts — Workspace Builder (§5-13 do prompt de refinamento).
 *
 * GET  /me/workspace                       — a própria pessoa lê o que vê (sidebar).
 * GET  /team/members/:userId/workspace     — gestão lê o de outra pessoa (editor).
 * PUT  /team/members/:userId/workspace     — gestão grava template + módulos.
 *
 * MESMO GATE de admin/routes.ts pras duas últimas: `users:write` + alvo
 * precisa pertencer à empresa de trabalho de quem está mexendo (nunca um uuid
 * de outra empresa só porque a permissão de papel já bastava). 404, não 403,
 * quando o alvo é de outra empresa — mesmo raciocínio de
 * `exigirAlvoNaOrganizacaoDeTrabalho` (admin/routes.ts): "não é seu" não pode
 * confirmar a existência de alguém de outro tenant.
 */
async function exigirAlvoNaEmpresaDeTrabalho(
  request: Parameters<typeof requireTenant>[0],
  reply: Parameters<typeof requireTenant>[1],
  targetUserId: string,
): Promise<boolean> {
  await requireTenant(request, reply);
  if (reply.sent) return false;

  if (!(await userBelongsToTenant(targetUserId, request.tenantContext!.organizationId))) {
    reply.code(404).send({ error: `User '${targetUserId}' not found` });
    await auditarAcao(request, {
      action: 'authorization.denied',
      result: 'denied',
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: { reason: 'cross_tenant_target', route: request.url },
    });
    return false;
  }
  return true;
}

function apresentacaoDe(resolved: Awaited<ReturnType<typeof resolveEnabledModules>>) {
  return {
    template_id: resolved.templateId,
    modules: [...resolved.modules],
    configured: resolved.configured,
  };
}

const saveSchema = z.object({
  template_id: z.enum(WORKSPACE_TEMPLATE_IDS as [string, ...string[]]).nullable().optional(),
  modules: z.array(z.string()).refine((mods) => mods.every(isWorkspaceModule), {
    message: `modules só aceita: ${WORKSPACE_MODULES.join(', ')}`,
  }),
});

export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  /** A lista de templates e módulos disponíveis — alimenta o seletor da tela de edição. */
  app.get('/workspace/templates', { preHandler: requireAuth }, async () => ({
    modules: WORKSPACE_MODULES,
    templates: Object.entries(WORKSPACE_TEMPLATES).map(([id, t]) => ({ id, label: t.label, modules: t.modules })),
  }));

  app.get('/me/workspace', { preHandler: requireAuth }, async (request) => {
    const [eu] = await db.select({ homePath: schema.users.homePath }).from(schema.users).where(eq(schema.users.id, request.authUser!.id));
    return { ...apresentacaoDe(await resolveEnabledModulesCached(request.authUser!.id)), home_path: eu?.homePath ?? null };
  });

  /**
   * TELA INICIAL de uma pessoa (ex.: '/gestao' para quem gerencia a equipe).
   * Só um caminho interno do app (começa com '/', sem domínio, sem '//'): o
   * valor vira destino de navegação depois do login e não pode levar para fora.
   */
  app.put<{ Params: { userId: string } }>(
    '/team/members/:userId/home',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      const { userId } = request.params;
      if (!(await exigirAlvoNaEmpresaDeTrabalho(request, reply, userId))) return;
      const body = z.object({ home_path: z.string().regex(/^\/(?!\/)[a-z0-9\-/]{0,60}$/, 'Tela inválida.').nullable() }).safeParse(request.body);
      if (!body.success) {
        reply.code(400);
        return { error: body.error.issues.map((i) => i.message).join(' ') };
      }
      const [antes] = await db.select({ homePath: schema.users.homePath }).from(schema.users).where(eq(schema.users.id, userId));
      await db.update(schema.users).set({ homePath: body.data.home_path }).where(eq(schema.users.id, userId));
      await auditarAcao(request, {
        action: 'workspace.home_set', resourceType: 'user', resourceId: userId,
        oldValue: { home_path: antes?.homePath ?? null }, newValue: { home_path: body.data.home_path },
      });
      return { home_path: body.data.home_path };
    },
  );

  app.get<{ Params: { userId: string } }>(
    '/team/members/:userId/workspace',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      const { userId } = request.params;
      if (!(await exigirAlvoNaEmpresaDeTrabalho(request, reply, userId))) return;
      return apresentacaoDe(await resolveEnabledModules(userId));
    },
  );

  app.put<{ Params: { userId: string } }>(
    '/team/members/:userId/workspace',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      const { userId } = request.params;
      if (!(await exigirAlvoNaEmpresaDeTrabalho(request, reply, userId))) return;

      const body = saveSchema.safeParse(request.body);
      if (!body.success) {
        reply.code(400);
        return { error: body.error.issues.map((i) => i.message).join(' ') };
      }

      const templateId = body.data.template_id ?? null;
      await db
        .insert(schema.workspaceConfigs)
        .values({ userId, templateId, modules: body.data.modules, updatedBy: request.authUser!.id })
        .onConflictDoUpdate({
          target: schema.workspaceConfigs.userId,
          set: { templateId, modules: body.data.modules, updatedBy: request.authUser!.id, updatedAt: new Date() },
        });

      forgetEnabledModules(userId);
      await auditarAcao(request, {
        action: 'workspace.configured',
        resourceType: 'user',
        resourceId: userId,
        metadata: { template_id: templateId, modules: body.data.modules },
      });

      return apresentacaoDe(await resolveEnabledModules(userId));
    },
  );
}
