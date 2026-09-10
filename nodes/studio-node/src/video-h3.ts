import { randomUUID } from 'node:crypto';
import { fetchWithRetry, uploadImageBuffer } from './comfyui-client';

/**
 * Driver TypeScript do workflow de vídeo H3 (MiniMax), porta fiel do h3gen.py
 * validado na RTX 4090 em 03/09/2026 (SKILL E PROCESSO DE CRIAÇÃO/02_FERRAMENTA).
 * Mesmo grafo, mesmos modelos, mesmos parâmetros - não inventar variações:
 * a receita abaixo é a que roda de verdade na máquina (GGUF Q3 + encoder
 * NVFP4 na CPU é o que faz 768p caber na VRAM).
 */
export const H3_UNET_NAME = 'MiniMax-H3-FL2VA-Q3_K_M.gguf';
const H3_TURBO_LORA = 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors';
const H3_CLIP_NAME = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors';
const H3_VIDEO_VAE = 'minimax_h3_video_vae_fp16.safetensors';
const H3_AUDIO_VAE = 'minimax_h3_audio_vae_fp32.safetensors';
const H3_FPS = 24;
const H3_DEFAULT_STEPS = 8;
const H3_MASTER_DEFAULT_STEPS = 25;

/**
 * Regra do modelo H3: width/height MÚLTIPLOS DE 32, arredondados pra baixo
 * (arredondar pra cima poderia estourar a VRAM - a receita Q3+CPU já está
 * no limite do que a 4090 aguenta em 768p).
 */
export function snapToH3Grid(value: number): number {
  return Math.max(32, Math.floor(value / 32) * 32);
}

/**
 * Duração do H3 é em frames a 24fps na grade 17k+5 (22 = ~0.9s, 124 = ~5s,
 * 243 = ~10s): o VAE de vídeo decodifica em blocos de 17 frames. Qualquer
 * valor fora da grade o ComfyUI rejeita.
 */
export function snapLengthFrames(seconds: number): number {
  let length = Math.max(5, Math.round(seconds * H3_FPS));
  while (length % 17 !== 5) {
    length += 1;
  }
  return length;
}

interface H3GraphNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

/** Grafo exato do h3gen.py (função build): unet GGUF -> LoRA turbo -> i2v -> sampler -> decode vídeo+áudio -> mp4. */
function buildH3ImageToVideoGraph(params: {
  imageName: string;
  prompt: string;
  width: number;
  height: number;
  length: number;
  seed: number;
  steps: number;
  filenamePrefix: string;
}): Record<string, H3GraphNode> {
  return {
    unet: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: H3_UNET_NAME } },
    lora: {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: ['unet', 0], lora_name: H3_TURBO_LORA, strength_model: 1.0 },
    },
    // Encoder de texto carregado NA CPU de propósito: libera VRAM pro unet,
    // é o que permite rodar 768p cheio na 4090 (medido no h3gen.py).
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: H3_CLIP_NAME, type: 'minimax', device: 'cpu' } },
    vae_v: { class_type: 'VAELoader', inputs: { vae_name: H3_VIDEO_VAE } },
    vae_a: { class_type: 'VAELoader', inputs: { vae_name: H3_AUDIO_VAE } },
    img: { class_type: 'LoadImage', inputs: { image: params.imageName } },
    i2v: {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        clip: ['clip', 0],
        vae: ['vae_v', 0],
        first_frame: ['img', 0],
        prompt: params.prompt,
        width: params.width,
        height: params.height,
        length: params.length,
      },
    },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: params.seed } },
    sched: { class_type: 'BasicScheduler', inputs: { model: ['lora', 0], scheduler: 'simple', steps: params.steps, denoise: 1.0 } },
    ss: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    guider: { class_type: 'BasicGuider', inputs: { model: ['lora', 0], conditioning: ['i2v', 0] } },
    samp: {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['ss', 0], sigmas: ['sched', 0], latent_image: ['i2v', 1] },
    },
    dv: { class_type: 'VAEDecode', inputs: { samples: ['samp', 0], vae: ['vae_v', 0] } },
    da: { class_type: 'VAEDecodeAudio', inputs: { samples: ['samp', 0], vae: ['vae_a', 0] } },
    cv: { class_type: 'CreateVideo', inputs: { images: ['dv', 0], audio: ['da', 0], fps: H3_FPS } },
    sv: { class_type: 'SaveVideo', inputs: { video: ['cv', 0], filename_prefix: params.filenamePrefix, format: 'auto', codec: 'auto' } },
  };
}

const H3_MASTER_UNET_NAME = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors';
export const H3_MASTER_MODEL_ID = 'minimax-h3-master-unet';

/**
 * H3 MASTER (docs/comfyui-workflows/05_i2v_minimax_h3_quality.json) - único
 * dos 5 workflows anexados que roda sem nenhuma adaptação na GPU real
 * (confirmado via /object_info em 08/09/2026): unet int8 pruned SEM lora
 * turbo, 25 steps, res_multistep, áudio estéreo. Mais lento que o Draft
 * acima (~8-14min vs alguns segundos), por isso só roda depois de
 * aprovação do Draft (seção 16/17 do plano de evolução) - ver
 * selectH3Strategy em video-router.ts.
 */
function buildH3MasterGraph(params: {
  imageName: string;
  prompt: string;
  width: number;
  height: number;
  length: number;
  seed: number;
  steps: number;
  filenamePrefix: string;
}): Record<string, H3GraphNode> {
  return {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: H3_MASTER_UNET_NAME, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: H3_CLIP_NAME, type: 'minimax', device: 'cpu' } },
    vae_v: { class_type: 'VAELoader', inputs: { vae_name: H3_VIDEO_VAE } },
    vae_a: { class_type: 'VAELoader', inputs: { vae_name: H3_AUDIO_VAE } },
    img: { class_type: 'LoadImage', inputs: { image: params.imageName } },
    i2v: {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        clip: ['clip', 0],
        vae: ['vae_v', 0],
        first_frame: ['img', 0],
        prompt: params.prompt,
        width: params.width,
        height: params.height,
        length: params.length,
      },
    },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: params.seed } },
    sched: { class_type: 'BasicScheduler', inputs: { model: ['unet', 0], scheduler: 'simple', steps: params.steps, denoise: 1.0 } },
    ss: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    guider: { class_type: 'BasicGuider', inputs: { model: ['unet', 0], conditioning: ['i2v', 0] } },
    samp: {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['ss', 0], sigmas: ['sched', 0], latent_image: ['i2v', 1] },
    },
    dv: { class_type: 'VAEDecode', inputs: { samples: ['samp', 0], vae: ['vae_v', 0] } },
    da: { class_type: 'VAEDecodeAudio', inputs: { samples: ['samp', 0], vae: ['vae_a', 0] } },
    cv: { class_type: 'CreateVideo', inputs: { images: ['dv', 0], audio: ['da', 0], fps: H3_FPS } },
    sv: { class_type: 'SaveVideo', inputs: { video: ['cv', 0], filename_prefix: params.filenamePrefix, format: 'auto', codec: 'auto' } },
  };
}

interface H3HistoryEntry {
  status?: { completed?: boolean; status_str?: string; messages?: unknown };
  outputs?: Record<string, Record<string, unknown>>;
}

interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string;
}

function asMp4Output(value: unknown): ComfyOutputFile | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { filename?: unknown; subfolder?: unknown; type?: unknown };
  if (typeof candidate.filename !== 'string' || !candidate.filename.endsWith('.mp4')) return null;
  return {
    filename: candidate.filename,
    subfolder: typeof candidate.subfolder === 'string' ? candidate.subfolder : '',
    type: typeof candidate.type === 'string' ? candidate.type : 'output',
  };
}

/** O SaveVideo pode reportar o arquivo em chaves diferentes ("videos", "gifs"...); varre tudo atrás do .mp4. */
function findMp4Output(entry: H3HistoryEntry): ComfyOutputFile | null {
  for (const output of Object.values(entry.outputs ?? {})) {
    for (const value of Object.values(output)) {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        const file = asMp4Output(item);
        if (file) return file;
      }
    }
  }
  return null;
}

export interface GenerateVideoH3Params {
  baseUrl: string;
  /** Hero frame: Buffer já baixado (ex.: gerado via Flux) ou URL pra baixar. */
  image: Buffer | { url: string; filename: string };
  prompt: string;
  width: number;
  height: number;
  seconds?: number;
  seed?: number;
  steps?: number;
  /**
   * Vídeo 768p 5s leva ~7min na 4090 no caso ideal, mas medido ao vivo em
   * 08/09/2026: rodas reais bateram 13-14min (perto do teto antigo de
   * 14min, causando timeout falso num job que só estava lento, não
   * travado). Default 20min cabe com folga real no lockDuration de 25min
   * do worker BullMQ (que já reserva espaço extra pro hero frame Flux
   * antes deste passo).
   */
  timeoutMs?: number;
  pollIntervalMs?: number;
  filenamePrefix?: string;
  resumePromptId?: string;
  onSubmitted?: (info: { promptId: string; seed: number }) => Promise<void>;
}

async function uploadHeroFrame(baseUrl: string, image: Buffer | { url: string; filename: string }): Promise<string> {
  let imageBytes: Buffer;
  let imageFilename: string;
  if (Buffer.isBuffer(image)) {
    imageBytes = image;
    imageFilename = 'hero-frame.png';
  } else {
    const download = await fetchWithRetry(image.url);
    if (!download.ok) {
      throw new Error(`Não consegui baixar o frame base do vídeo (${download.status}): ${image.url}`);
    }
    imageBytes = Buffer.from(await download.arrayBuffer());
    imageFilename = image.filename;
  }
  return uploadImageBuffer(baseUrl, imageBytes, imageFilename);
}

async function runH3Graph(baseUrl: string, graph: Record<string, H3GraphNode> | null, timeoutMs: number, pollIntervalMs: number, params: GenerateVideoH3Params, seed: number): Promise<Buffer> {
  let promptId = params.resumePromptId;
  if (!promptId) {
  const clientId = randomUUID();
  const submitResponse = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  });
  if (!submitResponse.ok) {
    throw new Error(`ComfyUI /prompt failed (${submitResponse.status}): ${await submitResponse.text()}`);
  }
  const submitted = (await submitResponse.json()) as { prompt_id: string; node_errors?: Record<string, unknown> };
  if (submitted.node_errors && Object.keys(submitted.node_errors).length > 0) {
    throw new Error(`ComfyUI rejected the H3 video workflow: ${JSON.stringify(submitted.node_errors)}`);
  }
  if (!submitted.prompt_id) throw new Error('ComfyUI não retornou o identificador do take.');
  promptId = submitted.prompt_id;
  await params.onSubmitted?.({ promptId, seed });
  }
  const entry = await pollH3History(baseUrl, promptId, timeoutMs, pollIntervalMs);
  const video = findMp4Output(entry);
  if (!video) {
    throw new Error(`ComfyUI job ${promptId} completed without an .mp4 output`);
  }

  const viewUrl = new URL(`${baseUrl}/view`);
  viewUrl.searchParams.set('filename', video.filename);
  viewUrl.searchParams.set('subfolder', video.subfolder);
  viewUrl.searchParams.set('type', video.type);
  const videoResponse = await fetchWithRetry(viewUrl);
  if (!videoResponse.ok) {
    throw new Error(`ComfyUI /view failed (${videoResponse.status}) for ${video.filename}`);
  }
  return Buffer.from(await videoResponse.arrayBuffer());
}

/** H3 DRAFT: GGUF Q3 + LoRA turbo 8 steps. Explora seed/câmera/prompt antes do Master gastar minutos de GPU (seção 16). */
export async function generateVideoH3(params: GenerateVideoH3Params): Promise<Buffer> {
  const width = snapToH3Grid(params.width);
  const height = snapToH3Grid(params.height);
  const length = snapLengthFrames(params.seconds ?? 5);
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 31);
  const steps = params.steps ?? H3_DEFAULT_STEPS;
  const timeoutMs = params.timeoutMs ?? 20 * 60 * 1000;
  const pollIntervalMs = params.pollIntervalMs ?? 12_000;

  if (params.resumePromptId) return runH3Graph(params.baseUrl, null, timeoutMs, pollIntervalMs, params, seed);

  const uploadedName = await uploadHeroFrame(params.baseUrl, params.image);
  const graph = buildH3ImageToVideoGraph({
    imageName: uploadedName,
    prompt: params.prompt,
    width,
    height,
    length,
    seed,
    steps,
    filenamePrefix: params.filenamePrefix ?? 'video/desigual-os-studio-draft',
  });
  return runH3Graph(params.baseUrl, graph, timeoutMs, pollIntervalMs, params, seed);
}

export type GenerateVideoH3MasterParams = GenerateVideoH3Params;

/**
 * H3 MASTER: unet int8 pruned, sem LoRA turbo, 25 steps (docs/comfyui-workflows/05_i2v_minimax_h3_quality.json,
 * único dos 5 anexados que roda sem adaptação na GPU real). SÓ chamar
 * depois de aprovação do Draft (seção 17) - 25 steps sem turbo é
 * significativamente mais lento que os 8 steps do Draft (README: ~8-14min
 * pro workflow de qualidade vs segundos pro turbo), então timeout default
 * é maior que o do Draft.
 */
export async function generateVideoH3Master(params: GenerateVideoH3MasterParams): Promise<Buffer> {
  const width = snapToH3Grid(params.width);
  const height = snapToH3Grid(params.height);
  const length = snapLengthFrames(params.seconds ?? 5);
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 31);
  const steps = params.steps ?? H3_MASTER_DEFAULT_STEPS;
  const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000;
  const pollIntervalMs = params.pollIntervalMs ?? 15_000;

  if (params.resumePromptId) return runH3Graph(params.baseUrl, null, timeoutMs, pollIntervalMs, params, seed);

  const uploadedName = await uploadHeroFrame(params.baseUrl, params.image);
  const graph = buildH3MasterGraph({
    imageName: uploadedName,
    prompt: params.prompt,
    width,
    height,
    length,
    seed,
    steps,
    filenamePrefix: params.filenamePrefix ?? 'video/desigual-os-studio-master',
  });
  return runH3Graph(params.baseUrl, graph, timeoutMs, pollIntervalMs, params, seed);
}

async function pollH3History(baseUrl: string, promptId: string, timeoutMs: number, intervalMs: number): Promise<H3HistoryEntry> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetchWithRetry(`${baseUrl}/history/${promptId}`, undefined, 2);
    if (response.ok) {
      const history = (await response.json()) as Record<string, H3HistoryEntry>;
      const entry = history[promptId];
      // status_str 'error' chega ANTES do completed: o h3gen.py trata os dois
      // separados, e tratar aqui também evita reportar "sem mp4" quando o que
      // houve foi uma falha real de GPU (mensagem muito mais útil no job).
      if (entry?.status?.status_str === 'error') {
        throw new Error(`ComfyUI H3 job ${promptId} failed: ${JSON.stringify(entry.status.messages ?? entry.status)}`);
      }
      if (entry?.status?.completed) {
        if (entry.status.status_str !== 'success') {
          throw new Error(`ComfyUI H3 job ${promptId} finished with status '${entry.status.status_str}'`);
        }
        return entry;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  // Um timeout local não autoriza interromper o job de outro cliente na GPU.
  // O prompt_id persistido permite retomar a importação na próxima tentativa.
  throw new Error(`ComfyUI H3 job ${promptId} did not complete within ${timeoutMs}ms; retome pelo prompt_id salvo, sem reenviar a geração.`);
}
