import sharp from 'sharp';
import { fetchWithRetry, uploadImageBuffer } from './comfyui-client';
import { maskToPixels, type MaskSpec } from './correction-router';

/**
 * CorrectionExecutor — aplica UMA correção local e devolve o candidato B.
 *
 * Duas garantias estruturais, e são elas que sustentam o princípio da fase
 * ("nenhuma correção automática pode piorar a imagem entregue"):
 *
 * 1. **Nunca sobrescreve o candidato A.** Recebe bytes, devolve bytes
 *    novos. Quem decide o que entregar é o RegressionGuard, depois.
 *
 * 2. **Fora da máscara, a imagem é byte a byte a original.** O grafo
 *    termina em `ImageCompositeMasked`, colando o resultado difundido de
 *    volta sobre a original SOMENTE dentro da máscara suavizada. Sem esse
 *    nó, um img2img "local" ainda redesenha a cena inteira em baixa
 *    intensidade - foi assim que a fase 2 conseguiu inserir mãos onde não
 *    havia mão. Aqui isso é impossível por construção, não por disciplina
 *    de prompt.
 *
 * `DifferentialDiffusion` + `SetLatentNoiseMask` fazem a difusão respeitar
 * a máscara com transição suave; `GrowMask`/`FeatherMask` evitam a emenda
 * dura na borda do recorte.
 */

export interface InpaintParams {
  baseUrl: string;
  unetName: string;
  clipName: string;
  vaeName: string;
  /** Candidato A - a imagem que PODE ser substituída, nunca alterada aqui. */
  imageBytes: Buffer;
  mask: MaskSpec;
  /** O que deve existir na região corrigida. Curto e afirmativo. */
  instruction: string;
  seed: number;
  /** Quanto redesenhar dentro da máscara. Baixo preserva mais contexto. */
  denoise?: number;
  steps?: number;
}

export function buildInpaintGraph(params: {
  imageName: string;
  unetName: string;
  clipName: string;
  vaeName: string;
  instruction: string;
  seed: number;
  width: number;
  height: number;
  mask: { x: number; y: number; width: number; height: number };
  feather: number;
  denoise: number;
  steps: number;
}): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const { mask } = params;
  return {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: params.unetName, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: params.clipName, type: 'flux2', device: 'cpu' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: params.vaeName } },
    src: { class_type: 'LoadImage', inputs: { image: params.imageName } },

    // Máscara retangular do tamanho da imagem, com o retângulo alvo em 1.0.
    canvas: { class_type: 'SolidMask', inputs: { value: 0.0, width: params.width, height: params.height } },
    alvo: { class_type: 'SolidMask', inputs: { value: 1.0, width: mask.width, height: mask.height } },
    combinada: {
      class_type: 'MaskComposite',
      inputs: { destination: ['canvas', 0], source: ['alvo', 0], x: mask.x, y: mask.y, operation: 'add' },
    },
    // Borda suave: sem isto a emenda do inpaint aparece como um retângulo.
    crescida: { class_type: 'GrowMask', inputs: { mask: ['combinada', 0], expand: 8, tapered_corners: true } },
    suave: { class_type: 'FeatherMask', inputs: { mask: ['crescida', 0], left: 24, top: 24, right: 24, bottom: 24 } },

    pos: { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: params.instruction } },
    guide: { class_type: 'FluxGuidance', inputs: { conditioning: ['pos', 0], guidance: 3.0 } },

    encode: { class_type: 'VAEEncode', inputs: { pixels: ['src', 0], vae: ['vae', 0] } },
    mascarado: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['encode', 0], mask: ['suave', 0] } },

    // Faz a difusão respeitar o gradiente da máscara em vez de um corte binário.
    difusao: { class_type: 'DifferentialDiffusion', inputs: { model: ['unet', 0] } },
    guider: { class_type: 'BasicGuider', inputs: { model: ['difusao', 0], conditioning: ['guide', 0] } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: params.seed } },
    // BasicScheduler, NÃO Flux2Scheduler: medido em 17/09/2026 que o
    // Flux2Scheduler não tem entrada `denoise` (só steps/width/height). O
    // ComfyUI ignora entradas extras em silêncio, então o `denoise: 0.55`
    // que passávamos não tinha efeito nenhum - a correção "local" rodava a
    // difusão inteira em força total e a primeira execução real não
    // terminou em 10 minutos. Com denoise de verdade, o sampler percorre só
    // a fração final do schedule.
    sched: {
      class_type: 'BasicScheduler',
      inputs: { model: ['difusao', 0], scheduler: 'beta', steps: params.steps, denoise: params.denoise },
    },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    sample: {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sched', 0], latent_image: ['mascarado', 0] },
    },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['vae', 0] } },

    // A GARANTIA: fora da máscara, pixels da ORIGINAL.
    colado: {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: ['src', 0], source: ['decode', 0], x: 0, y: 0, resize_source: false, mask: ['suave', 0] },
    },
    save: { class_type: 'SaveImage', inputs: { images: ['colado', 0], filename_prefix: 'desigual-os-studio-correction' } },
  };
}

interface HistoryEntry {
  status: { completed: boolean; status_str: string };
  outputs: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

/** Executa a correção e devolve o candidato B. Lança se o ComfyUI recusar o grafo. */
export async function runLocalCorrection(params: InpaintParams): Promise<Buffer> {
  const meta = await sharp(params.imageBytes).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;
  const px = maskToPixels(params.mask, width, height);

  const uploaded = await uploadImageBuffer(params.baseUrl, params.imageBytes, `correction-src-${params.seed}.png`);
  const graph = buildInpaintGraph({
    imageName: uploaded,
    unetName: params.unetName,
    clipName: params.clipName,
    vaeName: params.vaeName,
    instruction: params.instruction,
    seed: params.seed,
    width,
    height,
    mask: px,
    feather: params.mask.feather,
    denoise: params.denoise ?? 0.55,
    steps: params.steps ?? 20,
  });

  const submit = await fetch(`${params.baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: `correction-${params.seed}` }),
  });
  if (!submit.ok) throw new Error(`ComfyUI recusou o grafo de correção (${submit.status}): ${(await submit.text()).slice(0, 400)}`);
  const { prompt_id: promptId, node_errors: nodeErrors } = (await submit.json()) as { prompt_id: string; node_errors?: Record<string, unknown> };
  if (nodeErrors && Object.keys(nodeErrors).length > 0) {
    throw new Error(`ComfyUI rejeitou nós do grafo de correção: ${JSON.stringify(nodeErrors).slice(0, 400)}`);
  }

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetchWithRetry(`${params.baseUrl}/history/${promptId}`, undefined, 2);
    if (response.ok) {
      const history = (await response.json()) as Record<string, HistoryEntry>;
      const entry = history[promptId];
      if (entry?.status.completed) {
        if (entry.status.status_str !== 'success') throw new Error(`Correção falhou no ComfyUI: ${entry.status.status_str}`);
        const image = Object.values(entry.outputs).find((o) => o.images?.length)?.images?.[0];
        if (!image) throw new Error('Correção terminou sem imagem de saída');
        const url = new URL(`${params.baseUrl}/view`);
        url.searchParams.set('filename', image.filename);
        url.searchParams.set('subfolder', image.subfolder);
        url.searchParams.set('type', image.type);
        const bytes = await fetchWithRetry(url);
        if (!bytes.ok) throw new Error(`Não consegui baixar a correção (${bytes.status})`);
        return Buffer.from(await bytes.arrayBuffer());
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Correção não terminou em 10 min (prompt ${promptId})`);
}
