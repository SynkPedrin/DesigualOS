import { randomUUID } from 'node:crypto';
import { fetchWithRetry, uploadImageBuffer, interruptComfyUI } from './comfyui-client';
import { masterFinishDenoise, type MasterFinishDenoiseContext } from './quality-profiles';
import { requireEnabledModel } from './model-registry';

/**
 * Finish Router (seções 9-13 do plano de evolução do Studio).
 *
 * O workflow 04_finish_upscale_refine.json NÃO roda mais automaticamente
 * depois de toda imagem - só quando o resultado de fato precisa. A maioria
 * das imagens que o T2I/I2I já produz em ~1088x1360 tem resolução E
 * detalhe suficientes pra entrega direta; rodar upscale generativo nelas é
 * gastar minutos de GPU pra gerar pixels que o resize final vai descartar
 * (seção 13 do plano).
 */
export type FinishStrategy = 'fast' | 'restore' | 'master';

export interface FinishDecisionContext {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  /** true se o Visual QA (quando existir) apontou falta de detalhe real (pele/tecido/material) - força master mesmo com resolução suficiente. */
  detailInsufficient?: boolean;
}

export function selectFinishStrategy(ctx: FinishDecisionContext): FinishStrategy {
  if (ctx.detailInsufficient) return 'master';
  const needsUpscale = ctx.sourceWidth < ctx.targetWidth || ctx.sourceHeight < ctx.targetHeight;
  return needsUpscale ? 'restore' : 'fast';
}

export type GrainMode = 'none' | 'subtle' | 'film';
const GRAIN_STRENGTH: Record<Exclude<GrainMode, 'none'>, number> = {
  subtle: 0.015,
  film: 0.025, // valor calibrado no 04_finish_upscale_refine.json original
};

interface FinishGraphNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

function appendResizeSharpenGrain(
  graph: Record<string, FinishGraphNode>,
  sourceKey: string,
  params: { targetWidth: number; targetHeight: number; grain: GrainMode; seed: number },
): string {
  graph.resize = {
    class_type: 'ImageScale',
    inputs: { image: [sourceKey, 0], upscale_method: 'lanczos', width: params.targetWidth, height: params.targetHeight, crop: 'center' },
  };
  graph.sharpen = { class_type: 'ImageSharpen', inputs: { image: ['resize', 0], sharpen_radius: 1, sigma: 0.8, alpha: 0.22 } };
  if (params.grain === 'none') return 'sharpen';
  graph.grain = { class_type: 'ImageAddNoise', inputs: { image: ['sharpen', 0], seed: params.seed, strength: GRAIN_STRENGTH[params.grain] } };
  return 'grain';
}

function buildFastFinishGraph(params: { imageName: string; targetWidth: number; targetHeight: number; grain: GrainMode; seed: number; filenamePrefix: string }) {
  const graph: Record<string, FinishGraphNode> = {
    src_load: { class_type: 'LoadImage', inputs: { image: params.imageName } },
  };
  const finalKey = appendResizeSharpenGrain(graph, 'src_load', params);
  graph.save = { class_type: 'SaveImage', inputs: { images: [finalKey, 0], filename_prefix: params.filenamePrefix } };
  return graph;
}

function buildRestoreFinishGraph(params: {
  imageName: string;
  upscaleModelFile: string;
  targetWidth: number;
  targetHeight: number;
  grain: GrainMode;
  seed: number;
  filenamePrefix: string;
}) {
  const graph: Record<string, FinishGraphNode> = {
    src_load: { class_type: 'LoadImage', inputs: { image: params.imageName } },
    upscale_model: { class_type: 'UpscaleModelLoader', inputs: { model_name: params.upscaleModelFile } },
    upscaled: { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['upscale_model', 0], image: ['src_load', 0] } },
  };
  const finalKey = appendResizeSharpenGrain(graph, 'upscaled', params);
  graph.save = { class_type: 'SaveImage', inputs: { images: [finalKey, 0], filename_prefix: params.filenamePrefix } };
  return graph;
}

/**
 * MASTER FINISH (docs/comfyui-workflows/04_finish_upscale_refine.json,
 * adaptado pra FLUX.2 Dev). BLOQUEADO em produção hoje: o custom node
 * `UltimateSDUpscale` não está instalado na GPU (confirmado ao vivo via
 * /object_info em 08/09/2026 - ver comfyui-validate.ts). Fica pronto pra
 * uso assim que o node for instalado (README documenta o pacote a
 * instalar); chamar esta função antes disso falha alto e claro, não tenta
 * rodar um substituto silencioso.
 */
function buildMasterFinishGraph(params: {
  imageName: string;
  unetName: string;
  clipName: string;
  vaeName: string;
  upscaleModelFile: string;
  denoise: number;
  steps: number;
  scaleBy: number;
  targetWidth: number;
  targetHeight: number;
  grain: GrainMode;
  seed: number;
  filenamePrefix: string;
}) {
  const graph: Record<string, FinishGraphNode> = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: params.unetName, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: params.clipName, type: 'flux2', device: 'cpu' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: params.vaeName } },
    src_load: { class_type: 'LoadImage', inputs: { image: params.imageName } },
    upscale_model: { class_type: 'UpscaleModelLoader', inputs: { model_name: params.upscaleModelFile } },
    pos: {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['clip', 0],
        text: 'High resolution photographic detail, natural micro-texture, visible surface grain, sharp edge definition without haloing, realistic material rendering, 35mm film texture.',
      },
    },
    neg: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['pos', 0] } },
    guide: { class_type: 'FluxGuidance', inputs: { conditioning: ['pos', 0], guidance: 2.0 } },
    refine: {
      class_type: 'UltimateSDUpscale',
      inputs: {
        image: ['src_load', 0],
        model: ['unet', 0],
        positive: ['guide', 0],
        negative: ['neg', 0],
        vae: ['vae', 0],
        upscale_model: ['upscale_model', 0],
        upscale_by: params.scaleBy,
        seed: params.seed,
        steps: params.steps,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'beta',
        denoise: params.denoise,
        mode_type: 'Linear',
        tile_width: 1024,
        tile_height: 1024,
        mask_blur: 12,
        tile_padding: 32,
        seam_fix_mode: 'Half Tile',
        seam_fix_denoise: 1,
        seam_fix_width: 64,
        seam_fix_mask_blur: 8,
        seam_fix_padding: 16,
        force_uniform_tiles: true,
        tiled_decode: false,
      },
    },
  };
  const finalKey = appendResizeSharpenGrain(graph, 'refine', params);
  graph.save = { class_type: 'SaveImage', inputs: { images: [finalKey, 0], filename_prefix: params.filenamePrefix } };
  return graph;
}

interface FinishHistoryEntry {
  status: { completed: boolean; status_str: string };
  outputs: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

async function submitAndWait(baseUrl: string, graph: Record<string, FinishGraphNode>, timeoutMs: number, pollIntervalMs = 3000): Promise<Buffer> {
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
    throw new Error(`ComfyUI rejected the finish workflow: ${JSON.stringify(submitted.node_errors)}`);
  }

  const deadline = Date.now() + timeoutMs;
  let entry: FinishHistoryEntry | undefined;
  while (Date.now() < deadline) {
    const response = await fetchWithRetry(`${baseUrl}/history/${submitted.prompt_id}`, undefined, 2);
    if (response.ok) {
      const history = (await response.json()) as Record<string, FinishHistoryEntry>;
      entry = history[submitted.prompt_id];
      if (entry?.status.completed) {
        if (entry.status.status_str !== 'success') {
          throw new Error(`ComfyUI finish job ${submitted.prompt_id} finished with status '${entry.status.status_str}'`);
        }
        break;
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  if (!entry?.status.completed) {
    await interruptComfyUI(baseUrl);
    throw new Error(`ComfyUI finish job ${submitted.prompt_id} did not complete within ${timeoutMs}ms`);
  }

  const saveImageOutput = Object.values(entry.outputs).find((output) => output.images && output.images.length > 0);
  const image = saveImageOutput?.images?.[0];
  if (!image) throw new Error(`ComfyUI finish job ${submitted.prompt_id} completed without an image output`);

  const viewUrl = new URL(`${baseUrl}/view`);
  viewUrl.searchParams.set('filename', image.filename);
  viewUrl.searchParams.set('subfolder', image.subfolder);
  viewUrl.searchParams.set('type', image.type);
  const imageResponse = await fetchWithRetry(viewUrl);
  if (!imageResponse.ok) throw new Error(`ComfyUI /view failed (${imageResponse.status}) for ${image.filename}`);
  return Buffer.from(await imageResponse.arrayBuffer());
}

export interface FinishParams {
  baseUrl: string;
  image: Buffer | { url: string; filename: string };
  targetWidth: number;
  targetHeight: number;
  grain: GrainMode;
  /** Só usado em 'restore'/'master'. */
  upscaleModelId?: string;
  /** Só usado em 'master'. */
  fluxModel?: { unetName: string; clipName: string; vaeName: string };
  masterContext?: MasterFinishDenoiseContext;
  masterSteps?: number;
  /** Fator de upscale do UltimateSDUpscale antes do resize final pro target. 2.0 = valor do 04_finish_upscale_refine.json original. */
  masterScaleBy?: number;
}

export async function runFinish(strategy: FinishStrategy, params: FinishParams): Promise<Buffer> {
  const seed = Math.floor(Math.random() * 1_000_000_000);

  let imageBytes: Buffer;
  let imageFilename: string;
  if (Buffer.isBuffer(params.image)) {
    imageBytes = params.image;
    imageFilename = 'finish-source.png';
  } else {
    const download = await fetchWithRetry(params.image.url);
    if (!download.ok) throw new Error(`Não consegui baixar a imagem pro finish (${download.status}): ${params.image.url}`);
    imageBytes = Buffer.from(await download.arrayBuffer());
    imageFilename = params.image.filename;
  }
  const uploadedName = await uploadImageBuffer(params.baseUrl, imageBytes, imageFilename);
  const common = { targetWidth: params.targetWidth, targetHeight: params.targetHeight, grain: params.grain, seed };

  if (strategy === 'fast') {
    const graph = buildFastFinishGraph({ imageName: uploadedName, filenamePrefix: 'desigual-os-studio-finish-fast', ...common });
    return submitAndWait(params.baseUrl, graph, 3 * 60 * 1000);
  }

  const upscaleModel = requireEnabledModel(params.upscaleModelId ?? 'upscale-ultrasharp-4x');

  if (strategy === 'restore') {
    const graph = buildRestoreFinishGraph({
      imageName: uploadedName,
      upscaleModelFile: upscaleModel.file,
      filenamePrefix: 'desigual-os-studio-finish-restore',
      ...common,
    });
    return submitAndWait(params.baseUrl, graph, 5 * 60 * 1000);
  }

  // strategy === 'master'
  if (!params.fluxModel) throw new Error('Finish master requer fluxModel (unet/clip/vae) resolvido - chame resolveFluxModelNames antes.');
  const infoResponse = await fetchWithRetry(`${params.baseUrl}/object_info/UltimateSDUpscale`, undefined, 2);
  const infoBody = infoResponse.ok ? await infoResponse.json() : {};
  if (!infoResponse.ok || !infoBody || Object.keys(infoBody).length === 0) {
    throw new Error(
      'Finish master indisponível: o custom node UltimateSDUpscale não está instalado nesta instância do ComfyUI (GET /object_info/UltimateSDUpscale vazio). ' +
        'Instale o pacote ComfyUI_UltimateSDUpscale e reinicie o ComfyUI antes de usar este finish - ver README.',
    );
  }

  const denoise = masterFinishDenoise(params.masterContext ?? {});
  const graph = buildMasterFinishGraph({
    imageName: uploadedName,
    unetName: params.fluxModel.unetName,
    clipName: params.fluxModel.clipName,
    vaeName: params.fluxModel.vaeName,
    upscaleModelFile: upscaleModel.file,
    denoise,
    steps: params.masterSteps ?? 14,
    scaleBy: params.masterScaleBy ?? 2.0,
    filenamePrefix: 'desigual-os-studio-finish-master',
    ...common,
  });
  return submitAndWait(params.baseUrl, graph, 6 * 60 * 1000);
}
