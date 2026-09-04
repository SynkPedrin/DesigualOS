import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { generateStudioJobId, getStudioJobQueue } from '@desigual-os/orchestrator';
import { generateStudioCopy } from '@desigual-os/router';
import { STUDIO_JOB_TYPES } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { hasClientAccess } from '../lib/access';
import { uploadUserFile } from '../lib/storage';

/**
 * Referências que o colaborador anexa pra guiar a criação. Imagem e PDF só:
 * é o que o Endrigo pediu, e aceitar qualquer coisa aqui vira porta de
 * upload arbitrário.
 */
const REFERENCE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;

const attachmentSchema = z.object({
  filename: z.string().min(1),
  url: z.string().url(),
  contentType: z.string().min(1),
});

const QUALITY_PRESETS = ['draft', 'standard', 'high'] as const;

const createJobSchema = z.object({
  client_id: z.string().uuid(),
  attachments: z.array(attachmentSchema).max(5).optional(),
  project_id: z.string().uuid().nullable().optional(),
  type: z.enum(STUDIO_JOB_TYPES),
  prompt: z.string().nullable().optional(),
  resolution: z.string().nullable().optional(),
  // Só carousel: quantas imagens gerar.
  num_slides: z.number().int().min(1).max(10).optional(),
  // Só video/reels: guardados mesmo enquanto a geração real não está ligada.
  duration_seconds: z.number().int().positive().optional(),
  quality_preset: z.enum(QUALITY_PRESETS).optional(),
  // image/carousel: se deve gerar copy de marketing e sobrepor texto nas imagens.
  include_text: z.boolean().optional(),
  // Só carousel: frames (URLs de imagem) pro caminho de carrossel HTML do
  // studio-node; metadata.design='html' força esse caminho mesmo sem frames.
  reference_images: z.array(z.string().url()).max(16).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function registerStudioRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/studio/jobs',
    { preHandler: [requireAuth, requirePermission('studio', 'write')] },
    async (request, reply) => {
      const body = createJobSchema.parse(request.body);

      // studio:write só garante que o colaborador pode usar o Studio em
      // geral, não que pode gastar GPU (custo real) em nome de um cliente
      // específico que ele não tem acesso, igual já é exigido pra ver o
      // workspace do cliente (GET /clients/:id/workspace).
      if (!request.authUser || !(await hasClientAccess(request.authUser, body.client_id))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const jobId = generateStudioJobId();
      const numSlides = body.type === 'carousel' ? (body.num_slides ?? 5) : 1;
      const includeText = body.include_text ?? true;

      // Copy de marketing (legenda + texto por slide) roda aqui — não no node da
      // RTX — porque é aqui que temos o checkout completo do monorepo
      // (Brain-Marketing/) e a única chave Anthropic configurada. Nunca derruba
      // a criação do job: em qualquer falha, generateStudioCopy devolve null e o
      // job segue sem copy (imagem/carousel sem texto sobreposto).
      let copy: Awaited<ReturnType<typeof generateStudioCopy>> = null;
      if ((body.type === 'image' || body.type === 'carousel') && includeText && body.prompt) {
        copy = await generateStudioCopy({
          objective: '',
          briefing: body.prompt,
          numSlides,
          logger: request.log,
        });
      }

      const [job] = await db
        .insert(schema.studioJobs)
        .values({
          jobId,
          clientId: body.client_id,
          requestedBy: request.authUser.id,
          projectId: body.project_id ?? null,
          type: body.type,
          prompt: body.prompt ?? null,
          resolution: body.resolution ?? null,
          attachments: body.attachments ?? [],
          status: 'queued',
          numSlides: body.type === 'carousel' ? numSlides : null,
          durationSeconds: body.duration_seconds ?? null,
          qualityPreset: body.quality_preset ?? null,
          includeText,
          caption: copy?.caption ?? null,
          copySlides: copy?.slides ?? null,
        })
        .returning();

      if (!job) {
        reply.code(500);
        return { error: 'Failed to create studio job' };
      }

      await getStudioJobQueue().add('generate', {
        studioJobDbId: job.id,
        jobId: job.jobId,
        clientId: body.client_id,
        requestedBy: request.authUser.id,
        projectId: body.project_id ?? null,
        type: body.type,
        prompt: body.prompt ?? null,
        resolution: body.resolution ?? null,
        attachments: body.attachments ?? [],
        numSlides: job.numSlides,
        durationSeconds: job.durationSeconds,
        qualityPreset: job.qualityPreset,
        includeText: job.includeText,
        copySlides: job.copySlides,
        referenceImages: body.reference_images,
        metadata: body.metadata,
      });

      reply.code(202);
      return { job_id: job.jobId, status: 'queued' };
    },
  );

  // Lista os jobs do PRÓPRIO usuário (seção "Studio continua gerando com o
  // usuário fora", 2026-09-02): a tela de Studio usa isso pra restaurar "meus
  // jobs em andamento" ao reabrir o modal/rota, já que o estado de
  // activeJobIds no frontend é só memória de componente e some ao remontar.
  // `status=active` filtra só queued/rendering (pra rehidratar a fila);
  // sem o filtro, devolve os mais recentes (qualquer status) como histórico.
  app.get<{ Querystring: { status?: string } }>('/studio/jobs', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.authUser) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const rows = await db
      .select()
      .from(schema.studioJobs)
      .where(eq(schema.studioJobs.requestedBy, request.authUser.id))
      .orderBy(desc(schema.studioJobs.createdAt))
      .limit(20);

    const filtered = request.query.status === 'active' ? rows.filter((row) => row.status === 'queued' || row.status === 'rendering' || row.status === 'running') : rows;

    return {
      jobs: filtered.map((row) => ({
        job_id: row.jobId,
        status: row.status,
        progress: row.progress,
        type: row.type,
        prompt: row.prompt,
        resolution: row.resolution,
        error: row.error,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/studio/jobs/:id', { preHandler: requireAuth }, async (request, reply) => {
    const [job] = await db.select().from(schema.studioJobs).where(eq(schema.studioJobs.jobId, request.params.id));
    if (!job) {
      reply.code(404);
      return { error: `Studio job '${request.params.id}' not found` };
    }

    const isMaster = request.authUser?.roles.includes('master');
    if (!isMaster && job.requestedBy !== null && job.requestedBy !== request.authUser?.id) {
      reply.code(403);
      return { error: 'No access granted to this job' };
    }

    let assetUrl: string | null = null;
    let assetUrls: string[] | null = null;
    if (job.assetId) {
      const [asset] = await db.select().from(schema.studioAssets).where(eq(schema.studioAssets.id, job.assetId));
      assetUrl = asset?.storageUrl ?? null;
    }
    // Carousel: mais de um asset gera pro mesmo job (ligados por metadata.job_id,
    // ver nodes/studio-node/src/index.ts), então asset_url sozinho não basta.
    if (job.type === 'carousel' && job.status === 'completed') {
      const siblings = await db
        .select()
        .from(schema.studioAssets)
        .where(eq(schema.studioAssets.clientId, job.clientId));
      const ordered = siblings
        .filter((row) => (row.metadata as Record<string, unknown>)?.job_id === job.jobId)
        .sort(
          (a, b) =>
            Number((a.metadata as Record<string, unknown>)?.slide_index ?? 0) -
            Number((b.metadata as Record<string, unknown>)?.slide_index ?? 0),
        );
      if (ordered.length > 0) assetUrls = ordered.map((row) => row.storageUrl);
    }

    return {
      job_id: job.jobId,
      status: job.status,
      progress: job.progress,
      type: job.type,
      prompt: job.prompt,
      resolution: job.resolution,
      error: job.error,
      attachments: job.attachments,
      asset_url: assetUrl,
      asset_urls: assetUrls,
      caption: job.caption,
    };
  });

  // Antes não exigia permissão nenhuma (só requireAuth) e sem ?client_id
  // devolvia os ativos de TODOS os clientes, inclusive os que o
  // colaborador não tinha acesso (o mesmo dado que GET
  // /clients/:id/workspace já protege direito). Agora exige studio:write
  // e, sem acesso de master, obriga informar um client_id que o usuário
  // realmente pode ver.
  app.get<{ Querystring: { client_id?: string } }>(
    '/studio/assets',
    { preHandler: [requireAuth, requirePermission('studio', 'write')] },
    async (request, reply) => {
      if (!request.authUser) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      const isMaster = request.authUser.roles.includes('master');
      if (!isMaster && !request.query.client_id) {
        reply.code(400);
        return { error: 'client_id is required for non-master users' };
      }
      if (request.query.client_id && !(await hasClientAccess(request.authUser, request.query.client_id))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      // LEFT JOIN em users pra galeria mostrar QUEM criou cada peça (spec da
      // Galeria: "cada conteúdo deve saber quem criou"). É left join porque
      // user_id é nulo em assets gerados antes dessa coluna passar a ser
      // preenchida, e some (on delete set null) se a conta for removida.
      const baseQuery = db
        .select({
          id: schema.studioAssets.id,
          clientId: schema.studioAssets.clientId,
          projectId: schema.studioAssets.projectId,
          type: schema.studioAssets.type,
          filename: schema.studioAssets.filename,
          storageUrl: schema.studioAssets.storageUrl,
          prompt: schema.studioAssets.prompt,
          model: schema.studioAssets.model,
          metadata: schema.studioAssets.metadata,
          createdAt: schema.studioAssets.createdAt,
          createdByName: schema.users.name,
        })
        .from(schema.studioAssets)
        .leftJoin(schema.users, eq(schema.studioAssets.userId, schema.users.id));

      const rows = request.query.client_id
        ? await baseQuery.where(eq(schema.studioAssets.clientId, request.query.client_id)).orderBy(desc(schema.studioAssets.createdAt)).limit(50)
        : await baseQuery.orderBy(desc(schema.studioAssets.createdAt)).limit(50);

      return {
        assets: rows.map((row) => ({
          id: row.id,
          client_id: row.clientId,
          project_id: row.projectId,
          type: row.type,
          filename: row.filename,
          storage_url: row.storageUrl,
          prompt: row.prompt,
          // "qual workflow" da spec: o modelo/checkpoint que gerou de fato.
          model: row.model,
          created_by: row.createdByName,
          node_id: (row.metadata as Record<string, unknown> | null)?.node_id ?? null,
          job_id: (row.metadata as Record<string, unknown> | null)?.job_id ?? null,
          slide_index: (row.metadata as Record<string, unknown> | null)?.slide_index ?? null,
          slides_total: (row.metadata as Record<string, unknown> | null)?.slides_total ?? null,
          caption: (row.metadata as Record<string, unknown> | null)?.caption ?? null,
          created_at: row.createdAt.toISOString(),
        })),
      };
    },
  );
  /**
   * Sobe um arquivo de referência (imagem ou PDF) pro Storage e devolve a
   * URL. O upload é um passo separado da criação do job de propósito: assim
   * a pessoa anexa, vê o que anexou e só então manda gerar — e um job nunca
   * nasce com referência pela metade.
   */
  app.post('/studio/references', { preHandler: [requireAuth, requirePermission('studio', 'write')] }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { error: 'No file sent' };
    }
    if (!REFERENCE_CONTENT_TYPES.has(file.mimetype)) {
      reply.code(400);
      return { error: `Tipo '${file.mimetype}' não aceito. Use PNG, JPEG, WEBP ou PDF.` };
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_REFERENCE_BYTES) {
      reply.code(413);
      return { error: 'Arquivo maior que 25MB.' };
    }

    // Nome no Storage não usa o nome original (evita colisão e caractere
    // estranho no path); o nome original volta no JSON só pra exibição.
    const extension = file.mimetype === 'application/pdf' ? 'pdf' : file.mimetype.split('/')[1];
    const path = `studio-references/${request.authUser!.id}/${Date.now()}-${randomUUID()}.${extension}`;
    const uploaded = await uploadUserFile(path, buffer, file.mimetype);

    return { filename: file.filename, url: uploaded.url, contentType: file.mimetype };
  });

}
