import { eq } from 'drizzle-orm';
import { Worker, type Job } from 'bullmq';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { STUDIO_JOBS_QUEUE_NAME, getRedisConnection, publishWsEvent, recordLearning, type StudioJobData } from '@desigual-os/orchestrator';
import { loadConfig } from './config';
import { generateImageViaComfyUI, resolveCheckpointName, stepsForQuality } from './comfyui-client';
import { parseResolution, snapToFluxGrid } from './generate';
import { enrichImagePrompt } from './prompt-quality';
import { compositeSlideText, type SlideText } from './text-overlay';
import { renderCarouselCards, type CardData, type CardLayout, type CarouselMeta } from './html-carousel/renderer';
import { uploadAsset } from './storage';

const logger = createLogger({ service: 'studio-node' });
const config = loadConfig();

// Resolvido uma vez e cacheado: nome de arquivo de modelo não muda no meio
// da execução do processo, e resolver de novo a cada job só adicionaria uma
// chamada HTTP extra sem necessidade.
let cachedCheckpointName: string | null = null;
async function getCheckpointName(): Promise<string> {
  cachedCheckpointName ??= await resolveCheckpointName(config.COMFYUI_URL, config.COMFYUI_CHECKPOINT_HINT);
  return cachedCheckpointName;
}

async function reportProgress(jobId: string, progress: number, status: string): Promise<void> {
  await db.update(schema.studioJobs).set({ progress, status }).where(eq(schema.studioJobs.jobId, jobId));
  await publishWsEvent({ type: 'studio.job.progress', payload: { job_id: jobId, progress, status } });
}

/**
 * Estrutura canônica do carrossel (10 cards): capa, premissa, itens, follow
 * no 5, golpe no 7, tese no penúltimo, CTA no último. Contagens menores
 * degradam mantendo capa/premissa/tese/cta fixos nas pontas.
 */
function layoutForSlide(index: number, total: number): CardLayout {
  if (index === 0) return 'capa';
  if (index === 1) return 'premissa';
  if (index === total - 1) return 'cta';
  if (index === total - 2) return 'tese';
  if (index === 4 && total >= 8) return 'follow';
  if (index === 6 && total >= 9) return 'golpe';
  return 'item';
}

/**
 * Upload pro Storage + registro em studioAssets: o mesmo pra qualquer caminho
 * de geração (ComfyUI ou carrossel HTML), então fica extraído pra os dois
 * compartilharem. Só o bloco `metadata` varia por caminho.
 */
async function persistSlideAsset(params: {
  jobId: string;
  clientId: string;
  requestedBy: string | null;
  projectId: string | null;
  type: string;
  prompt: string | null;
  model: string;
  filename: string;
  content: Buffer;
  metadata: Record<string, unknown>;
}): Promise<{ storageUrl: string; assetId: string }> {
  const path = `${params.clientId}/${params.filename}`;
  const storageUrl = await uploadAsset(config, path, params.content, 'image/png');

  const [asset] = await db
    .insert(schema.studioAssets)
    .values({
      clientId: params.clientId,
      // Sem isso a galeria não sabe QUEM criou cada peça (requisito da spec
      // da Galeria). A coluna já existia no schema e nunca era preenchida.
      userId: params.requestedBy,
      projectId: params.projectId,
      type: params.type,
      filename: params.filename,
      storageUrl,
      agent: 'studio',
      prompt: params.prompt,
      model: params.model,
      metadata: params.metadata,
    })
    .returning();

  if (!asset) throw new Error(`Failed to persist studio asset (${params.filename})`);
  return { storageUrl, assetId: asset.id };
}

/**
 * Notifica quem pediu o job (seção "Studio continua gerando com o usuário
 * fora", 2026-09-02): jobs reais de GPU levam minutos, e o usuário não fica
 * esperando com a aba aberta. Reaproveita a tabela `notifications` que já
 * existe (apps/api/src/notifications/routes.ts), não cria mecanismo novo.
 * requestedBy pode ser null pra jobs antigos (antes desta coluna existir) --
 * nesse caso não tem pra quem notificar, e isso é esperado, não um erro.
 */
/**
 * Traduz a exceção pra algo que o colaborador entenda na tela. "fetch failed"
 * (o que o Node cospe quando não alcança o ComfyUI) não diz nada pra quem só
 * queria uma imagem — e foi exatamente esse caso que gerou o relato "o job
 * começou e depois simplesmente sumiu".
 */
function describeFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(raw)) {
    return `Não consegui falar com o ComfyUI em ${config.COMFYUI_URL}. A máquina de geração está fora do ar ou fora da rede deste worker (${config.NODE_ID}).`;
  }
  return raw.slice(0, 500);
}

async function notifyRequester(
  requestedBy: string | null,
  notification: { type: string; title: string; body: string; link?: string | null },
): Promise<void> {
  if (!requestedBy) return;
  try {
    await db.insert(schema.notifications).values({ userId: requestedBy, ...notification });
  } catch (error) {
    logger.error({ error, requestedBy }, 'Falha ao gravar notificação do job do Studio');
  }
}

async function processStudioJob(job: Job<StudioJobData>): Promise<void> {
  const {
    studioJobDbId,
    jobId,
    clientId,
    requestedBy,
    projectId,
    type,
    prompt,
    resolution,
    attachments,
    numSlides,
    includeText,
    copySlides,
    qualityPreset,
  } = job.data;
  logger.info({ jobId, type, attachments: attachments?.length ?? 0 }, 'Processing studio job');

  await reportProgress(jobId, 10, 'rendering');

  // clientId hoje só chega aqui validado como UUID (zod .uuid() em
  // POST /studio/jobs), então não deveria conter "/" nunca; a checagem
  // abaixo é só defesa em profundidade caso um futuro produtor dessa fila
  // não valide direito antes de enfileirar.
  if (clientId.includes('/') || clientId.includes('..')) {
    throw new Error(`Invalid clientId for storage path: '${clientId}'`);
  }

  // Só image/carousel têm geração real ligada (Flux via ComfyUI). Vídeo/reels/
  // upscale ainda não têm workflow real conectado (Wan2.2/Depthflow/upscaler
  // existem no ComfyUI, mas cada um precisa de um grafo próprio que ninguém
  // testou contra a máquina real ainda) — falha explícita em vez de devolver
  // um SVG fingindo sucesso, que era o bug relatado ("não gera nada").
  if (type !== 'image' && type !== 'carousel') {
    throw new Error(
      `Geração real de ${type} ainda não está disponível nesta versão do Studio. Em desenvolvimento — sem workflow ComfyUI conectado para esse tipo ainda.`,
    );
  }

  const slidesCount = type === 'carousel' ? Math.max(1, numSlides ?? 1) : 1;

  const generated: { storageUrl: string; filename: string }[] = [];
  let firstAssetId: string | null = null;
  let model: string;

  // Caminho novo do carrossel: cards em HTML/CSS (pele canônica) renderizados
  // via Chrome headless, em vez de ComfyUI+sharp/SVG. Liga quando o job traz
  // frames de referência ou quando o produtor pede explicitamente
  // metadata.design='html'. Jobs genéricos sem frames seguem no caminho antigo.
  const referenceImages = job.data.referenceImages ?? [];
  const jobMeta = job.data.metadata ?? {};
  const useHtmlCarousel = type === 'carousel' && (referenceImages.length > 0 || jobMeta.design === 'html');

  if (useHtmlCarousel) {
    model = 'html-carousel (puppeteer-core)';
    await reportProgress(jobId, 20, 'rendering');

    const meta: CarouselMeta = {
      seriesName: typeof jobMeta.seriesName === 'string' ? jobMeta.seriesName : undefined,
      footerText: typeof jobMeta.footerText === 'string' ? jobMeta.footerText : undefined,
    };
    const cards: CardData[] = Array.from({ length: slidesCount }, (_, slideIndex) => {
      const slideCopy = copySlides?.[slideIndex];
      return {
        layout: layoutForSlide(slideIndex, slidesCount),
        headline: slideCopy?.headline ?? prompt ?? '',
        subtext: slideCopy?.subtext,
        frame: referenceImages[slideIndex] ?? null,
        page: slideIndex + 1,
        totalPages: slidesCount,
      };
    });

    const contents = await renderCarouselCards(cards, meta);

    for (let slideIndex = 0; slideIndex < contents.length; slideIndex++) {
      const content = contents[slideIndex];
      if (!content) throw new Error(`Renderer não devolveu o card ${slideIndex + 1}/${slidesCount}`);
      const filename = slidesCount > 1 ? `${jobId}-${slideIndex + 1}.png` : `${jobId}.png`;
      const { storageUrl, assetId } = await persistSlideAsset({
        jobId,
        clientId,
        requestedBy,
        projectId,
        type,
        prompt,
        model,
        filename,
        content,
        metadata: {
          resolution: '1080x1350',
          stub: false,
          design: 'html',
          frame: referenceImages[slideIndex] ?? null,
          node_id: config.NODE_ID,
          job_id: jobId,
          slide_index: slideIndex,
          slides_total: slidesCount,
          headline: copySlides?.[slideIndex]?.headline ?? null,
        },
      });
      generated.push({ storageUrl, filename });
      firstAssetId ??= assetId;
      await reportProgress(jobId, 30 + Math.round(((slideIndex + 1) / slidesCount) * 60), 'rendering');
    }
  } else {
    const parsed = parseResolution(resolution ?? '1344x896');
    // Alinha na grade do Flux antes de gerar: ver snapToFluxGrid() pro
    // porquê e pra comparação medida de qualidade.
    const width = snapToFluxGrid(parsed.width);
    const height = snapToFluxGrid(parsed.height);
    const checkpointName = await getCheckpointName();
    await reportProgress(jobId, 20, 'rendering');

    // PDF não entra como referência visual (o ComfyUI não rasteriza PDF); só
    // imagem. Se a pessoa anexou só PDF, gera por texto e o anexo continua
    // registrado no asset — nunca finge que usou.
    const referenceImage = (attachments ?? []).find((a) => a.contentType.startsWith('image/'));
    model = referenceImage ? `${checkpointName} (img2img)` : checkpointName;
    const steps = stepsForQuality(qualityPreset);

    for (let slideIndex = 0; slideIndex < slidesCount; slideIndex++) {
      const slideCopy: SlideText | undefined = copySlides?.[slideIndex];

      // Cada slide do carrossel varia a cena com o headline da copy, senão
      // vira a mesma imagem repetida N vezes.
      const slideHint = slideCopy
        ? ` — cena para o slide ${slideIndex + 1}: ${slideCopy.headline}${slideCopy.subtext ? `, ${slideCopy.subtext}` : ''}`
        : '';
      // Prompt curto vira imagem chapada; ver prompt-quality.ts pra comparação medida.
      const enrichedPrompt = enrichImagePrompt((prompt ?? '') + slideHint);

      let content = await generateImageViaComfyUI(
        { baseUrl: config.COMFYUI_URL, checkpointName },
        {
          prompt: enrichedPrompt.prompt,
          width,
          height,
          referenceImage: referenceImage ? { url: referenceImage.url, filename: referenceImage.filename } : undefined,
          steps,
        },
      );

      // Texto de verdade via compositing (não confiar no modelo de imagem pra
      // "desenhar" texto — isso é notoriamente ruim mesmo nos modelos mais
      // avançados). Só roda se a copy trouxe texto pra esse slide.
      if (includeText && slideCopy) {
        content = await compositeSlideText(content, slideCopy);
      }

      const filename = slidesCount > 1 ? `${jobId}-${slideIndex + 1}.png` : `${jobId}.png`;
      const { storageUrl, assetId } = await persistSlideAsset({
        jobId,
        clientId,
        requestedBy,
        projectId,
        type,
        prompt,
        model,
        filename,
        content,
        metadata: {
          resolution: resolution ?? null,
          stub: false,
          // Referências que guiaram a criação ficam registradas junto do
          // resultado: sem isso não dá pra saber depois de que material
          // aquela peça saiu.
          references: (attachments ?? []).map((a) => ({ filename: a.filename, url: a.url })),
          // Guarda o prompt REALMENTE enviado ao modelo, não só o que a pessoa
          // digitou: sem isso não dá pra reproduzir nem depurar um resultado.
          final_prompt: enrichedPrompt.prompt,
          prompt_enriched: enrichedPrompt.enriched,
          node_id: config.NODE_ID,
          job_id: jobId,
          slide_index: slideIndex,
          slides_total: slidesCount,
          headline: slideCopy?.headline ?? null,
          quality_preset: qualityPreset ?? 'standard',
          steps,
        },
      });
      generated.push({ storageUrl, filename });
      firstAssetId ??= assetId;
      await reportProgress(jobId, 30 + Math.round(((slideIndex + 1) / slidesCount) * 60), 'rendering');
    }
  }

  const primaryUrl = generated[0]!.storageUrl;

  await db
    .update(schema.studioJobs)
    .set({ status: 'completed', progress: 100, assetId: firstAssetId })
    .where(eq(schema.studioJobs.jobId, jobId));

  await publishWsEvent({
    type: 'studio.job.progress',
    payload: { job_id: jobId, progress: 100, status: 'completed', asset_url: primaryUrl },
  });

  await notifyRequester(requestedBy, {
    type: 'studio.job.completed',
    title: 'Seu conteúdo no Studio ficou pronto',
    body: prompt
      ? `"${prompt.slice(0, 140)}"${slidesCount > 1 ? ` (${slidesCount} slides)` : ''} já está na galeria.`
      : 'Já está na galeria.',
    // Clicar na notificação abre a Galeria já destacando a peça gerada.
    link: firstAssetId ? `/studio?asset=${firstAssetId}` : '/studio',
  });

  await db.insert(schema.auditLogs).values({
    action: 'studio.job.completed',
    agent: 'studio',
    result: 'completed',
    metadata: { job_id: jobId, execution_db_id: studioJobDbId, asset_url: primaryUrl, assets_generated: generated.length },
  });

  // Auto-aprendizado: o que foi CONCLUÍDO vira memória durável, pra o
  // agente saber depois o que a casa já produziu pra este cliente.
  await recordLearning({
    kind: 'studio.asset_created',
    agent: 'studio',
    clientId,
    userId: requestedBy,
    content: `Studio gerou ${generated.length} asset(s) do tipo "${type}" para o cliente. Prompt: "${(prompt ?? '').slice(0, 300)}".`,
    metadata: { job_id: jobId, asset_url: primaryUrl, model, node_id: config.NODE_ID },
  });

  logger.info({ jobId, assets: generated.length }, 'Studio job completed');
}

const worker = new Worker<StudioJobData>(
  STUDIO_JOBS_QUEUE_NAME,
  async (job) => {
    try {
      await processStudioJob(job);
    } catch (error) {
      const reason = describeFailure(error);
      await db
        .update(schema.studioJobs)
        .set({ status: 'failed', error: reason })
        .where(eq(schema.studioJobs.jobId, job.data.jobId));
      await publishWsEvent({
        type: 'studio.job.progress',
        payload: { job_id: job.data.jobId, progress: job.progress ?? 0, status: 'failed' },
      });
      await notifyRequester(job.data.requestedBy, {
        type: 'studio.job.failed',
        title: 'Seu job no Studio falhou',
        body: reason,
        link: '/studio',
      });
      throw error;
    }
  },
  {
    // Conexão PRÓPRIA do worker (duplicate), não a compartilhada com a
    // Queue: o worker faz operações bloqueantes (BRPOPLPUSH) e dividir o
    // socket com quem publica atrasa a renovação do lock.
    connection: getRedisConnection().duplicate(),
    concurrency: 2,
    // Job de GPU leva MINUTOS. O lock padrão do BullMQ é de 30s: passando
    // disso ele considera o job travado, re-entrega pra outro worker e o
    // original perde o lock — falha real observada, com o mesmo job pego
    // duas vezes (06:45 e 07:11) e "Missing lock for job 16. moveToFinished".
    // 15min casa com AGENT_TIMEOUT_MS.studio no orchestrator.
    lockDuration: 15 * 60 * 1000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  },
);

worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Job completed'));
worker.on('failed', (job, error) => logger.error({ jobId: job?.id, error: error.message }, 'Job failed'));

logger.info({ nodeId: config.NODE_ID }, 'Studio Node worker listening');

process.on('SIGINT', () => void worker.close().then(() => process.exit(0)));
process.on('SIGTERM', () => void worker.close().then(() => process.exit(0)));
