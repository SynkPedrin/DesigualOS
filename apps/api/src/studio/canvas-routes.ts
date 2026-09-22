import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { CANVA_BLEND_MODES, type CanvaPage } from '@desigual-os/types';
import { hasPermission } from '@desigual-os/auth';
import { requireAuth, requirePermission } from '../auth/middleware';
import { hasClientAccess } from '../lib/access';
import { claimIdempotency, fulfillIdempotency, idempotencyKey, releaseIdempotency } from '../lib/idempotency';

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
  // Nome da camada dado pelo usuário. Sem este campo o zod DESCARTA a
  // propriedade em silêncio ao validar o PATCH: medido em 17/09/2026 que
  // renomear aparecia na tela e sumia no F5, porque o front enviava o nome e
  // o servidor gravava o objeto sem ele. Schema de runtime precisa
  // acompanhar o tipo (packages/types/src/canva.ts).
  name: z.string().optional(),
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

/**
 * Exportado para teste. O schema de runtime é o ponto onde o documento do
 * usuário pode perder informação em SILÊNCIO - o zod descarta propriedade
 * desconhecida sem erro nenhum, então um campo que falte aqui vira "aparece
 * na tela e some no F5" (aconteceu com `name` da camada, medido em
 * 17/09/2026). Deixar isto testável é mais barato que descobrir de novo pelo
 * navegador.
 */
export const updateDocumentSchema = z.object({
  name: z.string().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  pages: z.array(pageSchema).optional(),
  /**
   * Concorrência otimista (§53). A versão que o cliente acredita estar
   * editando. Quando vem, a gravação só acontece se o banco ainda estiver
   * nela - senão outra pessoa salvou nesse meio-tempo e a resposta é 409 com
   * o estado atual, em vez de apagar o trabalho dela.
   *
   * Opcional por compatibilidade: cliente antigo (ou script) que não manda
   * versão continua funcionando como antes, com último-a-escrever-vence. O
   * editor manda sempre - ver useUpdateCanvaDocument em use-canva-documents.ts.
   */
  version: z.number().int().positive().optional(),
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
    version: row.version,
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

      /**
       * Dedup de intenção duplicada (§12 e Teste 16 da auditoria de
       * prontidão, 18/09/2026). Medido ao vivo contra a API real: CINCO POSTs
       * simultâneos e idênticos de "novo design" criaram CINCO documentos,
       * todos 201. As outras três criações com efeito colateral do sistema
       * (chat, job do Studio, task do ClickUp) já tinham esta proteção desde
       * 11/09; esta ficou de fora.
       *
       * Não é destrutivo como uma task duplicada no ClickUp, mas é sujeira que
       * só a pessoa consegue limpar, um a um, na grade de designs dela.
       *
       * Mesma janela curta das outras: clique duplo e retry de rede caem
       * dentro; criar dois designs iguais de propósito, depois dos 15s, segue
       * possível.
       */
      const idemKey = idempotencyKey('canvas-doc', [
        request.authUser.id,
        body.client_id,
        body.project_id ?? '',
        body.name,
        String(body.width),
        String(body.height),
      ]);
      const existing = await claimIdempotency(idemKey);
      if (existing !== null) {
        if (existing !== 'pending') {
          try {
            reply.code(201);
            return JSON.parse(existing) as unknown;
          } catch {
            // valor corrompido: cai no 409 abaixo
          }
        }
        reply.code(409);
        return { error: 'Este design já está sendo criado. Aguarde um instante.' };
      }

      try {

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
          await releaseIdempotency(idemKey);
          reply.code(400);
          return { error: 'Este cliente não foi encontrado. Atualize a página e tente de novo.' };
        }
        if (isForeignKeyViolation(error, 'project_id')) {
          await releaseIdempotency(idemKey);
          reply.code(400);
          return { error: 'Este projeto não foi encontrado. Atualize a página e tente de novo.' };
        }
        throw error;
      }

      if (!doc) {
        // Liberar a chave é o que permite o retry legítimo: sem isso a pessoa
        // ficaria 15s sem conseguir tentar de novo depois de uma falha nossa.
        await releaseIdempotency(idemKey);
        reply.code(500);
        return { error: 'Failed to create canvas document' };
      }

      const criado = toWire(doc);
      await fulfillIdempotency(idemKey, JSON.stringify(criado));
      reply.code(201);
      return criado;
      } catch (error) {
        await releaseIdempotency(idemKey);
        throw error;
      }
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
      // Toda gravação avança a versão, inclusive a de cliente que não mandou
      // `version`: senão quem MANDA ficaria cego pro que esse cliente escreveu.
      patch.version = sql`${schema.studioCanvasDocuments.version} + 1` as unknown as number;

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
      //
      // A condição de versão (quando enviada) vai no mesmo UPDATE: continua
      // sendo UMA ida ao banco, e o `returning` vazio já é a própria detecção
      // do conflito. Ler antes pra comparar reabriria a corrida que isto fecha.
      const [updated] = await db
        .update(schema.studioCanvasDocuments)
        .set(patch)
        .where(
          body.version === undefined
            ? eq(schema.studioCanvasDocuments.id, request.params.id)
            : and(
                eq(schema.studioCanvasDocuments.id, request.params.id),
                eq(schema.studioCanvasDocuments.version, body.version),
              ),
        )
        .returning();

      if (!updated) {
        // Nada gravado: ou o documento não existe, ou a versão não bate. São
        // respostas diferentes - 404 manda o editor fechar, 409 manda ele
        // reconciliar - e distinguir custa uma consulta que só acontece no
        // caminho de erro.
        const [atual] = await db
          .select()
          .from(schema.studioCanvasDocuments)
          .where(eq(schema.studioCanvasDocuments.id, request.params.id));
        if (!atual) {
          reply.code(404);
          return { error: `Canvas document '${request.params.id}' not found` };
        }
        reply.code(409);
        return {
          error:
            'Outra pessoa salvou este design enquanto você editava. Recarregue para ver a versão atual antes de continuar - salvar por cima apagaria o trabalho dela.',
          conflict: true,
          document: toWire(atual),
        };
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
      // chega a consultar.
      //
      // P0-02 (auditoria de release readiness, 22/09/2026): o comentário
      // antigo aqui dizia "hasClientAccess hoje é sempre true" — não é mais
      // verdade desde que `hasClientAccess`/`tenantSharingScope` passaram a
      // checar membership de organização de verdade (lib/access.ts). Mas
      // ESTA rota nunca usou `hasClientAccess`: o alcance global do master
      // aqui é a MESMA decisão preservada em todo o resto do P0-02 desta
      // release (conversations/routes.ts, executions/routes.ts,
      // search/routes.ts, tool-calls/routes.ts, ws/routes.ts) — master é
      // administrador global por desenho, não um escopo esquecido. Hoje o
      // banco real tem UMA organização só, então o alcance cross-tenant
      // aqui tem raio de explosão zero na prática. Se uma segunda
      // organização entrar em produção, master passa a precisar de escopo
      // próprio em toda rota de escrita — não só aqui — e isso é trabalho
      // de arquitetura (rever o papel master inteiro), não um fix pontual
      // desta rota.
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
        .where(
          isMaster
            ? eq(schema.studioCanvasDocuments.id, request.params.id)
            : and(
                eq(schema.studioCanvasDocuments.id, request.params.id),
                eq(schema.studioCanvasDocuments.ownerId, request.authUser.id),
              ),
        )
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
