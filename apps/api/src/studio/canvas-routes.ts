import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { CANVA_BLEND_MODES, type CanvaPage } from '@desigual-os/types';
import { hasPermission } from '@desigual-os/auth';
import { requireAuth, requirePermission } from '../auth/middleware';
import { hasClientAccess } from '../lib/access';

/**
 * Postgres 23503 = foreign_key_violation. Achado real (2026-09-10): criar um
 * design com um client_id que não existe mais em `clients` (ex: dropdown com
 * cache desatualizado no navegador, cliente removido nesse meio-tempo)
 * quebrava como "Internal Server Error" genérico pro usuário - o handler
 * central (server.ts) nunca repassa a mensagem real de erro de banco de
 * propósito (evita vazar nome de tabela/coluna), então isso precisa virar
 * uma resposta clara AQUI, na rota, antes de chegar lá.
 */
function isForeignKeyViolation(error: unknown, constraintIncludes: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23503' &&
    'constraint_name' in error &&
    typeof (error as { constraint_name?: unknown }).constraint_name === 'string' &&
    (error as { constraint_name: string }).constraint_name.includes(constraintIncludes)
  );
}

const backgroundSchema = z.object({
  type: z.enum(['color', 'image', 'transparent']),
  value: z.string().optional(),
});

const objectBaseSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  rotation: z.number(),
  opacity: z.number(),
  locked: z.boolean(),
  visible: z.boolean(),
  zIndex: z.number(),
  blendMode: z.enum(CANVA_BLEND_MODES).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Sem z.lazy/recursão: 'group' guarda fabricData opaco (formato nativo do
// Fabric), não uma lista de CanvaObject aninhada - ver comentário em
// packages/types/src/canva.ts:CanvaGroupObject sobre por quê.
const canvaObjectSchema: z.ZodType<CanvaPage['objects'][number]> = z.discriminatedUnion('type', [
  objectBaseSchema.extend({
    type: z.literal('image'),
    src: z.string(),
    cropX: z.number().optional(),
    cropY: z.number().optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
    clipShape: z.enum(['rect', 'ellipse', 'triangle', 'star']).optional(),
    filters: z
      .object({
        brightness: z.number().optional(),
        contrast: z.number().optional(),
        saturation: z.number().optional(),
        blur: z.number().optional(),
        grayscale: z.boolean().optional(),
        sepia: z.boolean().optional(),
        hueRotate: z.number().optional(),
        invert: z.boolean().optional(),
        sharpen: z.number().optional(),
      })
      .optional(),
  }),
  objectBaseSchema.extend({
    type: z.literal('text'),
    text: z.string(),
    fontFamily: z.string(),
    fontId: z.string().optional(),
    fontSize: z.number(),
    fontWeight: z.number(),
    fontStyle: z.enum(['normal', 'italic']),
    fill: z.string(),
    textAlign: z.enum(['left', 'center', 'right']),
    letterSpacing: z.number(),
    lineHeight: z.number(),
    underline: z.boolean(),
    uppercase: z.boolean(),
  }),
  objectBaseSchema.extend({
    type: z.literal('shape'),
    shape: z.enum(['rect', 'ellipse', 'triangle', 'line', 'star']),
    fill: z.string(),
    stroke: z.string(),
    strokeWidth: z.number(),
    cornerRadius: z.number().optional(),
    shadow: z.boolean().optional(),
  }),
  objectBaseSchema.extend({
    type: z.literal('group'),
    fabricData: z.record(z.unknown()),
  }),
  objectBaseSchema.extend({
    type: z.literal('path'),
    pathData: z.string(),
    stroke: z.string(),
    strokeWidth: z.number(),
    fill: z.string().nullable(),
  }),
]);

const pageSchema = z.object({
  id: z.string(),
  order: z.number(),
  name: z.string().optional(),
  background: backgroundSchema,
  objects: z.array(canvaObjectSchema),
});

const createDocumentSchema = z.object({
  client_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).default('Sem título'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const updateDocumentSchema = z.object({
  name: z.string().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  pages: z.array(pageSchema).optional(),
});

function toWire(row: typeof schema.studioCanvasDocuments.$inferSelect) {
  return {
    id: row.id,
    client_id: row.clientId,
    project_id: row.projectId,
    name: row.name,
    width: row.width,
    height: row.height,
    thumbnail_url: row.thumbnailUrl,
    pages: row.pages,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function registerCanvasDocumentRoutes(app: FastifyInstance): Promise<void> {
  /** Sidebar "Projetos": lista enxuta (sem `pages`, que pode ser grande) pra montar os cards. */
  app.get<{ Querystring: { client_id?: string } }>(
    '/studio/canvas-documents',
    // Igual ao resto das leituras do Studio (GET /studio/jobs, /studio/assets):
    // só requireAuth, sem requirePermission - a matriz RBAC (seed.ts) só
    // concede 'studio:write' pro colaborador, nunca 'studio:read', e o
    // escopo real de acesso já vem de hasClientAccess abaixo.
    { preHandler: requireAuth },
    async (request, reply) => {
      const clientId = request.query.client_id;
      if (!clientId) {
        reply.code(400);
        return { error: 'client_id is required' };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const rows = await db
        .select({
          id: schema.studioCanvasDocuments.id,
          clientId: schema.studioCanvasDocuments.clientId,
          projectId: schema.studioCanvasDocuments.projectId,
          name: schema.studioCanvasDocuments.name,
          width: schema.studioCanvasDocuments.width,
          height: schema.studioCanvasDocuments.height,
          thumbnailUrl: schema.studioCanvasDocuments.thumbnailUrl,
          pageCount: sql<number>`jsonb_array_length(${schema.studioCanvasDocuments.pages})`,
          createdAt: schema.studioCanvasDocuments.createdAt,
          updatedAt: schema.studioCanvasDocuments.updatedAt,
        })
        .from(schema.studioCanvasDocuments)
        .where(eq(schema.studioCanvasDocuments.clientId, clientId))
        .orderBy(desc(schema.studioCanvasDocuments.updatedAt));

      return {
        documents: rows.map((row) => ({
          id: row.id,
          client_id: row.clientId,
          project_id: row.projectId,
          name: row.name,
          width: row.width,
          height: row.height,
          thumbnail_url: row.thumbnailUrl,
          page_count: row.pageCount,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/studio/canvas-documents',
    { preHandler: [requireAuth, requirePermission('studio', 'write')] },
    async (request, reply) => {
      const body = createDocumentSchema.parse(request.body);
      if (!request.authUser || !(await hasClientAccess(request.authUser, body.client_id))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      // Primeira página já vem pronta (fundo branco) - documento nunca nasce sem nenhuma
      // página, evitando um estado intermediário que a UI teria que tratar como especial.
      const firstPage: CanvaPage = {
        id: crypto.randomUUID(),
        order: 0,
        background: { type: 'color', value: '#ffffff' },
        objects: [],
      };

      let doc: typeof schema.studioCanvasDocuments.$inferSelect | undefined;
      try {
        [doc] = await db
          .insert(schema.studioCanvasDocuments)
          .values({
            clientId: body.client_id,
            ownerId: request.authUser.id,
            projectId: body.project_id ?? null,
            name: body.name,
            width: body.width,
            height: body.height,
            pages: [firstPage],
          })
          .returning();
      } catch (error) {
        if (isForeignKeyViolation(error, 'client_id')) {
          reply.code(400);
          return { error: 'Este cliente não foi encontrado. Atualize a página e tente de novo.' };
        }
        if (isForeignKeyViolation(error, 'project_id')) {
          reply.code(400);
          return { error: 'Este projeto não foi encontrado. Atualize a página e tente de novo.' };
        }
        throw error;
      }

      if (!doc) {
        reply.code(500);
        return { error: 'Failed to create canvas document' };
      }

      reply.code(201);
      return toWire(doc);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/studio/canvas-documents/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const [doc] = await db
        .select()
        .from(schema.studioCanvasDocuments)
        .where(eq(schema.studioCanvasDocuments.id, request.params.id));
      if (!doc) {
        reply.code(404);
        return { error: `Canvas document '${request.params.id}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, doc.clientId))) {
        reply.code(403);
        return { error: 'No access granted to this document' };
      }
      return toWire(doc);
    },
  );

  /** Autosave chama isto a cada debounce - sempre parcial (só os campos que mudaram). */
  app.patch<{ Params: { id: string } }>(
    '/studio/canvas-documents/:id',
    { preHandler: [requireAuth, requirePermission('studio', 'write')] },
    async (request, reply) => {
      const body = updateDocumentSchema.parse(request.body);
      if (!request.authUser) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      const patch: Partial<typeof schema.studioCanvasDocuments.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.width !== undefined) patch.width = body.width;
      if (body.height !== undefined) patch.height = body.height;
      if (body.thumbnail_url !== undefined) patch.thumbnailUrl = body.thumbnail_url;
      if (body.pages !== undefined) patch.pages = body.pages;

      // Esta é a rota mais chamada do editor (o autosave bate aqui a cada
      // 1,5s de edição). Fazia SELECT + UPDATE em série = duas idas ao
      // Postgres remoto (~130ms cada, medidos daqui) por salvamento, com as
      // 3 conexões do pool ocupadas o dobro do tempo necessário. O SELECT
      // prévio existia só pra chamar `hasClientAccess` antes de escrever -
      // e hoje ela é sempre true pra qualquer autenticado (ver lib/access.ts,
      // decisão de 2026-09-03: cliente é compartilhado pela equipe inteira),
      // então a autorização real desta rota é o `studio:write` do
      // requirePermission acima. ATENÇÃO: se algum dia voltar escopo de
      // acesso por pessoa, este atalho tem que ser desfeito - autorizar
      // DEPOIS de escrever não autoriza nada.
      const [updated] = await db
        .update(schema.studioCanvasDocuments)
        .set(patch)
        .where(eq(schema.studioCanvasDocuments.id, request.params.id))
        .returning();
      if (!updated) {
        reply.code(404);
        return { error: `Canvas document '${request.params.id}' not found` };
      }
      return toWire(updated);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/studio/canvas-documents/:id/duplicate',
    { preHandler: [requireAuth, requirePermission('studio', 'write')] },
    async (request, reply) => {
      const [source] = await db
        .select()
        .from(schema.studioCanvasDocuments)
        .where(eq(schema.studioCanvasDocuments.id, request.params.id));
      if (!source) {
        reply.code(404);
        return { error: `Canvas document '${request.params.id}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, source.clientId))) {
        reply.code(403);
        return { error: 'No access granted to this document' };
      }

      let copy: typeof schema.studioCanvasDocuments.$inferSelect | undefined;
      try {
        [copy] = await db
          .insert(schema.studioCanvasDocuments)
          .values({
            clientId: source.clientId,
            ownerId: request.authUser.id,
            projectId: source.projectId,
            name: `${source.name} (cópia)`,
            width: source.width,
            height: source.height,
            thumbnailUrl: source.thumbnailUrl,
            pages: source.pages,
          })
          .returning();
      } catch (error) {
        if (isForeignKeyViolation(error, 'client_id') || isForeignKeyViolation(error, 'project_id')) {
          reply.code(400);
          return { error: 'O cliente ou projeto original não existe mais. Não foi possível duplicar.' };
        }
        throw error;
      }
      if (!copy) {
        reply.code(500);
        return { error: 'Failed to duplicate canvas document' };
      }
      reply.code(201);
      return toWire(copy);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/studio/canvas-documents/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.authUser) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      // Permissão primeiro (não custa banco): quem não pode apagar nada nem
      // chega a consultar. `hasClientAccess` hoje é sempre true (ver
      // lib/access.ts), então a autorização não depende de saber de qual
      // cliente é o documento - o que permite resolver tudo em UMA ida ao
      // banco em vez de duas. ATENÇÃO: se voltar escopo de acesso por
      // pessoa, isto precisa voltar a consultar o dono antes de apagar.
      const isMaster = request.authUser.roles.includes('master');
      if (!isMaster && !hasPermission(request.authUser.permissions, 'studio', 'write')) {
        reply.code(403);
        return { error: 'No access granted to this document' };
      }

      // Achado real (2026-09-11, "demora um século pra deletar um projeto"):
      // isto fazia SELECT e depois DELETE, em série. Contra o Postgres remoto
      // (~130ms de ida e volta medidos daqui) são ~260ms só aqui, somados aos
      // ~260ms que o requireAuth gastava (agora em cache) - com o autosave do
      // editor disputando as 3 conexões do pool, a exclusão ia pro fim da
      // fila. `returning` resolve o 404 e a exclusão de uma vez só.
      const deleted = await db
        .delete(schema.studioCanvasDocuments)
        .where(eq(schema.studioCanvasDocuments.id, request.params.id))
        .returning({ id: schema.studioCanvasDocuments.id });
      if (deleted.length === 0) {
        reply.code(404);
        return { error: `Canvas document '${request.params.id}' not found` };
      }

      reply.code(204);
      return;
    },
  );
}
