import { randomUUID } from 'node:crypto';
import { resolutionForMegapixels, T2I_GUIDANCE, T2I_PROFILES, I2I_GUIDANCE, I2I_PROFILES, I2I_TARGET_MEGAPIXELS, type QualityProfile } from './quality-profiles';

/**
 * Preset "Qualidade" (draft|standard|high) da API mapeado pro profile de 3
 * níveis do Model/Workflow Registry. 'high' (nome de wire, preservado por
 * compatibilidade com studio_jobs.quality_preset já gravado em produção)
 * mapeia pra 'master' internamente - ver quality-profiles.ts pros números
 * reais de cada nível. Isso SUBSTITUI o antigo STEPS_BY_QUALITY de 2
 * níveis (que colapsava 'draft' em 'standard' por não ter suporte a 3
 * níveis) - ver git blame se precisar dos valores antigos.
 */
export function qualityProfileFromPreset(preset: string | null | undefined): QualityProfile {
  if (preset === 'draft') return 'draft';
  if (preset === 'high' || preset === 'master') return 'master';
  return 'standard';
}

/** @deprecated Use qualityProfileFromPreset + T2I_PROFILES/I2I_PROFILES. Mantido só pra não quebrar chamador que ainda não migrou. */
export function stepsForQuality(preset: string | null | undefined): number {
  const profile = qualityProfileFromPreset(preset);
  return T2I_PROFILES[profile].baseSteps;
}

/**
 * O caminho até o ComfyUI atravessa a rede (Tailscale, ou um túnel SSH em
 * desenvolvimento). Queda transitória acontece - medido de verdade: um
 * download de ~1,8MB do /view morreu com `read ECONNRESET` no meio e
 * derrubou o job inteiro, mesmo com a imagem já gerada na GPU.
 *
 * Perder minutos de GPU por um soluço de rede é inaceitável, então toda
 * chamada passa por aqui. Só reoperação de LEITURA/idempotente: o /prompt
 * (que enfileira de verdade) fica de fora, senão um retry viraria duas
 * gerações cobradas.
 */
export async function fetchWithRetry(url: string | URL, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
  }
  throw lastError;
}

export interface ComfyUIConfig {
  baseUrl: string;
  unetName: string;
  clipName: string;
  vaeName: string;
}

/**
 * T2I FLUX.2 nativo (base + refino hires-fix condicional por quality
 * profile). O passe base segue o template oficial
 * `image_flux2_text_to_image`: Flux2Scheduler, RandomNoise, BasicGuider e
 * SamplerCustomAdvanced. O refino editorial continua condicional e só é
 * usado no profile master. FLUX.2 Dev não tem
 * checkpoint único: modelo, text encoder e VAE são arquivos separados
 * (UNETLoader/CLIPLoader/VAELoader). `ConditioningZeroOut` só entra no
 * segundo passe, evitando um segundo encode do text encoder. clip type
 * 'flux2' é o valor exigido pelo encoder Mistral do FLUX.2.
 *
 * `device: 'cpu'` no CLIPLoader NÃO é o default do template oficial
 * Comfy-Org (que usa 'default'/GPU) - mantido mesmo depois de medir que
 * NÃO é o que resolve o problema de performance real desta GPU (ver
 * abaixo): ainda libera ~VRAM na fase de load/encode, sem custo (o
 * encoder na CPU não é o gargalo do KSampler), então não há razão pra
 * reverter.
 *
 * ACHADO REAL (08-09/09/2026): com a GPU limpa, o sampling em ~1 MP é
 * estável; o custo dominante é a carga fria dos pesos, não a quantidade
 * de pixels. Medições erráticas anteriores ocorreram enquanto outro job
 * disputava a GPU e estão registradas, como análise corrigida, em
 * docs/comfyui-workflows/README.md. O smoke test do fluxo nativo abaixo
 * concluiu em carga fria com 1232x816 e 20 steps; a rota ReferenceLatent
 * também foi aceita e chegou ao sampler, mas a validação visual final
 * depende de repetir o teste quando o processo remoto estiver estável.
 *
 * Refino: LatentUpscaleBy sobre o latente JÁ gerado (preserva composição),
 * segundo KSampler com denoise < 1 e guidance mais baixo (textura, não
 * composição - mesma lógica do arquivo original). `refine: null` (profile
 * draft) pula o segundo estágio inteiro.
 */
export function buildFluxTextToImageGraph(params: {
  unetName: string;
  clipName: string;
  vaeName: string;
  prompt: string;
  base: { width: number; height: number; steps: number };
  refine: { width: number; height: number; steps: number; denoise: number } | null;
  seed: number;
  filenamePrefix: string;
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: params.unetName, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: params.clipName, type: 'flux2', device: 'cpu' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: params.vaeName } },
    pos: { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: params.prompt } },
    guide_base: { class_type: 'FluxGuidance', inputs: { conditioning: ['pos', 0], guidance: T2I_GUIDANCE.base } },
    latent: { class_type: 'EmptyFlux2LatentImage', inputs: { width: params.base.width, height: params.base.height, batch_size: 1 } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: params.seed } },
    scheduler: { class_type: 'Flux2Scheduler', inputs: { steps: params.base.steps, width: params.base.width, height: params.base.height } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    guider: { class_type: 'BasicGuider', inputs: { model: ['unet', 0], conditioning: ['guide_base', 0] } },
    sample_base: {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['noise', 0],
        guider: ['guider', 0],
        sampler: ['sampler', 0],
        sigmas: ['scheduler', 0],
        latent_image: ['latent', 0],
      },
    },
  };

  let decodeSource: [string, number] = ['sample_base', 0];
  if (params.refine) {
    graph.neg = { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['pos', 0] } };
    const scaleBy = params.refine.width / params.base.width;
    graph.guide_refine = { class_type: 'FluxGuidance', inputs: { conditioning: ['pos', 0], guidance: T2I_GUIDANCE.refine } };
    graph.latent_up = { class_type: 'LatentUpscaleBy', inputs: { samples: ['sample_base', 0], upscale_method: 'bislerp', scale_by: scaleBy } };
    graph.sample_refine = {
      class_type: 'KSampler',
      inputs: {
        model: ['unet', 0],
        positive: ['guide_refine', 0],
        negative: ['neg', 0],
        latent_image: ['latent_up', 0],
        seed: params.seed + 1,
        steps: params.refine.steps,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: params.refine.denoise,
      },
    };
    decodeSource = ['sample_refine', 0];
  }

  graph.decode = { class_type: 'VAEDecode', inputs: { samples: decodeSource, vae: ['vae', 0] } };
  graph.save = { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: params.filenamePrefix } };
  return graph;
}

/**
 * Edição e composição multi-reference nativas do FLUX.2. Cada imagem é
 * normalizada, codificada pelo VAE e adicionada ao conditioning através de
 * uma cadeia de ReferenceLatent. O canvas de saída é independente das
 * dimensões das referências e usa Flux2Scheduler + SamplerCustomAdvanced,
 * conforme o template oficial Image Edit (Flux.2 Dev).
 */
export function buildFluxMultiReferenceGraph(params: {
  unetName: string;
  clipName: string;
  vaeName: string;
  prompt: string;
  seed: number;
  filenamePrefix: string;
  referenceImageNames: string[];
  steps: number;
  width: number;
  height: number;
  targetMegapixels: number;
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: params.unetName, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: params.clipName, type: 'flux2', device: 'cpu' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: params.vaeName } },
    pos: { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: params.prompt } },
    guide: { class_type: 'FluxGuidance', inputs: { conditioning: ['pos', 0], guidance: I2I_GUIDANCE } },
    latent: { class_type: 'EmptyFlux2LatentImage', inputs: { width: params.width, height: params.height, batch_size: 1 } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: params.seed } },
    scheduler: { class_type: 'Flux2Scheduler', inputs: { steps: params.steps, width: params.width, height: params.height } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
  };

  let conditioningSource: [string, number] = ['guide', 0];
  params.referenceImageNames.slice(0, 10).forEach((imageName, index) => {
    const prefix = `ref_${index + 1}`;
    graph[`${prefix}_load`] = { class_type: 'LoadImage', inputs: { image: imageName } };
    graph[`${prefix}_fit`] = {
      class_type: 'ImageScaleToTotalPixels',
      inputs: {
        image: [`${prefix}_load`, 0],
        upscale_method: 'lanczos',
        megapixels: params.targetMegapixels,
        // Required by current ComfyUI builds. A value of 1 preserves the
        // reference aspect ratio without coarse dimension quantisation.
        resolution_steps: 1,
      },
    };
    graph[`${prefix}_encode`] = {
      class_type: 'VAEEncode',
      inputs: { pixels: [`${prefix}_fit`, 0], vae: ['vae', 0] },
    };
    graph[`${prefix}_condition`] = {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: conditioningSource, latent: [`${prefix}_encode`, 0] },
    };
    conditioningSource = [`${prefix}_condition`, 0];
  });

  graph.guider = { class_type: 'BasicGuider', inputs: { model: ['unet', 0], conditioning: conditioningSource } };
  graph.sample = {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['noise', 0],
        guider: ['guider', 0],
        sampler: ['sampler', 0],
        sigmas: ['scheduler', 0],
        latent_image: ['latent', 0],
      },
  };
  graph.decode = { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['vae', 0] } };
  graph.save = { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: params.filenamePrefix } };
  return graph;
}

/**
 * Sobe uma imagem (bytes) pro ComfyUI (POST /upload/image) e devolve o nome
 * que o LoadImage precisa. O ComfyUI só lê imagem do disco dele, não aceita
 * URL nem bytes inline no grafo - por isso todo caminho (img2img, vídeo H3,
 * upscale) passa por este upload antes de submeter o prompt.
 */
export async function uploadImageBuffer(baseUrl: string, bytes: Buffer, filename: string): Promise<string> {
  // Nome único: o ComfyUI sobrescreve/renomeia arquivos de mesmo nome, e um
  // job pegando a referência de outro seria um bug silencioso e horrível.
  const safeName = `desigual-ref-${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(bytes)]), safeName);
  form.append('overwrite', 'true');

  const response = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`ComfyUI /upload/image falhou (${response.status}): ${await response.text()}`);
  }
  const uploaded = (await response.json()) as { name: string; subfolder?: string };
  return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
}

/**
 * Um carrossel de 8 slides com a mesma referência de produto reenviava essa
 * MESMA imagem (mesma URL imutável do Storage) pro ComfyUI 8 vezes - download
 * do Storage + upload pro ComfyUI, oito vezes, pra um arquivo que já estava
 * lá desde o primeiro slide. Cacheado por (baseUrl, imageUrl): o nome
 * resolvido na PRIMEIRA vez continua válido pro resto do processo, porque o
 * ComfyUI não apaga o arquivo entre chamadas e a URL do Storage não muda.
 * Guarda a Promise (não só o resultado) pra duas chamadas concorrentes pro
 * mesmo slide não dispararem dois uploads em paralelo.
 */
const referenceUploadCache = new Map<string, Promise<string>>();

/**
 * Baixa a referência do Storage e reenvia pro ComfyUI via uploadImageBuffer.
 */
export async function uploadReferenceImage(baseUrl: string, imageUrl: string, filename: string): Promise<string> {
  const cacheKey = `${baseUrl}::${imageUrl}`;
  const cached = referenceUploadCache.get(cacheKey);
  if (cached) return cached;

  const upload = (async () => {
    const download = await fetchWithRetry(imageUrl);
    if (!download.ok) {
      throw new Error(`Não consegui baixar a referência (${download.status}): ${imageUrl}`);
    }
    return uploadImageBuffer(baseUrl, Buffer.from(await download.arrayBuffer()), filename);
  })();
  // Se o upload falhar, não deixa o erro preso no cache pra sempre - a
  // próxima chamada tenta de novo em vez de repetir a mesma falha eternamente.
  upload.catch(() => referenceUploadCache.delete(cacheKey));
  referenceUploadCache.set(cacheKey, upload);
  return upload;
}

interface HistoryEntry {
  status: { completed: boolean; status_str: string };
  outputs: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

/**
 * Cliente HTTP direto pro ComfyUI real do Studio (porta 8188, confirmada
 * rodando via Pinokio). Não mexe em nada na máquina: só consome a API HTTP
 * que já está exposta lá, do jeito que o processo de criação de verdade já
 * funciona (mesmo checkpoint, mesmos parâmetros de sampler do histórico
 * real de execução).
 */
export interface GenerateImageResult {
  bytes: Buffer;
  /** O que foi de fato usado - grava em studio_jobs/studio_assets.metadata pra fingerprint de idempotência e auditoria (seções 24/25 do plano de evolução). */
  generation: {
    workflowId: 'edit_flux2_multireference_v2' | 't2i_flux2_native_v2';
    workflowVersion: string;
    seed: number;
    qualityProfile: QualityProfile;
    steps: number;
    refineSteps: number | null;
    denoise: number | null;
    resolution: { width: number; height: number };
    refineResolution: { width: number; height: number } | null;
    referenceCount: number;
  };
}

/**
 * Levantado quando um `resume` pede um prompt_id que o ComfyUI não conhece
 * mais - o caso real é o processo ter reiniciado (Pinokio, crash, deploy) e
 * perdido o histórico em memória. Sinaliza pro chamador (studio-node/index.ts)
 * que precisa submeter um prompt NOVO em vez de continuar esperando por um
 * que nunca vai completar.
 */
export class ComfyUIPromptLostError extends Error {
  constructor(public readonly promptId: string) {
    super(`ComfyUI não reconhece mais o prompt ${promptId} (provável restart do servidor)`);
    this.name = 'ComfyUIPromptLostError';
  }
}

/**
 * Antes de decidir "resumir" um prompt_id salvo de uma tentativa anterior
 * (worker morreu entre o /prompt e o upload pro Supabase), confirma que o
 * ComfyUI ainda sabe dele: /history só lista prompts que JÁ terminaram
 * (sucesso ou erro), então um prompt ainda rodando ou na fila não aparece lá
 * - por isso o fallback consulta /queue antes de declarar "perdido".
 */
async function findPromptState(baseUrl: string, promptId: string): Promise<'completed' | 'pending' | 'lost'> {
  const historyResponse = await fetchWithRetry(`${baseUrl}/history/${promptId}`, undefined, 2);
  if (historyResponse.ok) {
    const history = (await historyResponse.json()) as Record<string, HistoryEntry>;
    if (history[promptId]) return 'completed';
  }
  const queueResponse = await fetchWithRetry(`${baseUrl}/queue`, undefined, 2);
  if (queueResponse.ok) {
    const queue = (await queueResponse.json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
    const inQueue = [...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].some(
      (entry) => Array.isArray(entry) && entry[1] === promptId,
    );
    if (inQueue) return 'pending';
  }
  return 'lost';
}

export async function generateImageViaComfyUI(
  config: ComfyUIConfig,
  params: {
    prompt: string;
    width: number;
    height: number;
    referenceImage?: { url: string; filename: string } | undefined;
    /** Referências nativas do FLUX.2, na mesma ordem descrita no prompt. */
    referenceImages?: Array<{ url: string; filename: string }> | undefined;
    qualityProfile: QualityProfile;
    /** @deprecated O FLUX.2 usa ReferenceLatent e não denoise de img2img. */
    transformationDenoise?: number | undefined;
    /** Sobrescreve seed pra "regenerar exatamente" (seção 24) - se omitido, sorteia. */
    seed?: number | undefined;
    /** Prefixo do SaveImage no ComfyUI - inclui jobId pra rastrear o output até o job depois de um restart. Default 'desigual-os-studio'. */
    filenamePrefix?: string | undefined;
    /** Retoma um prompt_id já submetido numa tentativa anterior (worker morreu entre o /prompt e o upload) em vez de gerar de novo - ver ComfyUIPromptLostError pro caso de o servidor não reconhecer mais o prompt. */
    resume?: { promptId: string } | undefined;
    /** Chamado assim que o /prompt responde, ANTES do polling - o chamador salva {promptId, seed} em studio_jobs.metadata pra um resume sobreviver a um crash do worker no meio do polling/download/upload. */
    onSubmitted?: ((info: { promptId: string; seed: number; workflowId: GenerateImageResult['generation']['workflowId'] }) => Promise<void> | void) | undefined;
  },
): Promise<GenerateImageResult> {
  const clientId = randomUUID();
  const seed = params.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const filenamePrefix = params.filenamePrefix ?? 'desigual-os-studio';

  let graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  let generation: GenerateImageResult['generation'];

  const referenceImages = params.referenceImages?.length
    ? params.referenceImages.slice(0, 10)
    : params.referenceImage
      ? [params.referenceImage]
      : [];

  if (referenceImages.length > 0) {
    const i2iProfile = I2I_PROFILES[params.qualityProfile];
    const target = resolutionForMegapixels(params.width, params.height, I2I_TARGET_MEGAPIXELS);
    const uploadedReferences = await Promise.all(
      referenceImages.map((reference, index) =>
        uploadReferenceImage(config.baseUrl, reference.url, `${index + 1}-${reference.filename}`),
      ),
    );
    graph = buildFluxMultiReferenceGraph({
      unetName: config.unetName,
      clipName: config.clipName,
      vaeName: config.vaeName,
      prompt: params.prompt,
      seed,
      filenamePrefix,
      referenceImageNames: uploadedReferences,
      steps: i2iProfile.steps,
      width: target.width,
      height: target.height,
      targetMegapixels: I2I_TARGET_MEGAPIXELS,
    });
    generation = {
      workflowId: 'edit_flux2_multireference_v2',
      workflowVersion: '2.0.0',
      seed,
      qualityProfile: params.qualityProfile,
      steps: i2iProfile.steps,
      refineSteps: null,
      denoise: null,
      resolution: target,
      refineResolution: null,
      referenceCount: referenceImages.length,
    };
  } else {
    const t2iProfile = T2I_PROFILES[params.qualityProfile];
    const base = resolutionForMegapixels(params.width, params.height, t2iProfile.baseMegapixels);
    const refine = t2iProfile.refine ? resolutionForMegapixels(params.width, params.height, t2iProfile.refine.megapixels) : null;
    graph = buildFluxTextToImageGraph({
      unetName: config.unetName,
      clipName: config.clipName,
      vaeName: config.vaeName,
      prompt: params.prompt,
      base: { ...base, steps: t2iProfile.baseSteps },
      refine: refine && t2iProfile.refine ? { ...refine, steps: t2iProfile.refine.steps, denoise: t2iProfile.refine.denoise } : null,
      seed,
      filenamePrefix,
    });
    generation = {
      workflowId: 't2i_flux2_native_v2',
      workflowVersion: '2.0.0',
      seed,
      qualityProfile: params.qualityProfile,
      steps: t2iProfile.baseSteps,
      refineSteps: t2iProfile.refine?.steps ?? null,
      denoise: t2iProfile.refine?.denoise ?? null,
      resolution: base,
      refineResolution: refine,
      referenceCount: 0,
    };
  }

  let promptId: string;
  if (params.resume) {
    // Retomando um prompt de uma tentativa anterior: confirma que o ComfyUI
    // ainda sabe dele ANTES de entrar no polling - sem isso, um prompt
    // perdido (restart) só falharia depois de 20min esperando por nada.
    const state = await findPromptState(config.baseUrl, params.resume.promptId);
    if (state === 'lost') {
      throw new ComfyUIPromptLostError(params.resume.promptId);
    }
    promptId = params.resume.promptId;
  } else {
    const submitResponse = await fetch(`${config.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    });
    if (!submitResponse.ok) {
      throw new Error(`ComfyUI /prompt failed (${submitResponse.status}): ${await submitResponse.text()}`);
    }
    const submitted = (await submitResponse.json()) as { prompt_id: string; node_errors?: Record<string, unknown> };
    if (submitted.node_errors && Object.keys(submitted.node_errors).length > 0) {
      throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(submitted.node_errors)}`);
    }
    promptId = submitted.prompt_id;
    // Salva ANTES do polling: se o worker morrer entre aqui e o upload pro
    // Supabase, a próxima tentativa encontra este prompt_id em
    // studio_jobs.metadata e retoma em vez de gastar GPU de novo.
    await params.onSubmitted?.({ promptId, seed, workflowId: generation.workflowId });
  }

  const entry = await pollHistory(config.baseUrl, promptId);
  const saveImageOutput = Object.values(entry.outputs).find((output) => output.images && output.images.length > 0);
  const image = saveImageOutput?.images?.[0];
  if (!image) {
    throw new Error(`ComfyUI job ${promptId} completed without an image output`);
  }

  const viewUrl = new URL(`${config.baseUrl}/view`);
  viewUrl.searchParams.set('filename', image.filename);
  viewUrl.searchParams.set('subfolder', image.subfolder);
  viewUrl.searchParams.set('type', image.type);
  const imageResponse = await fetchWithRetry(viewUrl);
  if (!imageResponse.ok) {
    throw new Error(`ComfyUI /view failed (${imageResponse.status}) for ${image.filename}`);
  }
  return { bytes: Buffer.from(await imageResponse.arrayBuffer()), generation };
}

const POLL_INTERVAL_MS = 2000;
// 5min era pouco quando a fila do ComfyUI está ocupada com job de vídeo H3
// (cada um leva minutos de GPU): o Flux esperava na fila e estourava aqui
// mesmo com a máquina saudável (falha real observada em 04/09/2026).
// 13min também se mostrou curto no smoke test FLUX.2 ReferenceLatent de
// 09/09/2026: todos os nós preparatórios concluíram, mas a amostragem ainda
// estava saudável aos 13min e foi interrompida artificialmente. 20min deixa
// margem para edição multi-reference e continua abaixo do lockDuration de
// 25min do worker BullMQ.
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Cancela o job no ComfyUI de verdade quando o nosso poll desiste. Sem isso,
 * um timeout do nosso lado (worker BullMQ) não cancela nada no servidor: o
 * job continua "queue_running" pra sempre e trava a GPU pra toda fila
 * seguinte (falha real observada em 08/09/2026 - um vídeo travado há 47min
 * bloqueou um carrossel atrás dele na fila do ComfyUI, mesmo com
 * concurrency:1 do nosso lado). best-effort: nunca deixa o erro do timeout
 * original ser mascarado por uma falha aqui.
 */
export async function interruptComfyUI(baseUrl: string): Promise<void> {
  try {
    await fetchWithRetry(`${baseUrl}/interrupt`, { method: 'POST' }, 2);
    await fetchWithRetry(`${baseUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    }, 2);
  } catch {
    // best-effort - o erro de timeout original é o que importa pro chamador
  }
}

async function pollHistory(baseUrl: string, promptId: string): Promise<HistoryEntry> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetchWithRetry(`${baseUrl}/history/${promptId}`, undefined, 2);
    if (response.ok) {
      const history = (await response.json()) as Record<string, HistoryEntry>;
      const entry = history[promptId];
      if (entry?.status.completed) {
        if (entry.status.status_str !== 'success') {
          throw new Error(`ComfyUI job ${promptId} finished with status '${entry.status.status_str}'`);
        }
        return entry;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  await interruptComfyUI(baseUrl);
  throw new Error(`ComfyUI job ${promptId} did not complete within ${POLL_TIMEOUT_MS}ms`);
}

/**
 * ComfyUI tem dois formatos pro mesmo combo dependendo da versão/node:
 * `[[opções...]]` (antigo, confirmado hoje em UNETLoader/CLIPLoader/VAELoader
 * desta instância) ou `["COMBO", { options: [...] }]` (novo, confirmado hoje
 * em UpscaleModelLoader da MESMA instância - os dois formatos coexistem na
 * mesma versão do ComfyUI dependendo do node). Compartilhado com
 * comfyui-validate.ts pra não ter duas leituras divergentes do mesmo dado.
 */
export function extractComboOptions(fieldSpec: unknown): string[] | null {
  if (!Array.isArray(fieldSpec) || fieldSpec.length === 0) return null;
  const first = fieldSpec[0];
  if (Array.isArray(first)) return first.filter((v): v is string => typeof v === 'string');
  if (first === 'COMBO' && typeof fieldSpec[1] === 'object' && fieldSpec[1] !== null) {
    const options = (fieldSpec[1] as { options?: unknown }).options;
    if (Array.isArray(options)) return options.filter((v): v is string => typeof v === 'string');
  }
  return null;
}

/**
 * Confirma qual arquivo de modelo de verdade está disponível no ComfyUI
 * agora, em vez de fixar um nome (nomes de arquivo mudam - o histórico real
 * usava "flux1-dev-fp8.safetensors" num CheckpointLoaderSimple só; FLUX.2
 * Dev não tem checkpoint único, então isso é chamado uma vez por loader
 * (UNETLoader/CLIPLoader/VAELoader), cada um com sua própria lista de
 * modelos instalados).
 */
async function resolveModelName(
  baseUrl: string,
  classType: 'UNETLoader' | 'CLIPLoader' | 'VAELoader',
  inputField: 'unet_name' | 'clip_name' | 'vae_name',
  preferredSubstring: string,
): Promise<string> {
  const response = await fetchWithRetry(`${baseUrl}/object_info/${classType}`);
  if (!response.ok) {
    throw new Error(`ComfyUI /object_info failed (${response.status})`);
  }
  const info = (await response.json()) as Record<string, { input?: { required?: Record<string, unknown> } }>;
  const options = extractComboOptions(info[classType]?.input?.required?.[inputField]) ?? [];
  if (options.length === 0) {
    throw new Error(`ComfyUI has no models installed for ${classType}.${inputField}`);
  }
  const preferred = options.find((name) => name.toLowerCase().includes(preferredSubstring.toLowerCase()));
  return preferred ?? options[0]!;
}

export interface FluxModelHints {
  unetHint: string;
  clipHint: string;
  vaeHint: string;
}

export interface FluxModelNames {
  unetName: string;
  clipName: string;
  vaeName: string;
}

/**
 * Resolve os três arquivos do FLUX.2 Dev (diffusion model, text encoder,
 * VAE) em paralelo. Substitui o antigo resolveCheckpointName de arquivo
 * único do FLUX.1.
 */
export async function resolveFluxModelNames(baseUrl: string, hints: FluxModelHints): Promise<FluxModelNames> {
  const [unetName, clipName, vaeName] = await Promise.all([
    resolveModelName(baseUrl, 'UNETLoader', 'unet_name', hints.unetHint),
    resolveModelName(baseUrl, 'CLIPLoader', 'clip_name', hints.clipHint),
    resolveModelName(baseUrl, 'VAELoader', 'vae_name', hints.vaeHint),
  ]);
  return { unetName, clipName, vaeName };
}
