import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { requireAuth, requirePermission, type AuthenticatedUser } from '../auth/middleware';
import { deleteUserFile, uploadUserFile } from '../lib/storage';
import { tenantSharingScope } from '../lib/access';

/**
 * P0-02 (auditoria de release readiness, 22/09/2026): mesma falha estrutural
 * de `/conversations`/`/executions` — "compartilhado com a equipe" presumia
 * UMA organização só. Projeto com cliente herda a organização do cliente;
 * projeto sem cliente (deck/material solto da agência) é escopado por quem
 * criou, igual à regra que já existe pra conversa sem cliente.
 */
async function canAccessProject(user: AuthenticatedUser, project: { clientId: string | null; createdBy: string }): Promise<boolean> {
  if (user.roles.includes('master')) return true;
  if (project.createdBy === user.id) return true;
  const scope = await tenantSharingScope(user.id);
  return project.clientId ? scope.allowedClientIds.includes(project.clientId) : scope.teammateUserIds.includes(project.createdBy);
}

const PROJECT_FILE_KINDS = ['identidade_visual', 'briefing', 'referencia'] as const;
const projectFileKindSchema = z.enum(PROJECT_FILE_KINDS);

// Teto de texto extraído de .md/.txt pra injeção no contexto do chat.
const TEXT_CONTENT_MAX_CHARS = 50_000;

// Nome de arquivo vira parte da storage key: troca tudo que não é seguro pra
// URL por hífen, preservando a extensão.
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function isTextFile(contentType: string, filename: string): boolean {
  return contentType.startsWith('text/') || /\.(md|txt)$/i.test(filename);
}

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  client_id: z.string().uuid().nullable().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  client_id: z.string().uuid().nullable().optional(),
});

function toWire(project: typeof schema.projects.$inferSelect) {
  return {
    id: project.id,
    name: project.name,
    client_id: project.clientId,
    created_by: project.createdBy,
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
  };
}

function serializeProjectFile(row: typeof schema.projectFiles.$inferSelect) {
  return {
    id: row.id,
    project_id: row.projectId,
    client_id: row.clientId,
    kind: row.kind,
    filename: row.filename,
    storage_url: row.storageUrl,
    content_type: row.contentType,
    has_text: row.textContent !== null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Projetos do Chat (a seção "Projetos" da sidebar, estilo Claude): estrutura
 * compartilhada por quem está na MESMA organização — qualquer colaborador da
 * organização vê os projetos dela e, com chat:write, cria/edita/apaga. A
 * privacidade fina mora nas CONVERSAS (visibility em conversations), não no
 * projeto; o escopo aqui é só a fronteira de organização (P0-02, 22/09/2026).
 */
export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const isMaster = user.roles.includes('master');
    const scope = isMaster ? null : await tenantSharingScope(user.id);
    const scopeCondition =
      scope === null
        ? undefined
        : or(
            scope.allowedClientIds.length > 0 ? inArray(schema.projects.clientId, scope.allowedClientIds) : undefined,
            and(isNull(schema.projects.clientId), inArray(schema.projects.createdBy, scope.teammateUserIds)),
          );
    const rows = await db.select().from(schema.projects).where(scopeCondition).orderBy(asc(schema.projects.name));
    return { projects: rows.map(toWire) };
  });

  app.post('/projects', { preHandler: [requireAuth, requirePermission('chat', 'write')] }, async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    if (body.client_id) {
      const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, body.client_id));
      if (!client) {
        reply.code(404);
        return { error: `Client '${body.client_id}' not found` };
      }
    }

    const [project] = await db
      .insert(schema.projects)
      .values({ name: body.name.trim(), clientId: body.client_id ?? null, createdBy: user.id })
      .returning();
    reply.code(201);
    return { project: toWire(project!) };
  });

  app.patch<{ Params: { id: string } }>(
    '/projects/:id',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const body = updateProjectSchema.parse(request.body);

      const [existing] = await db.select({ clientId: schema.projects.clientId, createdBy: schema.projects.createdBy }).from(schema.projects).where(eq(schema.projects.id, request.params.id));
      if (!existing) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }
      if (!(await canAccessProject(user, existing))) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }

      if (body.client_id) {
        const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, body.client_id));
        if (!client) {
          reply.code(404);
          return { error: `Client '${body.client_id}' not found` };
        }
      }

      const [project] = await db
        .update(schema.projects)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.client_id !== undefined ? { clientId: body.client_id } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, request.params.id))
        .returning();
      if (!project) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }
      return { project: toWire(project) };
    },
  );

  // Apagar um projeto NUNCA apaga as conversas dele: elas só voltam pra seção
  // "Conversas" soltas da sidebar (project_id = null).
  app.delete<{ Params: { id: string } }>(
    '/projects/:id',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const [project] = await db.select({ id: schema.projects.id, clientId: schema.projects.clientId, createdBy: schema.projects.createdBy }).from(schema.projects).where(eq(schema.projects.id, request.params.id));
      if (!project) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }
      if (!(await canAccessProject(user, project))) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }
      await db.update(schema.conversations).set({ projectId: null }).where(eq(schema.conversations.projectId, request.params.id));
      await db.delete(schema.projects).where(eq(schema.projects.id, request.params.id));
      reply.code(204);
      return null;
    },
  );

  // Arquivos de referência do projeto (identidade visual, briefing,
  // referências). Binário no bucket user-uploads; .md/.txt também têm o texto
  // extraído em text_content pra injeção no contexto do chat.
  // Mesmo cuidado do POST /messages: o campo de texto `kind` precisa vir ANTES
  // do campo `file` no multipart form pro @fastify/multipart populá-lo.
  app.post<{ Params: { id: string } }>(
    '/projects/:id/files',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      const [project] = await db
        .select({ id: schema.projects.id, clientId: schema.projects.clientId, createdBy: schema.projects.createdBy })
        .from(schema.projects)
        .where(eq(schema.projects.id, request.params.id));
      if (!project) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }
      if (!(await canAccessProject(user, project))) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }

      const file = await request.file();
      if (!file) {
        reply.code(400);
        return { error: 'No file sent' };
      }

      const fields = file.fields as Record<string, { value?: unknown } | undefined>;
      const kindField = fields.kind?.value;
      const kindParsed = projectFileKindSchema.safeParse(kindField === undefined ? 'referencia' : kindField);
      if (!kindParsed.success) {
        reply.code(400);
        return { error: `Invalid kind, expected one of: ${PROJECT_FILE_KINDS.join(', ')}` };
      }

      const buffer = await file.toBuffer();
      // P0-02/E21 (release readiness audit, 22/09/2026): bucket público,
      // path precisa de aleatoriedade real — Date.now() é força-bruteável.
      const path = `${project.clientId ?? 'sem-cliente'}/${project.id}/${Date.now()}-${randomUUID()}-${sanitizeFilename(file.filename)}`;
      const uploaded = await uploadUserFile(path, buffer, file.mimetype);

      const textContent = isTextFile(file.mimetype, file.filename)
        ? buffer.toString('utf8').slice(0, TEXT_CONTENT_MAX_CHARS)
        : null;

      const [created] = await db
        .insert(schema.projectFiles)
        .values({
          projectId: project.id,
          clientId: project.clientId,
          kind: kindParsed.data,
          filename: file.filename,
          storageUrl: uploaded.url,
          contentType: file.mimetype,
          textContent,
          uploadedBy: user.id,
        })
        .returning();
      if (!created) {
        reply.code(500);
        return { error: 'Failed to create project file' };
      }

      reply.code(201);
      return { file: serializeProjectFile(created) };
    },
  );

  // A listagem NÃO devolve text_content (pode ter até 50k chars); o chat lê a
  // coluna direto do banco na hora de montar o contexto.
  app.get<{ Params: { id: string } }>('/projects/:id/files', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const [project] = await db.select({ id: schema.projects.id, clientId: schema.projects.clientId, createdBy: schema.projects.createdBy }).from(schema.projects).where(eq(schema.projects.id, request.params.id));
    if (!project) {
      reply.code(404);
      return { error: `Project '${request.params.id}' not found` };
    }
    if (!(await canAccessProject(user, project))) {
      reply.code(404);
      return { error: `Project '${request.params.id}' not found` };
    }

    const rows = await db
      .select()
      .from(schema.projectFiles)
      .where(eq(schema.projectFiles.projectId, request.params.id))
      .orderBy(desc(schema.projectFiles.createdAt));
    return { files: rows.map(serializeProjectFile) };
  });

  app.delete<{ Params: { id: string; fileId: string } }>(
    '/projects/:id/files/:fileId',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const [project] = await db.select({ id: schema.projects.id, clientId: schema.projects.clientId, createdBy: schema.projects.createdBy }).from(schema.projects).where(eq(schema.projects.id, request.params.id));
      if (!project || !(await canAccessProject(user, project))) {
        reply.code(404);
        return { error: `Project file '${request.params.fileId}' not found` };
      }
      const [fileRow] = await db
        .select()
        .from(schema.projectFiles)
        .where(and(eq(schema.projectFiles.id, request.params.fileId), eq(schema.projectFiles.projectId, request.params.id)));
      if (!fileRow) {
        reply.code(404);
        return { error: `Project file '${request.params.fileId}' not found` };
      }

      // Se o storage falhar a linha do banco NÃO é apagada: melhor sobrar
      // referência rastreável do que órfão invisível no bucket.
      await deleteUserFile(fileRow.storageUrl);
      await db.delete(schema.projectFiles).where(eq(schema.projectFiles.id, fileRow.id));
      reply.code(204);
      return null;
    },
  );
}
