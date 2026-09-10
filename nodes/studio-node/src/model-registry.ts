/**
 * Registro central de modelos do ComfyUI do Studio.
 *
 * Toda entrada com `enabled: true` foi confirmada de verdade contra a GPU de
 * produção (RTX 4090, ComfyUI 0.33.4, 100.107.198.50:8188) via
 * GET /object_info em 08/09/2026 - ver `validatedAt`. Entradas `enabled:
 * false` documentam modelos que os workflows de referência (docs internas)
 * assumem mas que NÃO estão instalados nessa máquina hoje; existem aqui pra
 * não se perder o mapeamento quando alguém instalar o arquivo, não como
 * promessa de que funcionam agora.
 *
 * Por quê isto existe: `flux1-dev.safetensors` e
 * `flux1-dev-kontext_fp8_scaled.safetensors` são arquivos DIFERENTES com
 * papéis diferentes (geração vs edição por instrução) e é fácil confundir os
 * dois num nome solto espalhado pelo código. Centralizar aqui é o que evita
 * isso.
 */

export type ModelFamily = 'flux2' | 'flux1' | 'minimax-h3' | 'upscale';
export type ModelRole = 'diffusion' | 'text_encoder' | 'vae' | 'lora' | 'upscale_model';
export type ModelCapability = 'text_to_image' | 'image_to_image' | 'edit' | 'image_to_video' | 'upscale';

export interface ModelRegistryEntry {
  /** Id interno estável, usado em WORKFLOW_REGISTRY e nos jobs persistidos. Nunca reaproveitar um id pra outro arquivo. */
  id: string;
  family: ModelFamily;
  role: ModelRole;
  /** class_type do loader do ComfyUI que carrega este arquivo. */
  loader: 'UNETLoader' | 'CLIPLoader' | 'DualCLIPLoader' | 'VAELoader' | 'UnetLoaderGGUF' | 'LoraLoaderModelOnly' | 'UpscaleModelLoader';
  /** Nome exato do arquivo, como aparece na lista de opções do loader no ComfyUI. */
  file: string;
  /** Segundo arquivo, só pra DualCLIPLoader (clip_name2). */
  file2?: string;
  dtype?: string;
  capabilities: ModelCapability[];
  /** Workflows do WORKFLOW_REGISTRY que usam este modelo. */
  compatibleWorkflows: string[];
  vramProfile: 'low' | 'medium' | 'high';
  version: string;
  enabled: boolean;
  /** Quando `enabled` foi confirmado (ou desconfirmado) contra o /object_info real. null = nunca verificado ao vivo. */
  validatedAt: string | null;
  /** Só preenchido quando enabled=false: por que não está disponível e o que falta pra habilitar. */
  disabledReason?: string;
}

export const MODEL_REGISTRY: Record<string, ModelRegistryEntry> = {
  'flux2-dev-unet': {
    id: 'flux2-dev-unet',
    family: 'flux2',
    role: 'diffusion',
    loader: 'UNETLoader',
    file: 'flux2_dev_fp8mixed.safetensors',
    dtype: 'default',
    capabilities: ['text_to_image', 'image_to_image', 'edit'],
    compatibleWorkflows: ['t2i_flux2_editorial_v1', 'i2i_flux2_reference_v1', 't2i_flux2_native_v2', 'edit_flux2_multireference_v2'],
    vramProfile: 'high',
    version: 'flux2-dev-fp8mixed',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'flux2-text-encoder': {
    id: 'flux2-text-encoder',
    family: 'flux2',
    role: 'text_encoder',
    loader: 'CLIPLoader',
    file: 'mistral_3_small_flux2_bf16.safetensors',
    capabilities: ['text_to_image', 'image_to_image', 'edit'],
    compatibleWorkflows: ['t2i_flux2_editorial_v1', 'i2i_flux2_reference_v1', 't2i_flux2_native_v2', 'edit_flux2_multireference_v2'],
    vramProfile: 'medium',
    version: 'mistral_3_small_flux2_bf16',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'flux2-vae': {
    id: 'flux2-vae',
    family: 'flux2',
    role: 'vae',
    loader: 'VAELoader',
    file: 'flux2-vae.safetensors',
    capabilities: ['text_to_image', 'image_to_image', 'edit'],
    compatibleWorkflows: ['t2i_flux2_editorial_v1', 'i2i_flux2_reference_v1', 't2i_flux2_native_v2', 'edit_flux2_multireference_v2'],
    vramProfile: 'low',
    version: 'flux2-vae',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'minimax-h3-master-unet': {
    id: 'minimax-h3-master-unet',
    family: 'minimax-h3',
    role: 'diffusion',
    loader: 'UNETLoader',
    file: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    dtype: 'default',
    capabilities: ['image_to_video'],
    compatibleWorkflows: ['i2v_minimax_h3_master_v1'],
    vramProfile: 'high',
    version: 'minimax_h3_fl2va_pruned_int8_convrot',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'minimax-h3-draft-unet-gguf': {
    id: 'minimax-h3-draft-unet-gguf',
    family: 'minimax-h3',
    role: 'diffusion',
    loader: 'UnetLoaderGGUF',
    file: 'MiniMax-H3-FL2VA-Q3_K_M.gguf',
    capabilities: ['image_to_video'],
    compatibleWorkflows: ['i2v_minimax_h3_draft_v1'],
    vramProfile: 'medium',
    version: 'minimax_h3_fl2va_q3_k_m',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'minimax-h3-turbo-lora': {
    id: 'minimax-h3-turbo-lora',
    family: 'minimax-h3',
    role: 'lora',
    loader: 'LoraLoaderModelOnly',
    file: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
    capabilities: ['image_to_video'],
    compatibleWorkflows: ['i2v_minimax_h3_draft_v1'],
    vramProfile: 'low',
    version: 'turbo_8step_v1.0',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'minimax-h3-text-encoder': {
    id: 'minimax-h3-text-encoder',
    family: 'minimax-h3',
    role: 'text_encoder',
    loader: 'CLIPLoader',
    file: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    capabilities: ['image_to_video'],
    compatibleWorkflows: ['i2v_minimax_h3_master_v1', 'i2v_minimax_h3_draft_v1'],
    vramProfile: 'medium',
    version: 'qwen3vl_32b_nvfp4_awq',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'minimax-h3-video-vae': {
    id: 'minimax-h3-video-vae',
    family: 'minimax-h3',
    role: 'vae',
    loader: 'VAELoader',
    file: 'minimax_h3_video_vae_fp16.safetensors',
    capabilities: ['image_to_video'],
    compatibleWorkflows: ['i2v_minimax_h3_master_v1', 'i2v_minimax_h3_draft_v1'],
    vramProfile: 'low',
    version: 'video_vae_fp16',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'minimax-h3-audio-vae': {
    id: 'minimax-h3-audio-vae',
    family: 'minimax-h3',
    role: 'vae',
    loader: 'VAELoader',
    file: 'minimax_h3_audio_vae_fp32.safetensors',
    capabilities: ['image_to_video'],
    compatibleWorkflows: ['i2v_minimax_h3_master_v1', 'i2v_minimax_h3_draft_v1'],
    vramProfile: 'low',
    version: 'audio_vae_fp32',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'upscale-realesrgan-x4': {
    id: 'upscale-realesrgan-x4',
    family: 'upscale',
    role: 'upscale_model',
    loader: 'UpscaleModelLoader',
    file: 'RealESRGAN_x4.pth',
    capabilities: ['upscale'],
    compatibleWorkflows: ['finish_fast_v1', 'finish_restore_v1'],
    vramProfile: 'low',
    version: 'realesrgan_x4',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },
  'upscale-ultrasharp-4x': {
    id: 'upscale-ultrasharp-4x',
    family: 'upscale',
    role: 'upscale_model',
    loader: 'UpscaleModelLoader',
    file: '4x-UltraSharp.pth',
    capabilities: ['upscale'],
    compatibleWorkflows: ['finish_restore_v1'],
    vramProfile: 'low',
    version: 'ultrasharp_4x',
    enabled: true,
    validatedAt: '2026-09-08T00:00:00Z',
  },

  // ---- Não instalados na GPU hoje (08/09/2026). Mantidos como referência
  // do que os workflows originais em docs/ assumem, e como alvo se alguém
  // decidir instalar. NÃO usar em produção enquanto enabled=false.
  'flux1-dev-unet': {
    id: 'flux1-dev-unet',
    family: 'flux1',
    role: 'diffusion',
    loader: 'UNETLoader',
    file: 'flux1-dev.safetensors',
    dtype: 'fp8_e4m3fn_fast',
    capabilities: ['text_to_image', 'image_to_image'],
    compatibleWorkflows: [],
    vramProfile: 'high',
    version: 'flux1-dev',
    enabled: false,
    validatedAt: '2026-09-08T00:00:00Z',
    disabledReason:
      'UNETLoader.unet_name na GPU real só lista flux2_dev_fp8mixed.safetensors e os dois unets do MiniMax H3 (checado ao vivo em 08/09/2026). flux1-dev.safetensors não está instalado.',
  },
  'flux1-dev-t5-clip': {
    id: 'flux1-dev-t5-clip',
    family: 'flux1',
    role: 'text_encoder',
    loader: 'DualCLIPLoader',
    file: 't5xxl_fp16.safetensors',
    file2: 'clip_l.safetensors',
    capabilities: ['text_to_image', 'image_to_image'],
    compatibleWorkflows: [],
    vramProfile: 'medium',
    version: 't5xxl_fp16+clip_l',
    enabled: false,
    validatedAt: '2026-09-08T00:00:00Z',
    disabledReason:
      'DualCLIPLoader.clip_name1/2 na GPU real só lista mistral_3_small_flux2_bf16.safetensors e qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors - nem t5xxl_fp16 nem clip_l existem no models/text_encoders instalado.',
  },
  'flux1-dev-kontext-unet': {
    id: 'flux1-dev-kontext-unet',
    family: 'flux1',
    role: 'diffusion',
    loader: 'UNETLoader',
    file: 'flux1-dev-kontext_fp8_scaled.safetensors',
    dtype: 'default',
    capabilities: ['edit'],
    compatibleWorkflows: [],
    vramProfile: 'high',
    version: 'flux1-dev-kontext-fp8-scaled',
    enabled: false,
    validatedAt: '2026-09-08T00:00:00Z',
    disabledReason:
      'Não instalado (confirmado contra UNETLoader.unet_name real). Não existe hoje nenhum modelo de edição por instrução (Kontext-like) compatível com FLUX.2 instalado nessa GPU, então a capability "edit" fica sem workflow disponível até isso mudar.',
  },
  'upscale-clearreality-v1': {
    id: 'upscale-clearreality-v1',
    family: 'upscale',
    role: 'upscale_model',
    loader: 'UpscaleModelLoader',
    file: '4x-ClearRealityV1.pth',
    capabilities: ['upscale'],
    compatibleWorkflows: [],
    vramProfile: 'low',
    version: 'clearreality_v1',
    enabled: false,
    validatedAt: '2026-09-08T00:00:00Z',
    disabledReason:
      'Não está em UpscaleModelLoader.model_name na GPU real (opções confirmadas: 4x-AnimeSharp, 4x-UltraSharp, 4x_NMKD-Siax_200k, 4x_foolhardy_Remacri, 8x_NMKD-Faces_160000_G, 8x_NMKD-Superscale_150000_G, ESRGAN_4x, RealESRGAN_x2, RealESRGAN_x4, ldsr/last.ckpt).',
  },
};

export function getModel(id: string): ModelRegistryEntry {
  const entry = MODEL_REGISTRY[id];
  if (!entry) throw new Error(`Model Registry: id desconhecido "${id}"`);
  return entry;
}

export function requireEnabledModel(id: string): ModelRegistryEntry {
  const entry = getModel(id);
  if (!entry.enabled) {
    throw new Error(
      `Model Registry: "${id}" (${entry.file}) está desabilitado - ${entry.disabledReason ?? 'motivo não registrado'}`,
    );
  }
  return entry;
}
