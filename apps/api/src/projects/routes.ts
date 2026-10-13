import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { requireAuth, requirePermission } from '../auth/middleware';
import { deleteUserFile, uploadUserFile } from '../lib/storage';
import {
  escopoDeOrganizacao,
  organizacaoProvedora,
  recorteDaOrganizacaoDeTrabalho,
} from '../lib/escopo-de-organizacao';
import { organizacaoDeTrabalhoDe } from '../organizations/contexto';

/**
 * A FRONTEIRA É A EMPRESA DE TRABALHO, resolvida server-side (05/10/2026).
 *
 * Antes: `tenantSharingScope` — a união de TODAS as empresas da pessoa, com
 * bypass de master — e a tabela nem `organization_id` tinha. Um provedor
 * dentro da conta de um cliente via e editava os projetos da Desigual, e um
 * master de tenant alcançava os da provedora. Agora o projeto pertence a UMA
 * empresa (coluna gravada na criação, backfill via cliente nas antigas), e
 * `organization_id IS NULL` é legado pré-migração: visível SOMENTE no
 * contexto da provedora (ver `recorteDaOrganizacaoDeTrabalho` em
 * lib/escopo-de-organizacao.ts).
 */
function canAccessProject(
  project: { organizationId: string | null },
  organizacaoDeTrabalhoId: string,
): boolean {
  if (project.organizationId === organizacaoDeTrabalhoId) return true;
  // NULL = legado da plataforma: só entra no contexto da org provedora.
  return project.organizationId === null && organizacaoDeTrabalhoId === organizacaoProvedora();
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
    organization_id: project.organizationId,
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

/** O cliente precisa ser DA empresa de trabalho — anexar cliente de outro
 *  tenant mudaria o dono do projeto em silêncio. "Não encontrado" de
 *  propósito: dizer "existe mas não é seu" confirma a existência do cliente. */
async function clienteDaEmpresa(clientId: string, organizacaoDeTrabalhoId: string): Promise<boolean> {
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, organizacaoDeTrabalhoId)));
  return Boolean(client);
}

/**
 * Projetos do Chat (a seção "Projetos" da sidebar, estilo Claude): estrutura
 * compartilhada por quem está na MESMA organização de trabalho — qualquer
 * colaborador dela vê os projetos dela e, com chat:write, cria/edita/apaga. A
 * privacidade fina mora nas CONVERSAS (visibility em conversations), não no
 * projeto; o escopo aqui é a fronteira de empresa de trabalho (05/10/2026).
 */
export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const escopo = await escopoDeOrganizacao(user);
    const deTrabalho = await organizacaoDeTrabalhoDe(user, { escopo });
    if (!deTrabalho) {
      reply.code(403);
      return { error: 'Sem empresa de trabalho definida.' };
    }
    const rows = await db
      .select()
      .from(schema.projects)
      .where(recorteDaOrganizacaoDeTrabalho(deTrabalho.id, schema.projects.organizationId))
      .orderBy(asc(schema.projects.name));
    return { projects: rows.map(toWire) };
  });

  app.post('/projects', { preHandler: [requireAuth, requirePermission('chat', 'write')] }, async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const escopo = await escopoDeOrganizacao(user);
    const deTrabalho = await organizacaoDeTrabalhoDe(user, { escopo });
    if (!deTrabalho) {
      reply.code(403);
      return { error: 'Sem empresa de trabalho definida.' };
    }

    if (body.client_id && !(await clienteDaEmpresa(body.client_id, deTrabalho.id))) {
      reply.code(404);
      return { error: `Client '${body.client_id}' not found` };
    }

    const [project] = await db
      .insert(schema.projects)
      .values({
        name: body.name.trim(),
        clientId: body.client_id ?? null,
        // A empresa de trabalho é o dono: é o que faz o projeto aparecer na
        // listagem de quem criou e NUNCA na de outro tenant.
        organizationId: deTrabalho.id,
        createdBy: user.id,
      })
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

      const escopo = await escopoDeOrganizacao(user);
      const deTrabalho = await organizacaoDeTrabalhoDe(user, { escopo });
      if (!deTrabalho) {
        reply.code(403);
        return { error: 'Sem empresa de trabalho definida.' };
      }

      const [existing] = await db.select({ organizationId: schema.projects.organizationId }).from(schema.projects).where(eq(schema.projects.id, request.params.id));
      if (!existing || !canAccessProject(existing, deTrabalho.id)) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }

      if (body.client_id && !(await clienteDaEmpresa(body.client_id, deTrabalho.id))) {
        reply.code(404);
        return { error: `Client '${body.client_id}' not found` };
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
      const escopo = await escopoDeOrganizacao(user);
      const deTrabalho = await organizacaoDeTrabalhoDe(user, { escopo });
      if (!deTrabalho) {
        reply.code(403);
        return { error: 'Sem empresa de trabalho definida.' };
      }
      const [project] = await db.select({ id: schema.projects.id, organizationId: schema.projects.organizationId }).from(schema.projects).where(eq(schema.projects.id, request.params.id));
      if (!project || !canAccessProject(project, deTrabalho.id)) {
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

      const escopo = await escopoDeOrganizacao(user);
      const deTrabalho = await organizacaoDeTrabalhoDe(user, { escopo });
      if (!deTrabalho) {
        reply.code(403);
        return { error: 'Sem empresa de trabalho definida.' };
      }

      const [project] = await db
        .select({ id: schema.projects.id, clientId: schema.projects.clientId, organizationId: schema.projects.organizationId })
        .from(schema.projects)
        .where(eq(schema.projects.id, request.params.id));
      if (!project || !canAccessProject(project, deTrabalho.id)) {
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
    const escopo = await escopoDeOrganizacao(user);
    const deTrabalho = await organizacaoDeTrabalhoDe(user, { escopo });
    if (!deTrabalho) {
      reply.code(403);
      return { error: 'Sem empresa de trabalho definida.' };
    }
    const [project] = await db.select({ id: schema.projects.id, organizationId: schema.projects.organizationId }).from(schema.projects).where(eq(schema.projects.id, request.params.id));
    if (!project || !canAccessProject(project, deTrabalho.id)) {
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
      const escopo = await escopoDeOrganizacao(user);
      const deTrabalho = await organizacaoDeTrabalhoDe(user, { escopo });
      if (!deTrabalho) {
        reply.code(403);
        return { error: 'Sem empresa de trabalho definida.' };
      }
      const [project] = await db.select({ id: schema.projects.id, organizationId: schema.projects.organizationId }).from(schema.projects).where(eq(schema.projects.id, request.params.id));
      if (!project || !canAccessProject(project, deTrabalho.id)) {
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
