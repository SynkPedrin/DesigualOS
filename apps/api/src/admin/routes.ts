import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { getSupabaseAdminClient } from '@desigual-os/auth';
import { ROLE_NAMES } from '@desigual-os/types';
import { invalidateUserAccessCache, requireAuth, requirePermission } from '../auth/middleware';
import { sendInviteEmail } from '../lib/email';

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(ROLE_NAMES),
});

const changeRoleSchema = z.object({ role: z.enum(ROLE_NAMES) });
const changeStatusSchema = z.object({ active: z.boolean() });
const updateUserSchema = z.object({ name: z.string().min(1) });

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Convite de colaborador (pedido do usuário): admin master convida por
   * e-mail, o Supabase Auth manda o e-mail de verdade com um link mágico
   * pra esse e-mail. Diferente do provisionamento just-in-time da Fase 13
   * (usado quando alguém aparece sem convite prévio): aqui o papel já é
   * decidido pelo admin no convite, não inferido de MASTER_USER_EMAILS.
   */
  app.post('/admin/invite', { preHandler: [requireAuth, requirePermission('users', 'write')] }, async (request, reply) => {
    const body = inviteSchema.parse(request.body);

    const supabaseUrl = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !secretKey) {
      reply.code(500);
      return { error: 'SUPABASE_URL/SUPABASE_SECRET_KEY not configured on the Orchestrator' };
    }

    const admin = getSupabaseAdminClient(supabaseUrl, secretKey);
    const redirectTo = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/convite`;

    // Com Resend configurado, geramos o link de convite pelo Supabase (sem
    // deixar ele mandar o e-mail padrão dele) e mandamos nosso próprio
    // e-mail com a marca da Desigual (logo + fundo, pedido do usuário).
    // Sem Resend, cai pro e-mail padrão do Supabase (funcional, sem marca).
    const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
    let authUserId: string;

    if (hasResend) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'invite',
        email: body.email,
        options: { data: { invited_role: body.role, invited_name: body.name ?? null }, redirectTo },
      });
      if (error || !data.user) {
        reply.code(400);
        return { error: error?.message ?? 'Failed to generate invite link' };
      }
      authUserId = data.user.id;

      try {
        await sendInviteEmail({ to: body.email, name: body.name ?? null, role: body.role, inviteLink: data.properties.action_link });
      } catch (emailError) {
        // O usuário já foi criado no Supabase Auth nesse ponto (generateLink
        // cria de verdade); não desfaz, só avisa que o e-mail não saiu, pra
        // o admin poder reenviar ou mandar o link manualmente.
        reply.code(502);
        return { error: `Convite criado mas o e-mail falhou ao enviar: ${emailError instanceof Error ? emailError.message : String(emailError)}` };
      }
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email, {
        data: { invited_role: body.role, invited_name: body.name ?? null },
        redirectTo,
      });
      if (error || !data.user) {
        reply.code(400);
        return { error: error?.message ?? 'Failed to send invite email' };
      }
      authUserId = data.user.id;
    }

    const [user] = await db
      .insert(schema.users)
      .values({ authUserId, email: body.email, name: body.name ?? body.email.split('@')[0] ?? body.email })
      .onConflictDoNothing({ target: schema.users.authUserId })
      .returning();

    if (user) {
      const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, body.role));
      if (role) {
        await db
          .insert(schema.userRoles)
          .values({ userId: user.id, roleId: role.id })
          .onConflictDoNothing({ target: [schema.userRoles.userId, schema.userRoles.roleId] });
      }
    }

    await db.insert(schema.auditLogs).values({
      userId: request.authUser?.id ?? null,
      action: 'user.invited',
      result: 'completed',
      metadata: { email: body.email, role: body.role },
    });

    reply.code(201);
    return { email: body.email, role: body.role, status: 'invited' };
  });

  // Base da tela de "equipe" na central de configuração (pedido do
  // usuário): lista todo mundo com papel, status ativo/inativo e, agora,
  // quais workspaces de cliente cada um tem acesso concedido (POST
  // /clients/:id/access), pra não precisar cruzar isso manualmente cliente
  // por cliente.
  app.get('/admin/users', { preHandler: [requireAuth, requirePermission('users', 'read')] }, async () => {
    const rows = await db.select().from(schema.users).orderBy(desc(schema.users.createdAt));
    const userIds = rows.map((user) => user.id);

    // As 3 consultas de contexto (papéis, acessos a cliente, integrações)
    // eram feitas POR usuário dentro do map: 3 x N queries, ~0.9s ao vivo
    // (RTT ~130ms pro Supabase). Em lote com inArray viram 3 no total,
    // agrupadas em memória na montagem da resposta. O formato não muda.
    const [roleRows, clientAccessRows, integrationRows] =
      userIds.length > 0
        ? await Promise.all([
            db
              .select({ userId: schema.userRoles.userId, name: schema.roles.name })
              .from(schema.userRoles)
              .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
              .where(inArray(schema.userRoles.userId, userIds)),
            db
              .select({
                userId: schema.clientUsers.userId,
                clientId: schema.clientUsers.clientId,
                clientName: schema.clients.name,
                role: schema.clientUsers.role,
              })
              .from(schema.clientUsers)
              .innerJoin(schema.clients, eq(schema.clients.id, schema.clientUsers.clientId))
              .where(inArray(schema.clientUsers.userId, userIds)),
            // Status das integrações por pessoa (pedido do Endrigo: o Admin
            // precisa ver quem está conectado ao ClickUp, em qual workspace e
            // desde quando sincronizou). NUNCA devolve o token - só metadados.
            db
              .select({
                userId: schema.integrationConnections.userId,
                provider: schema.integrationConnections.provider,
                status: schema.integrationConnections.status,
                workspaceName: schema.integrationConnections.externalWorkspaceName,
                lastSyncedAt: schema.integrationConnections.lastSyncedAt,
                connectedAt: schema.integrationConnections.createdAt,
              })
              .from(schema.integrationConnections)
              .where(inArray(schema.integrationConnections.userId, userIds)),
          ])
        : [[], [], []];

    const rolesByUser = new Map<string, string[]>();
    for (const row of roleRows) {
      const list = rolesByUser.get(row.userId) ?? [];
      list.push(row.name);
      rolesByUser.set(row.userId, list);
    }

    const clientAccessByUser = new Map<string, Array<{ client_id: string; client_name: string; role: string }>>();
    for (const row of clientAccessRows) {
      const list = clientAccessByUser.get(row.userId) ?? [];
      list.push({ client_id: row.clientId, client_name: row.clientName, role: row.role });
      clientAccessByUser.set(row.userId, list);
    }

    type IntegrationRow = (typeof integrationRows)[number];
    const integrationsByUser = new Map<string, IntegrationRow[]>();
    for (const row of integrationRows) {
      const list = integrationsByUser.get(row.userId) ?? [];
      list.push(row);
      integrationsByUser.set(row.userId, list);
    }

    const users = rows.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatarUrl,
      active: user.active,
      roles: rolesByUser.get(user.id) ?? [],
      client_access: clientAccessByUser.get(user.id) ?? [],
      integrations: (integrationsByUser.get(user.id) ?? []).map((row) => ({
        provider: row.provider,
        status: row.status,
        workspace_name: row.workspaceName,
        last_synced_at: row.lastSyncedAt?.toISOString() ?? null,
        connected_at: row.connectedAt.toISOString(),
      })),
      created_at: user.createdAt.toISOString(),
    }));

    return { users };
  });

  app.patch<{ Params: { id: string } }>(
    '/admin/users/:id/role',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      const body = changeRoleSchema.parse(request.body);
      const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, body.role));
      if (!role) {
        reply.code(400);
        return { error: `Unknown role '${body.role}'` };
      }

      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, request.params.id));
      await db.insert(schema.userRoles).values({ userId: request.params.id, roleId: role.id });
      // requireAuth guarda papéis/permissões em cache curto por processo -
      // sem isto, o papel novo só valeria depois do TTL.
      invalidateUserAccessCache(request.params.id);

      await db.insert(schema.auditLogs).values({
        userId: request.authUser?.id ?? null,
        action: 'user.role_changed',
        result: 'completed',
        metadata: { target_user_id: request.params.id, role: body.role },
      });

      return { id: request.params.id, role: body.role };
    },
  );

  // users.active existia desde o schema inicial mas não tinha rota nenhuma
  // pra mudar: nem fazia diferença desativar alguém (achado na auditoria
  // de RBAC, ver requireAuth em auth/middleware.ts, que agora checa isso).
  app.patch<{ Params: { id: string } }>(
    '/admin/users/:id/status',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      const body = changeStatusSchema.parse(request.body);

      const [updated] = await db
        .update(schema.users)
        .set({ active: body.active, updatedAt: new Date() })
        .where(eq(schema.users.id, request.params.id))
        .returning();

      if (!updated) {
        reply.code(404);
        return { error: `User '${request.params.id}' not found` };
      }
      // Desativar alguém precisa valer na hora, não depois do TTL do cache.
      invalidateUserAccessCache(updated.authUserId ?? request.params.id);

      await db.insert(schema.auditLogs).values({
        userId: request.authUser?.id ?? null,
        action: body.active ? 'user.activated' : 'user.deactivated',
        result: 'completed',
        metadata: { target_user_id: request.params.id },
      });

      return { id: updated.id, active: updated.active };
    },
  );

  // Editar nome de outro usuário (master), separado de PATCH /me (o
  // próprio usuário editando a si mesmo).
  app.patch<{ Params: { id: string } }>(
    '/admin/users/:id',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      const body = updateUserSchema.parse(request.body);

      const [updated] = await db
        .update(schema.users)
        .set({ name: body.name, updatedAt: new Date() })
        .where(eq(schema.users.id, request.params.id))
        .returning();

      if (!updated) {
        reply.code(404);
        return { error: `User '${request.params.id}' not found` };
      }
      invalidateUserAccessCache(updated.authUserId ?? request.params.id);

      return { id: updated.id, name: updated.name };
    },
  );

  // Apagar de verdade (Supabase Auth + nossa tabela), não é o mesmo que
  // desativar. Golden rule 7 (auditoria de tudo) significa que quem já fez
  // alguma coisa de verdade no sistema (execução, log de auditoria,
  // mensagem, conversa) não pode ser apagado sem perder rastro de quem fez
  // o quê; nesse caso a rota recusa com 409 e aponta pra
  // PATCH /admin/users/:id/status em vez de apagar. Só remove de verdade
  // um usuário "limpo" (convidado por engano, nunca fez nada).
  app.delete<{ Params: { id: string } }>(
    '/admin/users/:id',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, request.params.id));
      if (!user) {
        reply.code(404);
        return { error: `User '${request.params.id}' not found` };
      }

      const [hasExecutions, hasAuditLogs, hasConversations, hasDirectMessages] = await Promise.all([
        db.select({ id: schema.executions.id }).from(schema.executions).where(eq(schema.executions.userId, request.params.id)).limit(1),
        db.select({ id: schema.auditLogs.id }).from(schema.auditLogs).where(eq(schema.auditLogs.userId, request.params.id)).limit(1),
        db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.userId, request.params.id)).limit(1),
        db
          .select({ id: schema.directMessages.id })
          .from(schema.directMessages)
          .where(or(eq(schema.directMessages.senderId, request.params.id), eq(schema.directMessages.recipientId, request.params.id)))
          .limit(1),
      ]);

      if (hasExecutions.length > 0 || hasAuditLogs.length > 0 || hasConversations.length > 0 || hasDirectMessages.length > 0) {
        reply.code(409);
        return { error: 'User has real activity (executions, audit trail, conversations or messages) and cannot be deleted. Use PATCH /admin/users/:id/status to deactivate instead.' };
      }

      const supabaseUrl = process.env.SUPABASE_URL;
      const secretKey = process.env.SUPABASE_SECRET_KEY;
      if (user.authUserId && supabaseUrl && secretKey) {
        const admin = getSupabaseAdminClient(supabaseUrl, secretKey);
        await admin.auth.admin.deleteUser(user.authUserId);
      }

      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, request.params.id));
      await db.delete(schema.clientUsers).where(eq(schema.clientUsers.userId, request.params.id));
      await db.delete(schema.notifications).where(eq(schema.notifications.userId, request.params.id));
      await db.delete(schema.users).where(eq(schema.users.id, request.params.id));
      invalidateUserAccessCache(user.authUserId ?? request.params.id);

      return { id: request.params.id, deleted: true };
    },
  );
}
