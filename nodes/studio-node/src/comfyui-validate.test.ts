import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateComfyUIInstallation } from './comfyui-validate';

describe('validateComfyUIInstallation (item 38: node ausente falha antes de entrar na GPU)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockComfyUI(objectInfo: Record<string, unknown>) {
    global.fetch = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/system_stats')) {
        return new Response(JSON.stringify({ system: { comfyui_version: '0.33.4' } }), { status: 200 });
      }
      if (url.endsWith('/object_info')) {
        return new Response(JSON.stringify(objectInfo), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports ok=true when every required class_type and enabled model file is present', async () => {
    mockComfyUI({
      UNETLoader: {
        input: {
          required: {
            unet_name: [['flux2_dev_fp8mixed.safetensors', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors']],
            weight_dtype: [['default']],
          },
        },
      },
      CLIPLoader: { input: { required: { clip_name: [['mistral_3_small_flux2_bf16.safetensors', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors']] } } },
      VAELoader: { input: { required: { vae_name: [['flux2-vae.safetensors', 'minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']] } } },
      UnetLoaderGGUF: { input: { required: { unet_name: [['MiniMax-H3-FL2VA-Q3_K_M.gguf']] } } },
      LoraLoaderModelOnly: { input: { required: { lora_name: [['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors']] } } },
      UpscaleModelLoader: { input: { required: { model_name: [['4x-UltraSharp.pth', 'RealESRGAN_x4.pth']] } } },
      // Todos os outros class_types requeridos pelo registry "existem" com input vazio (só presença importa aqui).
      ...Object.fromEntries(
        [
          'CLIPTextEncode', 'ConditioningZeroOut', 'FluxGuidance', 'EmptyFlux2LatentImage', 'KSampler', 'LatentUpscaleBy', 'VAEDecode',
          'SaveImage', 'LoadImage', 'ImageScaleToTotalPixels', 'GetImageSize', 'VAEEncode', 'DualCLIPLoader', 'FluxKontextImageScale',
          'ReferenceLatent', 'UltimateSDUpscale', 'ImageScale', 'ImageSharpen', 'ImageAddNoise', 'ImageUpscaleWithModel', 'MiniMaxH3ImageToVideo',
          'RandomNoise', 'BasicScheduler', 'Flux2Scheduler', 'KSamplerSelect', 'BasicGuider', 'SamplerCustomAdvanced', 'VAEDecodeAudio', 'CreateVideo', 'SaveVideo',
        ].map((k) => [k, { input: { required: {} } }]),
      ),
    });

    const result = await validateComfyUIInstallation('http://fake-comfyui:8188');
    expect(result.ok).toBe(true);
    expect(result.missingClassTypes).toEqual([]);
    expect(result.missingModelFiles).toEqual([]);
  });

  it('flags a missing class_type (empty {} response, matching real UltimateSDUpscale/MiniMaxH3AddGuide behavior)', async () => {
    mockComfyUI({
      UNETLoader: { input: { required: { unet_name: [['flux2_dev_fp8mixed.safetensors', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors']] } } },
      CLIPLoader: { input: { required: { clip_name: [['mistral_3_small_flux2_bf16.safetensors', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors']] } } },
      VAELoader: { input: { required: { vae_name: [['flux2-vae.safetensors', 'minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']] } } },
      UnetLoaderGGUF: { input: { required: { unet_name: [['MiniMax-H3-FL2VA-Q3_K_M.gguf']] } } },
      LoraLoaderModelOnly: { input: { required: { lora_name: [['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors']] } } },
      UpscaleModelLoader: { input: { required: { model_name: [['4x-UltraSharp.pth', 'RealESRGAN_x4.pth']] } } },
      UltimateSDUpscale: {}, // instalado-mas-vazio = ausente, exatamente como observado na GPU real
    });

    const result = await validateComfyUIInstallation('http://fake-comfyui:8188');
    expect(result.ok).toBe(false);
    expect(result.missingClassTypes).toContain('UltimateSDUpscale');
  });

  it('flags a missing model file even when the loader class_type exists', async () => {
    mockComfyUI({
      UNETLoader: { input: { required: { unet_name: [['some-other-model.safetensors']] } } }, // flux2_dev_fp8mixed ausente
      CLIPLoader: { input: { required: { clip_name: [['mistral_3_small_flux2_bf16.safetensors']] } } },
      VAELoader: { input: { required: { vae_name: [['flux2-vae.safetensors', 'minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']] } } },
      UnetLoaderGGUF: { input: { required: { unet_name: [['MiniMax-H3-FL2VA-Q3_K_M.gguf']] } } },
      LoraLoaderModelOnly: { input: { required: { lora_name: [['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors']] } } },
      UpscaleModelLoader: { input: { required: { model_name: [['4x-UltraSharp.pth']] } } },
    });

    const result = await validateComfyUIInstallation('http://fake-comfyui:8188');
    expect(result.ok).toBe(false);
    expect(result.missingModelFiles.some((m) => m.modelId === 'flux2-dev-unet')).toBe(true);
  });
});
