import { and, eq } from 'drizzle-orm';
import { Worker, type Job } from 'bullmq';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { STUDIO_JOBS_QUEUE_NAME, getRedisConnection, publishWsEvent, recordLearning, type StudioJobData } from '@desigual-os/orchestrator';
import { loadConfig } from './config';
import {
  generateImageViaComfyUI,
  resolveFluxModelNames,
  qualityProfileFromPreset,
  ComfyUIPromptLostError,
  type ComfyUIConfig,
  type FluxModelNames,
  type GenerateImageResult,
} from './comfyui-client';
import type { TransformationStrength } from './quality-profiles';
import { computeGenerationFingerprint } from './idempotency';
import { validateComfyUIInstallation } from './comfyui-validate';
import { generateVideoSequence } from './video-sequence';
import { plannedCarouselPrompt, shouldRenderHtmlCarousel } from './take-plan';
import { upscaleImageViaComfyUI } from './upscale';
import { parseResolution, snapToFluxGrid } from './generate';
import { compileFlux2Prompt, brandKitPromptDirective, stylePromptModifier } from './prompt-quality';
import { compositeSlideText, type SlideText } from './text-overlay';
import { compositeExactLogo } from './brand-compositor';
import { deriveCreativeSpec } from './creative-spec';
import { resolveReferencePlan } from './reference-plan';
import { runQualityLoop, QaLoopCancelledError, type QaAttemptOutput } from './qa-loop';
import { renderCarouselCards, type CardData, type CardLayout, type CarouselMeta } from './html-carousel/renderer';
import { uploadAsset } from './storage';
import { startMetricsServer } from './metrics-server';

const logger = createLogger({ service: 'studio-node' });
const config = loadConfig();

// Resolvido uma vez e cacheado: nome de arquivo de modelo não muda no meio
// da execução do processo, e resolver de novo a cada job só adicionaria uma
// chamada HTTP extra sem necessidade.
let cachedFluxModelNames: FluxModelNames | null = null;
async function getFluxModelNames(): Promise<FluxModelNames> {
  cachedFluxModelNames ??= await resolveFluxModelNames(config.COMFYUI_URL, {
    unetHint: config.COMFYUI_UNET_HINT,
    clipHint: config.COMFYUI_CLIP_HINT,
    vaeHint: config.COMFYUI_VAE_HINT,
  });
  return cachedFluxModelNames;
}

async function reportProgress(jobId: string, progress: number, status: string): Promise<void> {
  await db.update(schema.studioJobs).set({ progress, status }).where(eq(schema.studioJobs.jobId, jobId));
  await publishWsEvent({ type: 'studio.job.progress', payload: { job_id: jobId, progress, status } });
}

interface ComfyProgressEntry {
  promptId: string;
  seed: number;
  workflowId: GenerateImageResult['generation']['workflowId'];
}

/**
 * Chama generateImageViaComfyUI com resume automático: se uma tentativa
 * ANTERIOR deste mesmo job/slide já submeteu um prompt pro ComfyUI (achado
 * real 09/09/2026 - o worker pode morrer entre o /prompt responder e o
 * upload pro Supabase terminar, e a imagem já gerada na GPU ficava órfã),
 * retoma esse prompt_id em vez de gerar tudo de novo. `key` identifica a
 * posição dentro do job (ex: 'hero', 'v0-s2') e vira parte do
 * filename_prefix do SaveImage no ComfyUI, pra rastrear o output até aqui
 * mesmo depois de um restart que apagou o /history dele.
 *
 * `jobMetaRef` é um objeto mutável (não um valor) de propósito: cada chamada
 * de onSubmitted precisa enxergar o `comfy_progress` já salvo por uma
 * chamada IRMÃ anterior no mesmo job (ex: slide 1 já salvou progresso quando
 * o slide 2 está prestes a submeter), senão a segunda escrita no banco
 * apagaria a primeira.
 */
async function generateWithResume(
  comfyConfig: ComfyUIConfig,
  jobId: string,
  key: string,
  jobMetaRef: { current: Record<string, unknown> },
  genParams: Omit<Parameters<typeof generateImageViaComfyUI>[1], 'filenamePrefix' | 'resume' | 'onSubmitted' | 'seed'> & {
    seed?: number | undefined;
  },
): Promise<GenerateImageResult> {
  const filenamePrefix = `desigual-os-studio-${jobId}-${key}`;
  const comfyProgress = jobMetaRef.current.comfy_progress as Record<string, ComfyProgressEntry> | undefined;
  const saved = comfyProgress?.[key];

  const onSubmitted = async (info: ComfyProgressEntry) => {
    const nextProgress = { ...comfyProgress, [key]: info };
    const nextMeta = { ...jobMetaRef.current, comfy_progress: nextProgress };
    await db.update(schema.studioJobs).set({ metadata: nextMeta }).where(eq(schema.studioJobs.jobId, jobId));
    jobMetaRef.current = nextMeta;
  };

  try {
    return await generateImageViaComfyUI(comfyConfig, {
      ...genParams,
      filenamePrefix,
      ...(saved ? { seed: saved.seed, resume: { promptId: saved.promptId } } : {}),
      onSubmitted,
    });
  } catch (error) {
    if (error instanceof ComfyUIPromptLostError) {
      logger.warn(
        { jobId, key, promptId: error.promptId },
        'ComfyUI perdeu o prompt salvo (provável restart do servidor) - submetendo de novo',
      );
      return await generateImageViaComfyUI(comfyConfig, { ...genParams, filenamePrefix, onSubmitted });
    }
    throw error;
  }
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
  /** video/reels geram mp4; os demais caminhos, png. */
  contentType: string;
  metadata: Record<string, unknown>;
}): Promise<{ storageUrl: string; assetId: string }> {
  const path = `${params.clientId}/${params.filename}`;
  const storageUrl = await uploadAsset(config, path, params.content, params.contentType);

  // A retry after storage/DB success but before checkpoint must not duplicate the gallery.
  const [existing] = await db.select({ id: schema.studioAssets.id }).from(schema.studioAssets)
    .where(and(eq(schema.studioAssets.clientId, params.clientId), eq(schema.studioAssets.filename, params.filename))).limit(1);
  if (existing) return { storageUrl, assetId: existing.id };

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
 * queria uma imagem - e foi exatamente esse caso que gerou o relato "o job
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
    style,
    variations,
  } = job.data;
  logger.info({ jobId, type, style: style ?? 'padrao', variations: variations ?? 1, attachments: attachments?.length ?? 0 }, 'Processing studio job');

  // Seção 25 do plano de evolução: infrastructure retry (BullMQ reenfileira
  // o MESMO jobId depois de um crash/restart do worker) não pode gerar de
  // novo um job que já terminou - GPU real já foi gasta e cobrada uma vez.
  // Isto é diferente de "Criar variação" (que sempre é um jobId NOVO com
  // seed nova, nunca cai aqui). Só olha o PRÓPRIO studio_jobs, não tenta
  // achar duplicata semântica entre jobs diferentes (isso exigiria consulta
  // por fingerprint na criação do job, na API - não implementado ainda,
  // ver relatório final).
  const [existingJob] = await db.select().from(schema.studioJobs).where(eq(schema.studioJobs.jobId, jobId)).limit(1);

  // Achado real (16/09/2026): DELETE /studio/jobs/:id apagava a linha do
  // banco mas NÃO removia o job da fila do BullMQ. O worker então pegava um
  // job órfão, não achava linha nenhuma, e gerava assim mesmo - queimando
  // GPU de verdade por uma peça que ninguém mais ia ver, e inserindo
  // studio_assets apontando pra um job inexistente. Sem linha, não gera.
  if (!existingJob) {
    logger.warn({ jobId }, 'Job não existe mais no banco (apagado enquanto estava na fila) - descartando sem gerar');
    return;
  }

  // Cancelamento pedido enquanto o job esperava na fila: o caminho barato.
  // Nem chega a falar com o ComfyUI.
  if (existingJob.status === 'cancelled') {
    logger.info({ jobId }, 'Job cancelado antes de começar - descartando sem gerar');
    await publishWsEvent({ type: 'studio.job.progress', payload: { job_id: jobId, progress: 0, status: 'cancelled' } });
    return;
  }

  if (existingJob?.status === 'completed' && existingJob.assetId) {
    logger.warn({ jobId }, 'Job já estava completed (infrastructure retry) - pulando geração, não cobra GPU de novo');
    await publishWsEvent({
      type: 'studio.job.progress',
      payload: { job_id: jobId, progress: 100, status: 'completed' },
    });
    return;
  }

  // Ref mutável: cada resume/onSubmitted lê e escreve aqui, não faz uma
  // query nova a cada slide (ver generateWithResume acima).
  const jobMetaRef: { current: Record<string, unknown> } = { current: existingJob?.metadata ?? {} };

  await reportProgress(jobId, 10, 'rendering');

  // clientId hoje só chega aqui validado como UUID (zod .uuid() em
  // POST /studio/jobs), então não deveria conter "/" nunca; a checagem
  // abaixo é só defesa em profundidade caso um futuro produtor dessa fila
  // não valide direito antes de enfileirar.
  if (clientId.includes('/') || clientId.includes('..')) {
    throw new Error(`Invalid clientId for storage path: '${clientId}'`);
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
  const useHtmlCarousel = type === 'carousel' && shouldRenderHtmlCarousel(jobMeta, referenceImages.length > 0);

  const creativeSpec = deriveCreativeSpec({
    type,
    prompt,
    style,
    qualityPreset,
    referenceImages: [
      ...referenceImages,
      ...(attachments ?? []).filter((asset) => asset.contentType.startsWith('image/')).map((asset) => asset.url),
    ],
    metadata: jobMeta,
  });
  const referencePlan = resolveReferencePlan({
    attachments,
    galleryReferenceUrls: referenceImages,
    spec: creativeSpec,
    prompt,
  });

  // PDF não entra como referência visual (o ComfyUI não rasteriza PDF); só
  // imagem. Se a pessoa anexou só PDF, gera por texto e o anexo continua
  // registrado no asset - nunca finge que usou.
  const referenceImage = referencePlan.modelReferences[0] ?? (attachments ?? []).find((a) => a.contentType.startsWith('image/'));

  // Diretrizes de estilo (escolha da tela) e de marca (snapshot do brand kit
  // que a API gravou em metadata.brand_kit) entram DEPOIS do enriquecimento:
  // aplicadas antes, tokens do estilo ("cinematic", "3d") desligariam o
  // sufixo de qualidade do enrichImagePrompt pelo check ALREADY_DIRECTED.
  const promptDirectives = [stylePromptModifier(style), brandKitPromptDirective(jobMeta.brand_kit)].filter(Boolean).join(', ');
  const withDirectives = (enrichedPrompt: string): string =>
    promptDirectives ? `${enrichedPrompt}, ${promptDirectives}` : enrichedPrompt;

  // Tempo de GPU medido aqui (não no ComfyUI): cobre todas as iterações de
  // variação/slide, então gpu_time_ms reflete o total gasto pelo job.
  const gpuStartedAt = Date.now();

  if (type === 'video' || type === 'reels') {
    const parsed = resolution ? parseResolution(resolution) : { width: 768, height: 1344 };
    const result = await generateVideoSequence({
      jobId, type, prompt: prompt ?? '', duration: job.data.durationSeconds,
      metadata: jobMeta, stateMetadata: jobMetaRef.current,
      ...parsed, baseUrl: config.COMFYUI_URL, spec: creativeSpec,
      references: referencePlan.modelReferences, withDirectives,
      ...(referencePlan.canvasLogo ? { logo: { sourceUrl: referencePlan.canvasLogo.url, placement: referencePlan.canvasLogo.placement } } : {}),
      generateFrame: async (key, finalPrompt, width, height, references) => {
        const fluxModel = await getFluxModelNames();
        const frame = await generateWithResume(
          { baseUrl: config.COMFYUI_URL, ...fluxModel }, jobId, key, jobMetaRef,
          { prompt: finalPrompt, width, height,
            qualityProfile: qualityProfileFromPreset(qualityPreset),
            referenceImages: references.map((ref) => ({ url: ref.url, filename: ref.filename })) },
        );
        return { bytes: frame.bytes, model: fluxModel.unetName };
      },
      persist: async (input) => persistSlideAsset({
        jobId, clientId, requestedBy, projectId, prompt, ...input,
        metadata: { ...input.metadata, node_id: config.NODE_ID },
      }),
      saveState: async (state) => {
        const next = { ...jobMetaRef.current, video_sequence: state };
        await db.update(schema.studioJobs).set({ metadata: next }).where(eq(schema.studioJobs.jobId, jobId));
        jobMetaRef.current = next;
      },
      progress: async (percent) => reportProgress(jobId, percent, 'rendering'),
    });
    model = 'FLUX.2 keyframes -> H3 takes -> editorial assembly';
    generated.push({ storageUrl: result.storageUrl, filename: result.filename });
    firstAssetId = result.assetId;
  } else if (type === 'upscale') {
    // Upscale é ampliação de uma imagem EXISTENTE: sem anexo não há caminho
    // real (gerar uma imagem nova e ampliar não é o que a pessoa pediu).
    if (!referenceImage) {
      throw new Error('Upscale precisa de uma imagem anexada: anexe a imagem (PNG, JPEG ou WEBP) que você quer ampliar e tente de novo.');
    }
    model = typeof jobMeta.upscale_model === 'string' && jobMeta.upscale_model.length > 0 ? jobMeta.upscale_model : 'RealESRGAN_x4.pth';
    await reportProgress(jobId, 30, 'rendering');

    const content = await upscaleImageViaComfyUI({
      baseUrl: config.COMFYUI_URL,
      image: { url: referenceImage.url, filename: referenceImage.filename },
      modelName: model,
    });

    const filename = `${jobId}.png`;
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
      contentType: 'image/png',
      metadata: {
        resolution: resolution ?? null,
        stub: false,
        upscale_model: model,
        source_image: referenceImage.filename,
        references: (attachments ?? []).map((a) => ({ filename: a.filename, url: a.url })),
        node_id: config.NODE_ID,
        job_id: jobId,
        slide_index: 0,
        slides_total: 1,
      },
    });
    generated.push({ storageUrl, filename });
    firstAssetId ??= assetId;
    await reportProgress(jobId, 90, 'rendering');
  } else if (type !== 'image' && type !== 'carousel') {
    // O enum STUDIO_JOB_TYPES hoje cobre exatamente os 5 tipos acima, mas
    // StudioJobData.type é string: defesa contra um produtor de fila novo
    // mandando algo que nenhum caminho implementa.
    throw new Error(`Tipo de job do Studio não suportado: '${type}'.`);
  } else if (useHtmlCarousel) {
    model = 'html-carousel (puppeteer-core)';
    await reportProgress(jobId, 20, 'rendering');

    const meta: CarouselMeta = {
      seriesName: typeof jobMeta.seriesName === 'string' ? jobMeta.seriesName : undefined,
      footerText: typeof jobMeta.footerText === 'string' ? jobMeta.footerText : undefined,
    };
    const cards: CardData[] = Array.from({ length: slidesCount }, (_, slideIndex) => {
      // Achado da certificação de pré-release (2026-09-10): este caminho
      // (carrossel HTML) sempre desenhava um headline, caindo pro prompt cru
      // quando não havia copy gerada - diferente do caminho Flux (linha 514
      // abaixo), que já respeitava includeText corretamente. Isso fazia
      // texto aparecer "queimado" na imagem mesmo com a geração de copy
      // desligada. Sem includeText, não tem headline nenhum.
      const slideCopy = includeText ? copySlides?.[slideIndex] : undefined;
      return {
        layout: layoutForSlide(slideIndex, slidesCount),
        headline: slideCopy?.headline ?? '',
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
        contentType: 'image/png',
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
    const fluxModel = await getFluxModelNames();
    await reportProgress(jobId, 20, 'rendering');

    model = referencePlan.modelReferences.length > 0
      ? `${fluxModel.unetName} (FLUX.2 native edit, ${referencePlan.modelReferences.length} refs)`
      : fluxModel.unetName;
    const qualityProfile = qualityProfileFromPreset(qualityPreset);
    // Mantido na metadata para compatibilidade/auditoria de jobs antigos.
    // O fluxo FLUX.2 atual usa ReferenceLatent e não um denoise de img2img.
    const transformationStrength: TransformationStrength =
      jobMeta.transformation_strength === 'low' || jobMeta.transformation_strength === 'medium' || jobMeta.transformation_strength === 'high'
        ? jobMeta.transformation_strength
        : 'medium';
    // Variações (só image): o mesmo prompt gerado N vezes. A seed é sorteada
    // a cada chamada dentro de generateImageViaComfyUI, então cada iteração
    // produz uma imagem diferente de verdade - não é a mesma seed repetida.
    const variationCount = type === 'image' ? Math.max(1, variations ?? 1) : 1;
    const totalIterations = slidesCount * variationCount;
    let iteration = 0;

    for (let variationIndex = 0; variationIndex < variationCount; variationIndex++) {
      for (let slideIndex = 0; slideIndex < slidesCount; slideIndex++) {
        const slideCopy: SlideText | undefined = copySlides?.[slideIndex];
        const photographic = type === 'carousel' && (jobMeta.design === 'photographic' || jobMeta.design === 'takes');
        const slideReferences = [...referencePlan.modelReferences];
        const anchor = generated[0];
        if (photographic && anchor && slideReferences.length < 10) {
          slideReferences.push({ url: anchor.storageUrl, filename: anchor.filename, contentType: 'image/png',
            role: 'subject', fidelity: 'high', placement: 'reference_only',
            instruction: 'Preserve the identity, wardrobe, product and color treatment of this sequence anchor. Follow the new take framing and action.' });
        }

        // Cada slide do carrossel varia a cena com o headline da copy, senão
        // vira a mesma imagem repetida N vezes.
        const slideHint = slideCopy
          ? ` - cena para o slide ${slideIndex + 1}: ${slideCopy.headline}${slideCopy.subtext ? `, ${slideCopy.subtext}` : ''}`
          : '';
        // Prompt curto vira imagem chapada; ver prompt-quality.ts pra comparação medida.
        const enrichedPrompt = compileFlux2Prompt({
          prompt: (type === 'carousel' ? plannedCarouselPrompt(jobMeta, slideIndex) : undefined) ?? ((prompt ?? '') + slideHint),
          spec: creativeSpec,
          references: slideReferences,
        });
        const finalPrompt = withDirectives(enrichedPrompt.prompt);

        const runGeneration = (attempt: number, correctionDirective: string) =>
          generateWithResume(
            { baseUrl: config.COMFYUI_URL, ...fluxModel },
            jobId,
            // A chave do resume inclui a tentativa: sem isso a tentativa 2
            // retomaria o prompt_id da tentativa 1 e devolveria exatamente a
            // imagem que o crítico acabou de reprovar.
            attempt > 1 ? `v${variationIndex}-s${slideIndex}-a${attempt}` : `v${variationIndex}-s${slideIndex}`,
            jobMetaRef,
            {
              prompt: correctionDirective ? `${finalPrompt} ${correctionDirective}` : finalPrompt,
              width,
              height,
              referenceImages: slideReferences.map((asset) => ({ url: asset.url, filename: asset.filename })),
              qualityProfile,
            },
          );

        // Pipeline autônomo (STUDIO_AUTONOMOUS_QA). Só o caminho de IMAGEM
        // por enquanto: carrossel tem semântica de sequência (o slide N usa
        // o N-1 como âncora) e refazer um slide do meio invalidaria a
        // continuidade - entra depois, com âncora versionada.
        const autonomous = config.STUDIO_AUTONOMOUS_QA && type === 'image';
        let result: GenerateImageResult;
        let qaReport: Record<string, unknown> | null = null;

        if (autonomous) {
          const loop = await runQualityLoop<GenerateImageResult & QaAttemptOutput>({
            // Briefing ORIGINAL, não o prompt compilado: é contra a intenção
            // da pessoa que se mede aderência, não contra o texto que o
            // PromptCompiler produziu a partir dela.
            briefing: prompt ?? '',
            profile: qualityProfile,
            maxAttempts: config.STUDIO_QA_MAX_ATTEMPTS,
            identityCritical: referencePlan.all.some((asset) => asset.role === 'subject' && asset.fidelity !== 'interpretive'),
            productCritical: referencePlan.all.some((asset) => asset.role === 'product'),
            criticConfig: {
              provider: config.STUDIO_CRITIC_PROVIDER,
              ollamaUrl: config.CRITIC_OLLAMA_URL,
              ollamaModel: config.CRITIC_OLLAMA_MODEL,
              timeoutMs: config.CRITIC_TIMEOUT_MS,
            },
            generate: async (attempt, directive) => {
              const generated = await runGeneration(attempt, directive);
              return { ...generated, generation: { ...generated.generation } } as GenerateImageResult & QaAttemptOutput;
            },
            onStage: async (stage, attempt) => {
              const status = stage === 'evaluating' ? 'quality_check' : stage === 'refining' ? 'refining' : 'rendering';
              logger.info({ jobId, stage, attempt }, 'Studio QA stage');
              await reportProgress(jobId, 30 + Math.round((iteration / totalIterations) * 60), status);
            },
            isCancelled: async () => {
              const [row] = await db.select({ status: schema.studioJobs.status }).from(schema.studioJobs).where(eq(schema.studioJobs.jobId, jobId)).limit(1);
              return row?.status === 'cancelled';
            },
          });

          result = loop.chosen.payload;
          qaReport = {
            enabled: true,
            attempts_run: loop.attempts.length,
            chosen_attempt: loop.chosen.attempt,
            final_action: loop.finalDecision.action,
            final_reason: loop.finalDecision.reason,
            thresholds: loop.finalDecision.thresholds,
            critic_provider: loop.chosen.critic.provider,
            critic_model: loop.chosen.critic.model,
            ...(loop.criticUnavailableReason ? { critic_unavailable: loop.criticUnavailableReason } : {}),
            // Lineage (seção 14): todas as tentativas, não só a escolhida.
            lineage: loop.attempts.map((candidate) => ({
              attempt: candidate.attempt,
              seed: candidate.payload.generation.seed,
              overall_score: candidate.critic.overall_score,
              artifact_score: candidate.critic.artifact_score,
              hands: candidate.critic.hands,
              face: candidate.critic.face,
              composition: candidate.critic.composition,
              prompt_alignment: candidate.critic.prompt_alignment,
              confidence: candidate.critic.confidence,
              latency_ms: candidate.critic.latencyMs,
              problems: candidate.critic.problems,
            })),
          };
          logger.info(
            { jobId, attempts: loop.attempts.length, chosen: loop.chosen.attempt, score: loop.chosen.critic.overall_score, action: loop.finalDecision.action },
            'Studio QA loop finished',
          );
        } else {
          result = await runGeneration(1, '');
        }

        let content = result.bytes;

        // Texto de verdade via compositing (não confiar no modelo de imagem pra
        // "desenhar" texto - isso é notoriamente ruim mesmo nos modelos mais
        // avançados). Só roda se a copy trouxe texto pra esse slide.
        if (includeText && slideCopy && !photographic) {
          content = await compositeSlideText(content, slideCopy);
        }

        const exactLogo = creativeSpec.brandComposition?.logo?.sourceUrl
          ? {
              sourceUrl: creativeSpec.brandComposition.logo.sourceUrl,
              placement: creativeSpec.brandComposition.logo.placement ?? 'canvas_bottom_right' as const,
              ...(creativeSpec.brandComposition.logo.widthRatio !== undefined
                ? { widthRatio: creativeSpec.brandComposition.logo.widthRatio }
                : {}),
              ...(creativeSpec.brandComposition.logo.marginRatio !== undefined
                ? { marginRatio: creativeSpec.brandComposition.logo.marginRatio }
                : {}),
            }
          : referencePlan.canvasLogo
            ? {
                sourceUrl: referencePlan.canvasLogo.url,
                placement: referencePlan.canvasLogo.placement,
              }
            : null;
        if (exactLogo) content = await compositeExactLogo(content, exactLogo);

        iteration += 1;
        const filename = totalIterations > 1 ? `${jobId}-${iteration}.png` : `${jobId}.png`;
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
          contentType: 'image/png',
          metadata: {
            resolution: resolution ?? null,
            stub: false,
            // Referências que guiaram a criação ficam registradas junto do
            // resultado: sem isso não dá pra saber depois de que material
            // aquela peça saiu.
            references: (attachments ?? []).map((a) => ({ filename: a.filename, url: a.url })),
            reference_plan: referencePlan.all.map((asset) => ({
              filename: asset.filename,
              url: asset.url,
              role: asset.role,
              fidelity: asset.fidelity,
              placement: asset.placement,
            })),
            exact_logo_composited: Boolean(exactLogo),
            // Guarda o prompt REALMENTE enviado ao modelo, não só o que a pessoa
            // digitou: sem isso não dá pra reproduzir nem depurar um resultado.
            final_prompt: finalPrompt,
            prompt_enriched: enrichedPrompt.enriched,
            node_id: config.NODE_ID,
            job_id: jobId,
            slide_index: slideIndex,
            slides_total: slidesCount,
            headline: slideCopy?.headline ?? null,
            quality_preset: qualityPreset ?? 'standard',
            quality_profile: qualityProfile,
            style: style ?? 'padrao',
            // Seções 24/25/35 do plano de evolução: seed + workflow + parâmetros
            // efetivos gravados por asset - sem isso não dá pra "regenerar
            // exatamente" nem calcular fingerprint de idempotência depois.
            seed: result.generation.seed,
            workflow_id: result.generation.workflowId,
            workflow_version: result.generation.workflowVersion,
            steps: result.generation.steps,
            refine_steps: result.generation.refineSteps,
            denoise: result.generation.denoise,
            transformation_strength: referencePlan.modelReferences.length > 0 ? transformationStrength : null,
            reference_count: result.generation.referenceCount,
            generation_resolution: result.generation.resolution,
            refine_resolution: result.generation.refineResolution,
            // Laudo do pipeline autônomo: null quando a flag está off, pra
            // que dê pra separar em consulta o que passou pelo loop do que
            // não passou (a comparação A/B depende disso).
            qa: qaReport,
            generation_fingerprint: computeGenerationFingerprint({
              clientId,
              workflowId: result.generation.workflowId,
              workflowVersion: result.generation.workflowVersion,
              modelVersion: fluxModel.unetName,
              seed: result.generation.seed,
              qualityProfile: qualityProfile,
              referenceAssetIds: referenceImages,
              generationParameters: { prompt: finalPrompt, denoise: result.generation.denoise, resolution: result.generation.resolution },
            }),
            ...(type === 'image' ? { variation_index: variationIndex, variations_total: variationCount } : {}),
          },
        });
        generated.push({ storageUrl, filename });
        firstAssetId ??= assetId;
        await reportProgress(jobId, 30 + Math.round((iteration / totalIterations) * 60), 'rendering');
      }
    }
  }

  const primaryUrl = generated[0]!.storageUrl;

  await db
    .update(schema.studioJobs)
    .set({ status: 'completed', progress: 100, assetId: firstAssetId, gpuTimeMs: Date.now() - gpuStartedAt })
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

  // Auto-aprendizado de identidade visual: cada geração CONCLUÍDA vira
  // memória durável e aditiva (sem `subject` - nunca aposenta a anterior,
  // só acumula) do que a casa já produziu pra este cliente: estilo, modelo
  // e a paleta/tom do brand kit realmente aplicados no momento da geração
  // (snapshot em jobMeta.brand_kit, não o kit atual - o job é reproduzível
  // mesmo se o kit mudar depois). Isto é o rastro bruto de identidade
  // visual; o veredito humano (aprovado/rejeitado) que refina esse rastro
  // em padrão é gravado à parte em otto.feedback (POST .../feedback).
  const brandKitSnapshot = jobMeta.brand_kit as
    | { colors?: string[]; fonts?: string[]; tone_of_voice?: string | null }
    | undefined;
  await recordLearning({
    kind: 'studio.asset_created',
    agent: 'studio',
    clientId,
    userId: requestedBy,
    content: `Studio gerou ${generated.length} asset(s) do tipo "${type}"${style ? ` (estilo: ${style})` : ''} para o cliente. Prompt: "${(prompt ?? '').slice(0, 300)}".`,
    metadata: {
      job_id: jobId,
      asset_url: primaryUrl,
      model,
      style: style ?? null,
      node_id: config.NODE_ID,
      ...(brandKitSnapshot
        ? {
            brand_kit_colors: brandKitSnapshot.colors ?? [],
            brand_kit_fonts: brandKitSnapshot.fonts ?? [],
            brand_kit_tone_of_voice: brandKitSnapshot.tone_of_voice ?? null,
          }
        : {}),
    },
  });

  logger.info({ jobId, assets: generated.length }, 'Studio job completed');
}

// Seção 27 do plano de evolução: valida ANTES de aceitar jobs, não no meio
// do primeiro job real. Só loga - não aborta a subida - porque hoje já
// sabemos que finish_master_v1 está bloqueado (UltimateSDUpscale não
// instalado) e isso é esperado, não motivo pra recusar o processo inteiro
// de subir e processar image/carousel/video normalmente.
try {
  const validation = await validateComfyUIInstallation(config.COMFYUI_URL);
  if (validation.ok) {
    logger.info({ comfyuiVersion: validation.comfyuiVersion }, 'ComfyUI installation validated OK');
  } else {
    logger.warn(
      { missingClassTypes: validation.missingClassTypes, missingModelFiles: validation.missingModelFiles, comfyuiVersion: validation.comfyuiVersion },
      'ComfyUI installation validation found gaps - some workflows will fail if used',
    );
  }
} catch (error) {
  logger.error({ error }, 'ComfyUI installation validation failed to run (network/endpoint issue) - continuing without it');
}

const worker = new Worker<StudioJobData>(
  STUDIO_JOBS_QUEUE_NAME,
  async (job) => {
    try {
      await processStudioJob(job);
    } catch (error) {
      // Cancelamento é desfecho pedido pelo usuário, não falha: marcar
      // 'failed' aqui mostraria "seu job falhou" pra quem clicou em
      // cancelar, e ainda mandaria notificação de erro.
      if (error instanceof QaLoopCancelledError) {
        await db.update(schema.studioJobs).set({ status: 'cancelled' }).where(eq(schema.studioJobs.jobId, job.data.jobId));
        await publishWsEvent({ type: 'studio.job.progress', payload: { job_id: job.data.jobId, progress: job.progress ?? 0, status: 'cancelled' } });
        logger.info({ jobId: job.data.jobId }, 'Job cancelado durante o loop de qualidade');
        return;
      }
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
    // Um job de cada vez: medido ao vivo em 2026-09-08 que concurrency:2
    // deixava 2 gerações Flux2 Dev competindo pela mesma GPU (24GB) e o
    // SamplerCustomAdvanced simplesmente travava (24min parado num prompt
    // só, sem erro nenhum, até eu interromper manualmente via API do
    // ComfyUI). Um RTX 4090 sozinho não sustenta 2 gerações Flux2 Dev
    // simultâneas sem VRAM suficiente pra ambas.
    concurrency: 1,
    // Job de GPU leva MINUTOS. O lock padrão do BullMQ é de 30s: passando
    // disso ele considera o job travado, re-entrega pra outro worker e o
    // original perde o lock - falha real observada, com o mesmo job pego
    // duas vezes (06:45 e 07:11) e "Missing lock for job 16. moveToFinished".
    // 25min (era 15min, ver AGENT_TIMEOUT_MS.studio no orchestrator - os
    // dois têm que casar): medido ao vivo em 08/09/2026 que só o passo H3
    // de vídeo leva 13-14min real, e isso vem DEPOIS do hero frame Flux -
    // 15min não sobrava margem nenhuma pro pipeline completo (hero + H3 +
    // upload/download).
    lockDuration: 25 * 60 * 1000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  },
);

worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Job completed'));
worker.on('failed', (job, error) => logger.error({ jobId: job?.id, error: error.message }, 'Job failed'));

// Servidor de métricas: é por ele que a sonda do Orchestrator lê CPU/disco/
// GPU/temperatura desta máquina (o worker BullMQ em si não expõe HTTP).
const metricsServer = startMetricsServer();

logger.info({ nodeId: config.NODE_ID }, 'Studio Node worker listening');

const shutdown = () =>
  void worker.close().then(() => {
    metricsServer.close();
    process.exit(0);
  });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
