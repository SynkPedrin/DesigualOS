import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { generateStudioJobId, getStudioJobQueue, recordLearning, enqueueThumbnail } from '@desigual-os/orchestrator';
import { generateStudioCopy } from '@desigual-os/router';
import { generateImageCaption } from '@desigual-os/otto';
import { hasPermission } from '@desigual-os/auth';
import {
  STUDIO_BRAND_PLACEMENTS,
  STUDIO_JOB_TYPES,
  STUDIO_QUALITY_PRESETS,
  STUDIO_REFERENCE_FIDELITY,
  STUDIO_REFERENCE_ROLES,
  STUDIO_STYLES,
} from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { hasClientAccess } from '../lib/access';
import { claimIdempotency, fulfillIdempotency, idempotencyKey, releaseIdempotency } from '../lib/idempotency';
import { deleteStudioAssetFile, uploadUserFile } from '../lib/storage';
import { recordOttoFeedbackLearning } from './otto-learnings';

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
  role: z.enum(STUDIO_REFERENCE_ROLES).optional(),
  fidelity: z.enum(STUDIO_REFERENCE_FIDELITY).optional(),
  instruction: z.string().min(1).optional(),
  placement: z.enum(STUDIO_BRAND_PLACEMENTS).optional(),
});

/** Só valores potência-de-2-ish que a tela do Studio oferece; relevante só pra type='image'. */
const ALLOWED_VARIATIONS = [1, 2, 4, 6, 8];

const createJobSchema = z.object({
  client_id: z.string().uuid(),
  attachments: z.array(attachmentSchema).max(10).optional(),
  project_id: z.string().uuid().nullable().optional(),
  type: z.enum(STUDIO_JOB_TYPES),
  prompt: z.string().nullable().optional(),
  resolution: z.string().nullable().optional(),
  // Só carousel: quantas imagens gerar.
  num_slides: z.number().int().min(1).max(10).optional(),
  // Só video/reels: duração em segundos (o worker H3 usa; default 5 lá).
  duration_seconds: z.number().int().positive().optional(),
  quality_preset: z.enum(STUDIO_QUALITY_PRESETS).optional(),
  // image/carousel: se deve gerar copy de marketing e sobrepor texto nas imagens.
  include_text: z.boolean().optional(),
  // Só image: quantas variações do mesmo prompt gerar (cada uma um asset próprio).
  variations: z
    .number()
    .int()
    .refine((value) => ALLOWED_VARIATIONS.includes(value), { message: `variations must be one of ${ALLOWED_VARIATIONS.join(', ')}` })
    .default(1),
  style: z.enum(STUDIO_STYLES).default('padrao'),
  // Só carousel: frames (URLs de imagem) pro caminho de carrossel HTML do
  // studio-node; metadata.design='html' força esse caminho mesmo sem frames.
  reference_images: z.array(z.string().url()).max(16).optional(),
  metadata: z.record(z.unknown()).optional(),
}).refine(
  (body) => {
    // Achado real (2026-09-11): prompt era opcional pra TODO tipo de job,
    // inclusive image/video/reels, que sempre precisam de um de verdade -
    // `POST /studio/jobs` com prompt ausente/vazio virava 202 aceito e o
    // studio-node gerava com `(prompt ?? '') + slideHint` (nodes/studio-node/
    // src/index.ts) - uma geração real, cobrada de verdade na GPU, com
    // prompt vazio, sem nenhum aviso pro usuário antes de disparar. `upscale`
    // não precisa (opera sobre um anexo existente); `carousel` também não
    // quando é o caminho de carrossel HTML pronto (reference_images ou
    // metadata.design='html' - ver comentário de reference_images acima).
    if (body.type === 'upscale') return true;
    if (body.type === 'carousel' && ((body.reference_images?.length ?? 0) > 0 || body.metadata?.design === 'html')) return true;
    return typeof body.prompt === 'string' && body.prompt.trim().length > 0;
  },
  { message: 'prompt is required for this job type', path: ['prompt'] },
);

/**
 * Achado real (2026-09-11): tanto GET /studio/jobs/:id (carousel) quanto
 * DELETE /studio/jobs/:id puxavam TODOS os assets do cliente pra memória da
 * API (`where(clientId=...)`, sem filtro nenhum de job) só pra filtrar por
 * `metadata.job_id === jobId` DEPOIS, em JS - exatamente o mesmo formato do
 * bug já corrigido em health/routes.ts (N+1/full-scan). Cliente com
 * histórico grande de Studio faz isso escalar mal e arrisca timeout. Como
 * `studio_assets` não tem coluna `job_id` própria (só dentro do jsonb
 * `metadata`, sem migração pra mudar isso agora), filtra pelo jsonb DIRETO
 * no Postgres via `sql` - só as linhas do job realmente voltam pra API,
 * nunca o histórico inteiro do cliente.
 */
async function findAssetsByJobId(clientId: string, jobId: string) {
  return db
    .select()
    .from(schema.studioAssets)
    .where(and(eq(schema.studioAssets.clientId, clientId), sql`${schema.studioAssets.metadata} ->> 'job_id' = ${jobId}`));
}

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

      // Idempotência de intenção (mesmo padrão do /chat e /clickup/tasks,
      // auditoria 11/09/2026): double click em "gerar" não pode virar 2 jobs
      // de GPU. A chave cobre cliente+tipo+prompt+anexos; a janela de 15s
      // bloqueia só o gesto duplicado, não uma geração proposital repetida.
      const idemKey = idempotencyKey('studio-job', [
        request.authUser.id,
        body.client_id,
        body.type,
        body.prompt ?? '',
        String(body.num_slides ?? ''),
        String(body.variations ?? ''),
        ...(body.attachments ?? []).map((a) => a.url),
      ]);
      const existing = await claimIdempotency(idemKey);
      if (existing !== null) {
        if (existing !== 'pending') {
          reply.code(202);
          return { job_id: existing, status: 'queued', deduplicated: true };
        }
        reply.code(409);
        return { error: 'Esta geração idêntica já está em andamento. Aguarde um instante.' };
      }

      try {

      const jobId = generateStudioJobId();
      const numSlides = body.type === 'carousel' ? (body.num_slides ?? 5) : 1;
      // Achado real (09/09/2026): generateStudioCopy tem persona e regras fixas
      // do Cinema Impossível (@endrigoalmada, "abrir com verso de canção") -
      // com o default antigo (true), QUALQUER cliente sem relação com música
      // (testado com John Deere) recebia legenda/headline sobre letra de
      // música brasileira, às vezes composta em cima da própria imagem
      // gerada. Copy automática agora só roda quando pedida explicitamente.
      const includeText = body.include_text ?? false;
      // Variações só fazem sentido pra geração de imagem única; nos demais
      // tipos o parâmetro é ignorado de propósito (carousel já tem num_slides).
      const variations = body.type === 'image' ? body.variations : 1;

      // Snapshot do brand kit no metadata do job: o worker aplica
      // paleta/tom no prompt sem precisar consultar o banco de novo, e o job
      // fica reproduzível mesmo se o kit mudar depois. Ausência de kit não
      // derruba a criação do job.
      const [brandKit] = await db.select().from(schema.clientBrandKits).where(eq(schema.clientBrandKits.clientId, body.client_id));
      const jobMetadata: Record<string, unknown> = { ...body.metadata };
      if (brandKit) {
        jobMetadata.brand_kit = {
          logo_url: brandKit.logoUrl,
          colors: brandKit.colors,
          fonts: brandKit.fonts,
          tone_of_voice: brandKit.toneOfVoice,
        };
      }

      // Copy de marketing (legenda + texto por slide) roda aqui - não no node da
      // RTX - porque é aqui que temos o checkout completo do monorepo
      // (Brain-Marketing/) e o Ollama do Studio como LLM (sem chave paga).
      // Nunca derruba a criação do job: generateStudioCopy já tem seu próprio
      // AbortSignal.timeout de 120s, mas medido ao vivo (2026-09-08) uma
      // chamada ficou pendurada além disso mesmo assim - rede real entre
      // duas máquinas via Tailscale pode travar de jeitos que o abort do
      // fetch não cobre (ex: conexão aceita mas corpo da resposta nunca
      // fecha). Este timeout aqui é a rede de segurança final: nunca deixa
      // a criação do job esperar mais que isso, com ou sem copy.
      let copy: Awaited<ReturnType<typeof generateStudioCopy>> = null;
      if ((body.type === 'image' || body.type === 'carousel') && includeText && body.prompt) {
        const copyTimeout = new Promise<null>((resolvePromise) => {
          setTimeout(() => resolvePromise(null), 20_000);
        });
        copy = await Promise.race([
          generateStudioCopy({
            objective: '',
            briefing: body.prompt,
            numSlides,
            logger: request.log,
          }),
          copyTimeout,
        ]);
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
          style: body.style,
          variations,
          metadata: jobMetadata,
          caption: copy?.caption ?? null,
          // Normaliza pro shape declarado no schema (headline + subtext sem
          // null): a copy do router traz subtext nullable e chaves extras que
          // nenhum consumidor de copy_slides lê (studio-node usa headline/subtext).
          copySlides: copy?.slides.map((slide) => ({
            headline: slide.headline,
            ...(slide.subtext != null ? { subtext: slide.subtext } : {}),
          })) ?? null,
        })
        .returning();

      if (!job) {
        await releaseIdempotency(idemKey);
        reply.code(500);
        return { error: 'Failed to create studio job' };
      }

      // O insert acima e o enqueue abaixo não são atômicos (BullMQ/Redis é
      // externo ao Postgres, uma transação de banco não cobre os dois). Sem
      // este try/catch, uma falha no enqueue (ex: soneca do Redis) deixava a
      // linha em 'queued' pra sempre - nenhum worker nunca ia pegá-la, e
      // GET /studio/jobs?status=active reportava esse job como "em
      // progresso" indefinidamente pra quem estivesse monitorando (achado da
      // certificação de pré-release, 2026-09-09). Marcar como 'failed' aqui
      // torna o estado imediatamente honesto em vez de um job fantasma.
      try {
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
          style: job.style,
          variations: job.variations,
          referenceImages: body.reference_images,
          metadata: jobMetadata,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db
          .update(schema.studioJobs)
          .set({ status: 'failed', error: `Falha ao enfileirar o job: ${message}` })
          .where(eq(schema.studioJobs.id, job.id));
        request.log.error({ error, jobId: job.jobId }, 'Failed to enqueue studio job after insert');
        await releaseIdempotency(idemKey);
        reply.code(502);
        return { error: 'Failed to queue studio job for generation. Please try again.' };
      }

      await fulfillIdempotency(idemKey, job.jobId);

      reply.code(202);
      return { job_id: job.jobId, status: 'queued' };
      } catch (error) {
        // Falha no meio do caminho: libera a chave pra não bloquear o retry
        // legítimo do usuário com um 409 fantasma.
        await releaseIdempotency(idemKey);
        throw error;
      }
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

    // Achado real (2026-09-11): o filtro `status=active` rodava DEPOIS do
    // `.limit(20)`, sobre jobs de QUALQUER status - um usuário com 20+ jobs
    // mais recentes (qualquer status, ex: de outras sessões) fazia um job
    // ainda `queued`/`rendering` mais antigo cair fora da janela de 20 antes
    // mesmo do filtro rodar, e essa é justamente a rota que "restaura meus
    // jobs em andamento" ao reabrir o Studio - o job continuava processando
    // de verdade na GPU, só sumia da tela. Filtrar no WHERE (antes do LIMIT)
    // corrige isso pro caso ativo; o histórico completo (sem filtro) ainda
    // usa os 20 mais recentes normalmente.
    // Lista invertida (só os 2 estados TERMINAIS), não uma lista de "quais
    // status contam como ativo": StudioJobStatus (packages/types/src/studio.ts)
    // documenta 9 estágios extras do pipeline adaptativo (planning,
    // quality_check, refining, post_processing, uploading,
    // keyframe_generation, keyframe_qa, video_draft, motion_qa, video_master,
    // video_qa) como valores válidos - uma lista de permitidos aqui (que
    // antes incluía até 'running', um valor que não existe no tipo) ficaria
    // desatualizada no dia em que qualquer um desses passasse a ser emitido
    // de verdade, fazendo o job sumir desta mesma rota de novo.
    const statusFilter =
      request.query.status === 'active'
        ? and(eq(schema.studioJobs.requestedBy, request.authUser.id), notInArray(schema.studioJobs.status, ['completed', 'failed']))
        : eq(schema.studioJobs.requestedBy, request.authUser.id);

    const rows = await db.select().from(schema.studioJobs).where(statusFilter).orderBy(desc(schema.studioJobs.createdAt)).limit(20);

    return {
      jobs: rows.map((row) => ({
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
      const siblings = await findAssetsByJobId(job.clientId, job.jobId);
      const ordered = siblings.sort(
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
      style: job.style,
      variations: job.variations,
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
  const ASSET_TYPE_FILTERS = ['image', 'carousel', 'video', 'reels'] as const;
  const MAX_ASSETS_PER_PAGE = 100;

  // Escapa os curingas do LIKE pra busca ser literal: sem isso, digitar "%"
  // na busca casaria com tudo e "_" com qualquer caractere.
  function escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
  }

  app.get<{
    Querystring: { client_id?: string; type?: string; q?: string; limit?: string; offset?: string };
  }>(
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

      const typeFilter = ASSET_TYPE_FILTERS.find((value) => value === request.query.type);
      if (request.query.type && !typeFilter) {
        reply.code(400);
        return { error: `type must be one of ${ASSET_TYPE_FILTERS.join(', ')}` };
      }
      const parsedLimit = Number.parseInt(request.query.limit ?? '', 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), MAX_ASSETS_PER_PAGE) : 24;
      const parsedOffset = Number.parseInt(request.query.offset ?? '', 10);
      const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

      const conditions = [];
      if (request.query.client_id) conditions.push(eq(schema.studioAssets.clientId, request.query.client_id));
      if (typeFilter) conditions.push(eq(schema.studioAssets.type, typeFilter));
      const search = request.query.q?.trim();
      if (search) {
        const pattern = `%${escapeLikePattern(search)}%`;
        conditions.push(or(ilike(schema.studioAssets.prompt, pattern), ilike(schema.studioAssets.filename, pattern)));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow] = await db.select({ value: count() }).from(schema.studioAssets).where(where);

      // LEFT JOIN em users pra galeria mostrar QUEM criou cada peça (spec da
      // Galeria: "cada conteúdo deve saber quem criou"). É left join porque
      // user_id é nulo em assets gerados antes dessa coluna passar a ser
      // preenchida, e some (on delete set null) se a conta for removida.
      const rows = await db
        .select({
          id: schema.studioAssets.id,
          clientId: schema.studioAssets.clientId,
          projectId: schema.studioAssets.projectId,
          type: schema.studioAssets.type,
          filename: schema.studioAssets.filename,
          storageUrl: schema.studioAssets.storageUrl,
          thumbUrl: schema.studioAssets.thumbUrl,
          prompt: schema.studioAssets.prompt,
          model: schema.studioAssets.model,
          metadata: schema.studioAssets.metadata,
          createdAt: schema.studioAssets.createdAt,
          createdByName: schema.users.name,
        })
        .from(schema.studioAssets)
        .leftJoin(schema.users, eq(schema.studioAssets.userId, schema.users.id))
        .where(where)
        .orderBy(desc(schema.studioAssets.createdAt))
        .limit(limit)
        .offset(offset);

      // Assets de imagem sem thumbnail: dispara a geração em background
      // (fila studio-thumbnails, jobId=assetId idempotente). Fire-and-forget:
      // a listagem nunca espera o sharp; até a thumb existir o front usa o
      // original (fallback no contrato).
      const missingThumbs = rows.filter((row) => !row.thumbUrl && /\.(png|jpe?g|webp)$/i.test(row.filename));
      if (missingThumbs.length > 0) {
        void Promise.all(missingThumbs.map((row) => enqueueThumbnail(row.id).catch(() => null)));
      }

      return {
        assets: rows.map((row) => ({
          id: row.id,
          client_id: row.clientId,
          project_id: row.projectId,
          type: row.type,
          filename: row.filename,
          storage_url: row.storageUrl,
          thumb_url: row.thumbUrl,
          prompt: row.prompt,
          // "qual workflow" da spec: o modelo/checkpoint que gerou de fato.
          model: row.model,
          created_by: row.createdByName,
          node_id: (row.metadata as Record<string, unknown> | null)?.node_id ?? null,
          job_id: (row.metadata as Record<string, unknown> | null)?.job_id ?? null,
          slide_index: (row.metadata as Record<string, unknown> | null)?.slide_index ?? null,
          slides_total: (row.metadata as Record<string, unknown> | null)?.slides_total ?? null,
          variation_index: (row.metadata as Record<string, unknown> | null)?.variation_index ?? null,
          variations_total: (row.metadata as Record<string, unknown> | null)?.variations_total ?? null,
          caption: (row.metadata as Record<string, unknown> | null)?.caption ?? null,
          created_at: row.createdAt.toISOString(),
        })),
        total: totalRow?.value ?? 0,
      };
    },
  );

  /**
   * Remove um asset da galeria (pedido da nova tela de Studio): apaga o
   * objeto do bucket 'studio-assets' e a linha no banco. Se o objeto já não
   * estiver no Storage (ex: removido à mão), o delete do banco segue mesmo
   * assim - o registro órfão é o problema pior.
   */
  app.delete<{ Params: { id: string } }>('/studio/assets/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.authUser) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const [asset] = await db.select().from(schema.studioAssets).where(eq(schema.studioAssets.id, request.params.id));
    if (!asset) {
      reply.code(404);
      return { error: `Studio asset '${request.params.id}' not found` };
    }

    const isMaster = request.authUser.roles.includes('master');
    const canWriteForClient =
      hasPermission(request.authUser.permissions, 'studio', 'write') && (await hasClientAccess(request.authUser, asset.clientId));
    if (!isMaster && !canWriteForClient) {
      reply.code(403);
      return { error: 'No access granted to this asset' };
    }

    try {
      await deleteStudioAssetFile(asset.storageUrl);
    } catch (error) {
      request.log.warn({ error, assetId: asset.id }, 'Falha ao remover objeto do Storage; deletando registro mesmo assim');
    }
    await db.delete(schema.studioAssets).where(eq(schema.studioAssets.id, asset.id));

    reply.code(204);
    return;
  });

  /**
   * Gera a legenda de um asset SOB DEMANDA (botão manual "Gerar legenda com
   * Otto"). Achado da certificação de pré-release (2026-09-10): a geração
   * automática de copy na criação do job foi desligada de propósito - toda
   * imagem estava recebendo legenda automática de uma persona fixa ("Cinema
   * Impossível") que nunca olhava a imagem de verdade, então clientes sem
   * nenhuma relação com aquele projeto (ex: John Deere) recebiam legenda
   * sobre letra de música. Este endpoint substitui isso: manda a imagem já
   * gerada + o briefing original + o BrandKit real do cliente pro Otto
   * analisar (packages/otto: generateImageCaption), sob pedido explícito.
   */
  app.post<{ Params: { id: string } }>(
    '/studio/assets/:id/caption',
    { preHandler: [requireAuth, requirePermission('studio', 'write')] },
    async (request, reply) => {
      const [asset] = await db.select().from(schema.studioAssets).where(eq(schema.studioAssets.id, request.params.id));
      if (!asset) {
        reply.code(404);
        return { error: `Studio asset '${request.params.id}' not found` };
      }

      if (!request.authUser || !(await hasClientAccess(request.authUser, asset.clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const [brandKit] = await db
        .select()
        .from(schema.clientBrandKits)
        .where(eq(schema.clientBrandKits.clientId, asset.clientId));

      let result: Awaited<ReturnType<typeof generateImageCaption>>;
      try {
        result = await generateImageCaption({
          imageUrl: asset.storageUrl,
          briefing: asset.prompt ?? '',
          brandKit: brandKit?.toneOfVoice ? { toneOfVoice: brandKit.toneOfVoice } : null,
          logger: request.log,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        request.log.error({ error, assetId: asset.id }, 'Failed to generate image caption');
        reply.code(502);
        return { error: `Não consegui gerar a legenda: ${message}` };
      }

      if (!result) {
        reply.code(502);
        return { error: 'Não consegui gerar a legenda agora. Tente de novo.' };
      }

      const existingMetadata = (asset.metadata as Record<string, unknown> | null) ?? {};
      await db
        .update(schema.studioAssets)
        .set({ metadata: { ...existingMetadata, caption: result.caption, hashtags: result.hashtags } })
        .where(eq(schema.studioAssets.id, asset.id));

      return { caption: result.caption, hashtags: result.hashtags };
    },
  );

  /**
   * Remove um job e TODOS os assets que ele gerou (ligados por
   * metadata.job_id, ver nodes/studio-node/src/index.ts): sem isso, apagar
   * o job deixaria as peças órfãs na galeria sem rastro de onde vieram.
   * Dono do job, master ou quem tem studio:write no cliente podem apagar.
   */
  app.delete<{ Params: { id: string } }>('/studio/jobs/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.authUser) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const [job] = await db.select().from(schema.studioJobs).where(eq(schema.studioJobs.jobId, request.params.id));
    if (!job) {
      reply.code(404);
      return { error: `Studio job '${request.params.id}' not found` };
    }

    const isMaster = request.authUser.roles.includes('master');
    const isOwner = job.requestedBy !== null && job.requestedBy === request.authUser.id;
    const canWriteForClient =
      hasPermission(request.authUser.permissions, 'studio', 'write') && (await hasClientAccess(request.authUser, job.clientId));
    if (!isMaster && !isOwner && !canWriteForClient) {
      reply.code(403);
      return { error: 'No access granted to this job' };
    }

    // Achado real (2026-09-11): isto buscava TODOS os assets do cliente (ver
    // findAssetsByJobId) e depois apagava um de cada vez - um Storage delete
    // e um DB delete SEQUENCIAIS por asset. Um carrossel/variações de 10-20
    // slides virava 20+ roundtrips de rede um atrás do outro dentro da MESMA
    // requisição HTTP, escalando linearmente com o tamanho do job e
    // arriscando timeout. Storage deletes agora rodam em paralelo
    // (Promise.allSettled - uma falha isolada de Storage não impede as
    // outras nem trava o delete do registro, mesmo comportamento tolerante
    // de antes) e o delete no banco vira UMA query com `inArray`, não N.
    const jobAssets = await findAssetsByJobId(job.clientId, job.jobId);
    if (jobAssets.length > 0) {
      await Promise.allSettled(
        jobAssets.map(async (asset) => {
          try {
            await deleteStudioAssetFile(asset.storageUrl);
          } catch (error) {
            request.log.warn({ error, assetId: asset.id }, 'Falha ao remover objeto do Storage; deletando registro mesmo assim');
          }
        }),
      );
      await db.delete(schema.studioAssets).where(
        inArray(
          schema.studioAssets.id,
          jobAssets.map((asset) => asset.id),
        ),
      );
    }
    await db.delete(schema.studioJobs).where(eq(schema.studioJobs.jobId, job.jobId));

    reply.code(204);
    return;
  });

  /**
   * Sobe um arquivo de referência (imagem ou PDF) pro Storage e devolve a
   * URL. O upload é um passo separado da criação do job de propósito: assim
   * a pessoa anexa, vê o que anexou e só então manda gerar - e um job nunca
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

  /**
   * Feedback humano sobre um asset (loop de aprendizado do Otto): approved /
   * rejected / needs_iteration, com motivo opcional. O verdict vira
   * `metadata.feedback` do asset, um aprendizado `otto.feedback` em
   * memories (packages/orchestrator/src/learning.ts) E uma evidência no
   * funil de confiança (otto-learnings.ts -> packages/otto/src/learning/
   * pipeline.ts), que é o que promove observações a regras confiáveis
   * (validated pra cima só com evidência humana; core só com o diretor).
   *
   * `reason` é opcional de propósito: exigir texto bloquearia o feedback
   * rápido de um clique ("aprovado"), e feedback fácil demais de dar é o que
   * mantém o loop girando.
   */
  const feedbackSchema = z.object({
    verdict: z.enum(['approved', 'rejected', 'needs_iteration']),
    reason: z.string().min(1).optional(),
    context: z.string().optional(),
  });

  app.post<{ Params: { id: string } }>(
    '/studio/assets/:id/feedback',
    { preHandler: [requireAuth, requirePermission('studio', 'write')] },
    async (request, reply) => {
      if (!request.authUser) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const body = feedbackSchema.parse(request.body);

      const [asset] = await db.select().from(schema.studioAssets).where(eq(schema.studioAssets.id, request.params.id));
      if (!asset) {
        reply.code(404);
        return { error: `Studio asset '${request.params.id}' not found` };
      }

      // Mesmo critério do DELETE /studio/assets/:id: studio:write no geral +
      // acesso ao cliente dono do asset (master passa direto).
      const isMaster = request.authUser.roles.includes('master');
      if (!isMaster && !(await hasClientAccess(request.authUser, asset.clientId))) {
        reply.code(403);
        return { error: 'No access granted to this asset' };
      }

      const feedback = {
        verdict: body.verdict,
        ...(body.reason ? { reason: body.reason } : {}),
        ...(body.context ? { context: body.context } : {}),
        by: request.authUser.id,
        at: new Date().toISOString(),
      };
      const metadata = { ...asset.metadata, feedback };
      const [updated] = await db
        .update(schema.studioAssets)
        .set({ metadata, updatedAt: new Date() })
        .where(eq(schema.studioAssets.id, asset.id))
        .returning();
      if (!updated) {
        reply.code(500);
        return { error: 'Failed to record feedback' };
      }

      // recordLearning nunca lança (aprender é efeito colateral); o agent
      // resolvido é o que GEROU o asset, não sempre 'otto'.
      await recordLearning({
        kind: 'otto.feedback',
        content: `Feedback '${body.verdict}' no asset ${asset.id} (${asset.type})${body.reason ? `: ${body.reason}` : '.'}`,
        agent: asset.agent,
        clientId: asset.clientId,
        userId: request.authUser.id,
        metadata: {
          asset_id: asset.id,
          job_id: asset.metadata.job_id ?? null,
          verdict: body.verdict,
          ...(body.reason ? { reason: body.reason } : {}),
        },
      });

      // Funil de confiança do Otto (packages/otto/src/learning/pipeline.ts):
      // o feedback vira EVIDÊNCIA num aprendizado persistente por motivo e
      // tenta promoção de estágio. Master conta como 'director' — sem origem
      // humana/diretor o funil nunca passa de experimental. Nunca lança.
      const learningResult = await recordOttoFeedbackLearning({
        clientId: asset.clientId,
        userId: request.authUser.id,
        assetId: asset.id,
        verdict: body.verdict,
        reason: body.reason,
        isDirector: isMaster,
      });

      return {
        id: updated.id,
        client_id: updated.clientId,
        type: updated.type,
        feedback,
        learning: learningResult
          ? { stage: learningResult.stage, promoted: learningResult.promoted }
          : null,
      };
    },
  );
}
