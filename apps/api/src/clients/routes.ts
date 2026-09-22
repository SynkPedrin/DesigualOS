import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { getTaskComments, getTasksInList, getTasksInListPaged } from '@desigual-os/tool-gateway';
import type { ClickUpTaskSummary } from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth, requirePermission } from '../auth/middleware';
import { hasClientAccess } from '../lib/access';
import { clientBelongsToTenant, requireTenant } from '../lib/tenant-context';
import { resolveClickUpAccess } from '../integrations/access';

const logger = createLogger({ service: 'clients' });

// Agregação de comentários: buscar comentários de TODA a lista estoura o
// rate limit do ClickUp em listas grandes, então só as 10 tarefas mexidas
// mais recentemente (onde a conversa viva acontece), 5 chamadas por vez.
const COMMENTS_TASK_LIMIT = 10;
const COMMENTS_CONCURRENCY = 5;
const COMMENTS_TOTAL_LIMIT = 50;

interface ClientClickUpComment {
  id: string;
  text: string;
  user_id: number | null;
  username: string | null;
  date: string;
  task_id: string;
  task_name: string;
  task_url: string | null;
}

/** Comentários das tarefas mais recentes da lista, mesclados e ordenados do
 * mais novo pro mais velho. Tarefa que falha individualmente é pulada (uma
 * tarefa apagada no ClickUp no meio do caminho não derruba o painel todo). */
async function fetchAggregatedComments(tasks: ClickUpTaskSummary[], config: { apiKey: string; teamId: string }): Promise<ClientClickUpComment[]> {
  const recentTasks = [...tasks]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, COMMENTS_TASK_LIMIT);

  const merged: ClientClickUpComment[] = [];
  for (let i = 0; i < recentTasks.length; i += COMMENTS_CONCURRENCY) {
    const batch = recentTasks.slice(i, i + COMMENTS_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((task) => getTaskComments(config, task.id)));
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') {
        logger.warn({ taskId: batch[index]?.id }, 'Falha ao buscar comentários de uma tarefa; pulando');
        return;
      }
      const task = batch[index]!;
      for (const comment of result.value) {
        merged.push({
          id: comment.id,
          text: comment.text,
          user_id: comment.userId,
          username: comment.username,
          date: comment.date,
          task_id: task.id,
          task_name: task.name,
          task_url: task.url,
        });
      }
    });
  }

  return merged.sort((a, b) => Number(b.date) - Number(a.date)).slice(0, COMMENTS_TOTAL_LIMIT);
}

const createClientSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug deve ser kebab-case (a-z, 0-9, hífen)'),
});

const grantAccessSchema = z.object({
  email: z.string().email(),
  role: z.enum(['viewer', 'editor']).default('viewer'),
});

export async function registerClientRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireTenant(request, reply);
    if (reply.sent) return;
    const { id } = request.params as { id?: string };
    if (id && !(await clientBelongsToTenant(id, request.tenantContext!.organizationId))) {
      reply.code(404).send({ error: 'Client not found' });
    }
  });
  app.get('/clients', { preHandler: [requireAuth, requirePermission('clients', 'read')] }, async (request) => {
    const rows = await db
      .select({
        id: schema.clients.id,
        name: schema.clients.name,
        slug: schema.clients.slug,
        status: schema.clients.status,
        clickupListId: schema.clients.clickupListId,
      })
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, request.tenantContext!.organizationId))
      .orderBy(desc(schema.clients.createdAt));

    // A listagem precisa do vínculo também: sem isso o card na tela de
    // Clientes dizia "sem vínculo no ClickUp" pra TODO mundo, mesmo com o
    // cliente importado de lá (só o workspace devolvia esse campo).
    const teamId = process.env.CLICKUP_TEAM_ID;
    return {
      clients: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        clickup_list_id: row.clickupListId,
        clickup_url: row.clickupListId && teamId ? `https://app.clickup.com/${teamId}/v/li/${row.clickupListId}` : null,
      })),
    };
  });

  app.post(
    '/clients',
    { preHandler: [requireAuth, requirePermission('clients', 'write')] },
    async (request, reply) => {
      const body = createClientSchema.parse(request.body);

      const [client] = await db.insert(schema.clients).values({ ...body, organizationId: request.tenantContext!.organizationId }).onConflictDoNothing({ target: schema.clients.slug }).returning();

      if (!client) {
        reply.code(409);
        return { error: `Client with slug '${body.slug}' already exists` };
      }

      await db.insert(schema.auditLogs).values({
        userId: request.authUser?.id ?? null,
        action: 'client.created',
        clientId: client.id,
        result: 'completed',
        metadata: { name: client.name, slug: client.slug },
      });

      reply.code(201);
      return { id: client.id, name: client.name, slug: client.slug, status: client.status };
    },
  );

  app.get<{ Params: { id: string } }>('/clients/:id', { preHandler: [requireAuth, requirePermission('clients', 'read')] }, async (request, reply) => {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, request.params.id));
    if (!client) {
      reply.code(404);
      return { error: `Client '${request.params.id}' not found` };
    }

    return { id: client.id, name: client.name, slug: client.slug, status: client.status };
  });

  // Workspace agregado do cliente (pedido do usuário): tudo que o Bento, a
  // Susy e o Jarbas alimentaram sobre ele, num lugar só. Projetos são
  // compartilhados pela equipe (2026-09-03): qualquer master/colaborador
  // autenticado acessa, ver hasClientAccess em lib/access.ts.
  app.get<{ Params: { id: string } }>(
    '/clients/:id/workspace',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }

      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client workspace' };
      }

      const [conversationRows, assetRows, executionRows, [project]] = await Promise.all([
        db.select().from(schema.conversations).where(eq(schema.conversations.clientId, clientId)).orderBy(desc(schema.conversations.updatedAt)).limit(20),
        db.select().from(schema.studioAssets).where(eq(schema.studioAssets.clientId, clientId)).orderBy(desc(schema.studioAssets.createdAt)).limit(20),
        db.select().from(schema.executions).where(eq(schema.executions.clientId, clientId)).orderBy(desc(schema.executions.createdAt)).limit(20),
        // Projeto de chat vinculado a este cliente (tela de Clientes ainda não
        // tinha como abrir o chat dele: faltava esse id pro botão "Abrir chat").
        db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.clientId, clientId)).limit(1),
      ]);

      const totalCost = executionRows.reduce((sum, row) => sum + Number(row.actualCost ?? row.estimatedCost ?? 0), 0);

      return {
        client: {
          id: client.id,
          name: client.name,
          slug: client.slug,
          status: client.status,
          clickup_list_id: client.clickupListId,
          project_id: project?.id ?? null,
          // Deep link direto pra lista do cliente no ClickUp. Embutir o
          // ClickUp por iframe NÃO é possível: o CSP dele responde
          // `frame-ancestors 'self' https://clickup.com` (verificado nos
          // headers em 03/09/2026), então o browser recusa. Abrir em aba
          // nova é o caminho suportado.
          clickup_url:
            client.clickupListId && process.env.CLICKUP_TEAM_ID
              ? `https://app.clickup.com/${process.env.CLICKUP_TEAM_ID}/v/li/${client.clickupListId}`
              : null,
        },
        conversations: conversationRows.map((row) => ({ id: row.id, title: row.title, status: row.status, updated_at: row.updatedAt.toISOString() })),
        studio_assets: assetRows.map((row) => ({
          id: row.id,
          type: row.type,
          filename: row.filename,
          storage_url: row.storageUrl,
          created_at: row.createdAt.toISOString(),
        })),
        executions: executionRows.map((row) => ({
          id: row.id,
          execution_id: row.executionId,
          agent: row.agent,
          status: row.status,
          created_at: row.createdAt.toISOString(),
        })),
        cost_summary: { total_cost: totalCost, execution_count: executionRows.length },
      };
    },
  );

  // Concessão de acesso ao workspace (pedido do usuário), só master.
  // Assume que o colaborador já tem conta no Desigual OS; convite de
  // alguém sem conta ainda usa POST /admin/invite primeiro (não dá pra
  // pré-criar o perfil aqui sem colidir com o provisionamento just-in-time
  // que já existe em resolveOrProvisionUser, que casa por auth_user_id).
  app.post<{ Params: { id: string } }>(
    '/clients/:id/access',
    { preHandler: [requireAuth, requirePermission('clients', 'write')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const body = grantAccessSchema.parse(request.body);

      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }

      const [targetUser] = await db.select({ id: schema.users.id }).from(schema.users)
        .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.userId, schema.users.id))
        .where(and(eq(schema.users.email, body.email), eq(schema.organizationMembers.organizationId, request.tenantContext!.organizationId)));
      if (!targetUser) {
        reply.code(404);
        return { error: `No Desigual OS account found for '${body.email}'. Use POST /admin/invite first to create one.` };
      }

      await db
        .insert(schema.clientUsers)
        .values({ clientId, userId: targetUser.id, role: body.role })
        .onConflictDoUpdate({ target: [schema.clientUsers.clientId, schema.clientUsers.userId], set: { role: body.role } });

      // E-mail transacional dedicado (ex: Resend/Postmark) não está
      // configurado ainda; a notificação real que existe hoje é in-app.
      await db.insert(schema.notifications).values({
        userId: targetUser.id,
        type: 'workspace_access_granted',
        title: `Acesso liberado: ${client.name}`,
        body: `Você agora tem acesso ao workspace do cliente ${client.name} como ${body.role}.`,
      });

      reply.code(201);
      return { client_id: clientId, user_id: targetUser.id, role: body.role };
    },
  );
  /**
   * Brand kit consolidado pro Studio: junta o branding geral
   * (client_brand_kits) com as referências visuais específicas de geração
   * (studio_brand_kits). Cliente sem kit NÃO é 404: devolve 200 com campos
   * null/[] pra tela renderizar o estado vazio sem tratar exceção.
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/brand-kit',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
    const clientId = request.params.id;
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    if (!client) {
      reply.code(404);
      return { error: `Client '${clientId}' not found` };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
      reply.code(403);
      return { error: 'No access granted to this client' };
    }

    const [brandKit, studioKit] = await Promise.all([
      db.select().from(schema.clientBrandKits).where(eq(schema.clientBrandKits.clientId, clientId)),
      db.select().from(schema.studioBrandKits).where(eq(schema.studioBrandKits.clientId, clientId)),
    ]);

    return {
      client_id: clientId,
      logo_url: brandKit[0]?.logoUrl ?? null,
      colors: brandKit[0]?.colors ?? [],
      fonts: brandKit[0]?.fonts ?? [],
      tone_of_voice: brandKit[0]?.toneOfVoice ?? null,
      reference_images: studioKit[0]?.referenceImages ?? [],
    };
    },
  );

  /**
   * Write path do Brand Kit (até 11/09/2026 NÃO existia: client_brand_kits e
   * studio_brand_kits só eram populadas por SQL manual, e o loop de DNA do
   * Otto ficava inerte pra cliente sem kit). Upsert nas duas tabelas de uma
   * vez — o GET acima lê as duas juntas, então a escrita também grava as
   * duas juntas, senão o painel mostraria metade do que foi salvo.
   *
   * Campos omitidos NÃO são apagados (merge com o que já existe): a tela
   * manda o formulário inteiro, mas um caller parcial (ex: futuro importador
   * de manual de marca em PDF) não destrói o resto por omissão. Pra limpar
   * um campo, mande null/[] explicitamente.
   */
  const upsertBrandKitSchema = z.object({
    logo_url: z.string().url().nullable().optional(),
    colors: z.array(z.string().min(1)).max(24).optional(),
    fonts: z.array(z.string().min(1)).max(12).optional(),
    tone_of_voice: z.string().nullable().optional(),
    reference_images: z.array(z.string().url()).max(20).optional(),
  });

  app.put<{ Params: { id: string } }>(
    '/clients/:id/brand-kit',
    { preHandler: [requireAuth, requirePermission('clients', 'write')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const body = upsertBrandKitSchema.parse(request.body ?? {});

      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const [brandKit, studioKit] = await Promise.all([
        db.select().from(schema.clientBrandKits).where(eq(schema.clientBrandKits.clientId, clientId)),
        db.select().from(schema.studioBrandKits).where(eq(schema.studioBrandKits.clientId, clientId)),
      ]);
      const currentKit = brandKit[0];
      const currentStudioKit = studioKit[0];

      const merged = {
        logoUrl: body.logo_url !== undefined ? body.logo_url : (currentKit?.logoUrl ?? null),
        colors: body.colors ?? currentKit?.colors ?? [],
        fonts: body.fonts ?? currentKit?.fonts ?? [],
        toneOfVoice: body.tone_of_voice !== undefined ? body.tone_of_voice : (currentKit?.toneOfVoice ?? null),
      };
      const mergedReferenceImages = body.reference_images ?? currentStudioKit?.referenceImages ?? [];

      await db
        .insert(schema.clientBrandKits)
        .values({ clientId, ...merged })
        .onConflictDoUpdate({ target: schema.clientBrandKits.clientId, set: { ...merged, updatedAt: new Date() } });

      await db
        .insert(schema.studioBrandKits)
        .values({ clientId, referenceImages: mergedReferenceImages })
        .onConflictDoUpdate({
          target: schema.studioBrandKits.clientId,
          set: { referenceImages: mergedReferenceImages, updatedAt: new Date() },
        });

      await db.insert(schema.auditLogs).values({
        userId: request.authUser.id,
        action: 'client.brand_kit_saved',
        clientId,
        result: 'completed',
        metadata: {
          colors: merged.colors.length,
          fonts: merged.fonts.length,
          reference_images: mergedReferenceImages.length,
          has_logo: merged.logoUrl !== null,
          has_tone_of_voice: merged.toneOfVoice !== null,
        },
      });

      return {
        client_id: clientId,
        logo_url: merged.logoUrl,
        colors: merged.colors,
        fonts: merged.fonts,
        tone_of_voice: merged.toneOfVoice,
        reference_images: mergedReferenceImages,
      };
    },
  );

  /**
   * Memória consolidada do cliente (kind 'client.profile' em `memories`):
   * dossiê reunido de histórico de conversas, ClickUp e material entregue,
   * usado pela tela de Projeto no chat pra mostrar "memória, informações e
   * padrões" antes de começar uma conversa nova ali dentro. Sem registro
   * ainda é 200 com content null (estado vazio honesto, não 404).
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/memory',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
    const clientId = request.params.id;
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    if (!client) {
      reply.code(404);
      return { error: `Client '${clientId}' not found` };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
      reply.code(403);
      return { error: 'No access granted to this client' };
    }

    const [memory] = await db
      .select()
      .from(schema.memories)
      .where(and(eq(schema.memories.clientId, clientId), eq(schema.memories.kind, 'client.profile')))
      .orderBy(desc(schema.memories.updatedAt))
      .limit(1);

    return {
      client_id: clientId,
      content: memory?.content ?? null,
      metadata: memory?.metadata ?? null,
      updated_at: memory?.updatedAt.toISOString() ?? null,
    };
    },
  );

  /**
   * Tarefas REAIS do cliente, lidas direto do ClickUp na hora (não do
   * espelho local): o ClickUp é a fonte de verdade, então a tela mostra o
   * que está lá agora, sem risco de exibir cópia velha. Exige o mesmo
   * acesso do workspace do cliente.
   */
  app.get<{ Params: { id: string }; Querystring: { include_closed?: string } }>(
    '/clients/:id/clickup/tasks',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client workspace' };
      }
      if (!client.clickupListId) {
        reply.code(409);
        return { error: 'Client is not linked to a ClickUp list yet. Run the ClickUp sync first.' };
      }

      const access = await resolveClickUpAccess(request.authUser.id);
      if (!access) {
        reply.code(400);
        return { error: 'No ClickUp access available for this user' };
      }

      try {
        const tasks = await getTasksInList(access.token, client.clickupListId, request.query.include_closed === 'true');
        return {
          tasks: tasks.map((task) => ({
            id: task.id,
            name: task.name,
            description: task.description,
            status: task.status,
            status_color: task.statusColor,
            status_type: task.statusType,
            priority: task.priority,
            priority_color: task.priorityColor,
            url: task.url,
            due_date: task.dueDate,
            start_date: task.startDate,
            created_at: task.createdAt,
            updated_at: task.updatedAt,
            time_estimate_ms: task.timeEstimateMs,
            tags: task.tags.map((tag) => ({ name: tag.name, background: tag.background, foreground: tag.foreground })),
            // Fotos reais dos usuários do ClickUp (profilePicture): pedido
            // explícito do Endrigo pra reconhecer quem é quem sem ler nome.
            assignees: task.assignees.map((p) => ({ id: p.id, name: p.name, avatar_url: p.avatarUrl, initials: p.initials, color: p.color })),
            creator: task.creator
              ? { id: task.creator.id, name: task.creator.name, avatar_url: task.creator.avatarUrl, initials: task.creator.initials, color: task.creator.color }
              : null,
          })),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error, clientId }, 'Falha ao buscar tarefas do ClickUp');
        reply.code(502);
        return { error: message };
      }
    },
  );

  /**
   * TODOS os comentários das tarefas do cliente numa thread só (pedido do
   * usuário): em vez de escolher uma tarefa por vez, a aba Conversas mostra
   * a conversa inteira do cliente, cada item dizendo de qual tarefa veio.
   * Limitado às tarefas mais recentes por causa do rate limit do ClickUp
   * (ver constantes no topo do arquivo).
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/comments',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client workspace' };
      }
      if (!client.clickupListId) {
        reply.code(409);
        return { error: 'Client is not linked to a ClickUp list yet. Run the ClickUp sync first.' };
      }

      const access = await resolveClickUpAccess(request.authUser.id);
      if (!access) {
        reply.code(400);
        return { error: 'No ClickUp access available for this user' };
      }

      try {
        const tasks = await getTasksInList(access.token, client.clickupListId);
        return { comments: await fetchAggregatedComments(tasks, { apiKey: access.token, teamId: access.teamId }) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error, clientId }, 'Falha ao agregar comentários do ClickUp');
        reply.code(502);
        return { error: message };
      }
    },
  );

  /**
   * Resumo sempre atualizado do cliente (aba Visão Geral): totais de tarefas
   * do ClickUp por status, últimos comentários, assets do Studio e conversas
   * do Desigual OS. Tudo lido na hora; o que não existir (cliente sem lista
   * vinculada, por exemplo) vem como estado vazio/null, nunca inventado.
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/overview',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client workspace' };
      }

      const [conversationCountRow, assetCountRow, recentConversations, recentAssets] = await Promise.all([
        db.select({ value: count() }).from(schema.conversations).where(eq(schema.conversations.clientId, clientId)),
        db.select({ value: count() }).from(schema.studioAssets).where(eq(schema.studioAssets.clientId, clientId)),
        db.select().from(schema.conversations).where(eq(schema.conversations.clientId, clientId)).orderBy(desc(schema.conversations.updatedAt)).limit(5),
        db.select().from(schema.studioAssets).where(eq(schema.studioAssets.clientId, clientId)).orderBy(desc(schema.studioAssets.createdAt)).limit(4),
      ]);

      // Sem lista vinculada o ClickUp não entra no resumo (null = estado
      // vazio honesto), mas o resto do resumo continua valendo.
      let clickup: {
        total_tasks: number;
        /** true = a busca bateu no teto de páginas, então `total_tasks` é um MÍNIMO.
         * A UI tem que dizer "mínimo"/"+" em vez de afirmar o número como total. */
        counts_truncated: boolean;
        open_tasks: number;
        by_status: Array<{ status: string; color: string | null; count: number }>;
        latest_comments: ClientClickUpComment[];
      } | null = null;

      if (client.clickupListId) {
        const access = await resolveClickUpAccess(request.authUser.id);
        if (!access) {
          reply.code(400);
          return { error: 'No ClickUp access available for this user' };
        }
        try {
          // Paginado de propósito: até 10/09/2026 esta contagem usava só a primeira página
          // (100 tarefas) e exibia o resultado como se fosse o total do cliente. Cliente
          // grande aparecia com número errado sem nenhum sinal de erro. `truncated` sobe pro
          // wire pra que a UI possa dizer "mínimo" em vez de afirmar um total falso.
          const { tasks, truncated } = await getTasksInListPaged(access.token, client.clickupListId, true);
          const byStatus = new Map<string, { status: string; color: string | null; count: number }>();
          for (const task of tasks) {
            const key = task.status ?? 'sem status';
            const entry = byStatus.get(key) ?? { status: key, color: task.statusColor, count: 0 };
            entry.count += 1;
            byStatus.set(key, entry);
          }
          clickup = {
            total_tasks: tasks.length,
            counts_truncated: truncated,
            open_tasks: tasks.filter((task) => task.statusType !== 'closed' && task.statusType !== 'done').length,
            by_status: [...byStatus.values()].sort((a, b) => b.count - a.count),
            latest_comments: (await fetchAggregatedComments(tasks, { apiKey: access.token, teamId: access.teamId })).slice(0, 5),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error({ error, clientId }, 'Falha ao montar resumo do ClickUp');
          reply.code(502);
          return { error: message };
        }
      }

      return {
        clickup,
        conversations: {
          total: conversationCountRow[0]?.value ?? 0,
          latest: recentConversations.map((row) => ({ id: row.id, title: row.title, status: row.status, updated_at: row.updatedAt.toISOString() })),
        },
        studio: {
          total: assetCountRow[0]?.value ?? 0,
          latest: recentAssets.map((row) => ({ id: row.id, type: row.type, filename: row.filename, storage_url: row.storageUrl, created_at: row.createdAt.toISOString() })),
        },
      };
    },
  );

}
