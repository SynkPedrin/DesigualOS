/**
 * Registro central de workflows do Studio.
 *
 * Cada entrada é uma versão nomeada e imutável de um grafo ComfyUI. Editar o
 * grafo de um id existente em produção é proibido por construção deste
 * projeto: bump a versão (`_v2`) e adicione uma entrada nova. O builder de
 * cada workflow vive em `comfyui-client.ts`, `video-h3.ts` ou `finish.ts` -
 * este arquivo só descreve METADADOS (pra o router, validação de startup e
 * para o campo `workflow`/`workflow_version` gravado no job), não a lógica
 * de montagem do grafo.
 *
 * `requiredClassTypes` é a lista de `class_type` do ComfyUI que o grafo usa;
 * `validateWorkflowsAgainstComfyUI` (comfyui-validate.ts) confere isso
 * contra /object_info na subida do processo. `requiredModelIds` aponta pro
 * MODEL_REGISTRY - se algum modelo referenciado estiver `enabled: false`, o
 * workflow inteiro fica `status: 'blocked'` automaticamente (ver
 * `isWorkflowAvailable`), não precisa marcar os dois lugares.
 */

import { MODEL_REGISTRY } from './model-registry';

export type WorkflowCapability = 'text_to_image' | 'image_to_image' | 'edit' | 'finish' | 'image_to_video';

export interface WorkflowRegistryEntry {
  id: string;
  version: string;
  /** Arquivo de referência em docs/comfyui-workflows/ do qual este builder foi derivado (fonte de verdade original), quando existir. */
  referenceDoc?: string;
  modelFamily: 'flux2' | 'minimax-h3' | 'none';
  capability: WorkflowCapability;
  requiredClassTypes: string[];
  requiredModelIds: string[];
  description: string;
}

export const WORKFLOW_REGISTRY: Record<string, WorkflowRegistryEntry> = {
  t2i_flux2_editorial_v1: {
    id: 't2i_flux2_editorial_v1',
    version: '1.0.0',
    referenceDoc: 'docs/comfyui-workflows/01_t2i_flux_editorial.json (arquitetura adaptada de FLUX.1-dev pra FLUX.2 Dev - modelo original não instalado na GPU, ver model-registry.ts)',
    modelFamily: 'flux2',
    capability: 'text_to_image',
    requiredClassTypes: [
      'UNETLoader',
      'CLIPLoader',
      'VAELoader',
      'CLIPTextEncode',
      'ConditioningZeroOut',
      'FluxGuidance',
      'EmptyFlux2LatentImage',
      'KSampler',
      'LatentUpscaleBy',
      'VAEDecode',
      'SaveImage',
    ],
    requiredModelIds: ['flux2-dev-unet', 'flux2-text-encoder', 'flux2-vae'],
    description: 'Texto -> imagem, dois estágios (base + refino hires-fix condicional por quality profile).',
  },
  t2i_flux2_native_v2: {
    id: 't2i_flux2_native_v2',
    version: '2.0.0',
    referenceDoc: 'Template oficial Comfy-Org image_flux2_text_to_image, com refino editorial condicional no profile master',
    modelFamily: 'flux2',
    capability: 'text_to_image',
    requiredClassTypes: [
      'UNETLoader',
      'CLIPLoader',
      'VAELoader',
      'CLIPTextEncode',
      'FluxGuidance',
      'EmptyFlux2LatentImage',
      'RandomNoise',
      'Flux2Scheduler',
      'KSamplerSelect',
      'BasicGuider',
      'SamplerCustomAdvanced',
      'ConditioningZeroOut',
      'KSampler',
      'LatentUpscaleBy',
      'VAEDecode',
      'SaveImage',
    ],
    requiredModelIds: ['flux2-dev-unet', 'flux2-text-encoder', 'flux2-vae'],
    description: 'Texto para imagem com sampler e scheduler nativos do FLUX.2; profile master mantém refino editorial em segundo passe.',
  },
  i2i_flux2_reference_v1: {
    id: 'i2i_flux2_reference_v1',
    version: '1.0.0',
    referenceDoc: 'docs/comfyui-workflows/02_i2i_flux_reference.json (arquitetura adaptada pra FLUX.2 Dev)',
    modelFamily: 'flux2',
    capability: 'image_to_image',
    requiredClassTypes: [
      'UNETLoader',
      'CLIPLoader',
      'VAELoader',
      'LoadImage',
      'ImageScaleToTotalPixels',
      'GetImageSize',
      'VAEEncode',
      'CLIPTextEncode',
      'ConditioningZeroOut',
      'FluxGuidance',
      'KSampler',
      'VAEDecode',
      'SaveImage',
    ],
    requiredModelIds: ['flux2-dev-unet', 'flux2-text-encoder', 'flux2-vae'],
    description: 'Imagem de referência -> imagem, denoise adaptativo por transformationStrength, resolução dinâmica pelo aspect ratio de entrada.',
  },
  edit_flux2_multireference_v2: {
    id: 'edit_flux2_multireference_v2',
    version: '2.0.0',
    referenceDoc: 'Template oficial Comfy-Org image_flux2_fp8, subgraph Image Edit (Flux.2 Dev)',
    modelFamily: 'flux2',
    capability: 'edit',
    requiredClassTypes: [
      'UNETLoader',
      'CLIPLoader',
      'VAELoader',
      'LoadImage',
      'ImageScaleToTotalPixels',
      'VAEEncode',
      'CLIPTextEncode',
      'FluxGuidance',
      'ReferenceLatent',
      'EmptyFlux2LatentImage',
      'RandomNoise',
      'Flux2Scheduler',
      'KSamplerSelect',
      'BasicGuider',
      'SamplerCustomAdvanced',
      'VAEDecode',
      'SaveImage',
    ],
    requiredModelIds: ['flux2-dev-unet', 'flux2-text-encoder', 'flux2-vae'],
    description: 'Edição nativa FLUX.2 com 1 a 10 ReferenceLatent encadeados, scheduler próprio da arquitetura e canvas de saída independente.',
  },
  edit_flux_kontext_v1: {
    id: 'edit_flux_kontext_v1',
    version: '1.0.0',
    referenceDoc: 'docs/comfyui-workflows/03_edit_flux_kontext.json',
    modelFamily: 'none',
    capability: 'edit',
    requiredClassTypes: ['UNETLoader', 'DualCLIPLoader', 'VAELoader', 'LoadImage', 'FluxKontextImageScale', 'VAEEncode', 'CLIPTextEncode', 'ReferenceLatent', 'FluxGuidance', 'ConditioningZeroOut', 'KSampler', 'VAEDecode', 'SaveImage'],
    requiredModelIds: ['flux1-dev-kontext-unet', 'flux1-dev-t5-clip'],
    description: 'Edição por instrução preservando cena (não implementado: nenhum modelo de edição compatível com FLUX.2 está instalado na GPU hoje - ver model-registry.ts).',
  },
  finish_fast_v1: {
    id: 'finish_fast_v1',
    version: '1.0.0',
    modelFamily: 'none',
    capability: 'finish',
    requiredClassTypes: ['LoadImage', 'ImageScale', 'ImageSharpen', 'ImageAddNoise', 'SaveImage'],
    requiredModelIds: [],
    description: 'Resize + sharpen + grão opcional, sem difusão nem upscale model. Caminho padrão pra imagem já boa.',
  },
  finish_restore_v1: {
    id: 'finish_restore_v1',
    version: '1.0.0',
    modelFamily: 'none',
    capability: 'finish',
    requiredClassTypes: ['LoadImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScale', 'ImageSharpen', 'ImageAddNoise', 'SaveImage'],
    requiredModelIds: ['upscale-ultrasharp-4x'],
    description: 'UpscaleModel + resize + sharpen + grão opcional, sem segunda difusão. Pra quando falta resolução mas não falta detalhe real.',
  },
  finish_master_v1: {
    id: 'finish_master_v1',
    version: '1.0.0',
    referenceDoc: 'docs/comfyui-workflows/04_finish_upscale_refine.json',
    modelFamily: 'flux2',
    capability: 'finish',
    requiredClassTypes: ['LoadImage', 'UpscaleModelLoader', 'UltimateSDUpscale', 'CLIPTextEncode', 'ConditioningZeroOut', 'FluxGuidance', 'ImageScale', 'ImageSharpen', 'ImageAddNoise', 'SaveImage'],
    requiredModelIds: ['flux2-dev-unet', 'flux2-text-encoder', 'flux2-vae', 'upscale-ultrasharp-4x'],
    description:
      'Upscale + refino tiled por difusão (UltimateSDUpscale) + grão. BLOQUEADO: custom node UltimateSDUpscale não está instalado na GPU (confirmado ao vivo, GET /object_info/UltimateSDUpscale retorna vazio). Fica pronto pra uso assim que o node for instalado - ver README.',
  },
  i2v_minimax_h3_draft_v1: {
    id: 'i2v_minimax_h3_draft_v1',
    version: '1.0.0',
    modelFamily: 'minimax-h3',
    capability: 'image_to_video',
    requiredClassTypes: [
      'UnetLoaderGGUF',
      'LoraLoaderModelOnly',
      'CLIPLoader',
      'VAELoader',
      'LoadImage',
      'MiniMaxH3ImageToVideo',
      'RandomNoise',
      'BasicScheduler',
      'KSamplerSelect',
      'BasicGuider',
      'SamplerCustomAdvanced',
      'VAEDecode',
      'VAEDecodeAudio',
      'CreateVideo',
      'SaveVideo',
    ],
    requiredModelIds: ['minimax-h3-draft-unet-gguf', 'minimax-h3-turbo-lora', 'minimax-h3-text-encoder', 'minimax-h3-video-vae', 'minimax-h3-audio-vae'],
    description: 'GGUF Q3 + LoRA turbo 8 steps. Rápido, pra explorar seed/câmera/prompt antes do Master. Já era o comportamento de generateVideoH3 antes desta reestruturação.',
  },
  i2v_minimax_h3_master_v1: {
    id: 'i2v_minimax_h3_master_v1',
    version: '1.0.0',
    referenceDoc: 'docs/comfyui-workflows/05_i2v_minimax_h3_quality.json',
    modelFamily: 'minimax-h3',
    capability: 'image_to_video',
    requiredClassTypes: [
      'UNETLoader',
      'CLIPLoader',
      'VAELoader',
      'LoadImage',
      'MiniMaxH3ImageToVideo',
      'RandomNoise',
      'BasicScheduler',
      'KSamplerSelect',
      'BasicGuider',
      'SamplerCustomAdvanced',
      'VAEDecode',
      'VAEDecodeAudio',
      'CreateVideo',
      'SaveVideo',
    ],
    requiredModelIds: ['minimax-h3-master-unet', 'minimax-h3-text-encoder', 'minimax-h3-video-vae', 'minimax-h3-audio-vae'],
    description: 'Unet int8 pruned (sem LoRA turbo), 25 steps, res_multistep, áudio estéreo. Único dos 5 workflows anexados que roda sem alteração na GPU real.',
  },
};

export function getWorkflow(id: string): WorkflowRegistryEntry {
  const entry = WORKFLOW_REGISTRY[id];
  if (!entry) throw new Error(`Workflow Registry: id desconhecido "${id}"`);
  return entry;
}

/** Um workflow só está disponível se TODOS os modelos que ele referencia estiverem enabled no Model Registry. */
export function isWorkflowAvailable(id: string): { available: boolean; reason?: string } {
  const workflow = getWorkflow(id);
  for (const modelId of workflow.requiredModelIds) {
    const model = MODEL_REGISTRY[modelId];
    if (!model) return { available: false, reason: `referencia model id desconhecido "${modelId}"` };
    if (!model.enabled) return { available: false, reason: `depende de "${modelId}" (${model.file}), que está desabilitado: ${model.disabledReason}` };
  }
  return { available: true };
}
