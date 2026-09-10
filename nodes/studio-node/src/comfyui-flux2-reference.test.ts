import { describe, expect, it } from 'vitest';
import { buildFluxMultiReferenceGraph, buildFluxTextToImageGraph } from './comfyui-client';

describe('FLUX.2 native text-to-image graph', () => {
  it('uses the official scheduler and advanced sampler for the base pass', () => {
    const graph = buildFluxTextToImageGraph({
      unetName: 'flux2.safetensors',
      clipName: 'mistral.safetensors',
      vaeName: 'flux2-vae.safetensors',
      prompt: 'Commercial editorial photograph',
      seed: 42,
      filenamePrefix: 'test',
      base: { width: 1344, height: 896, steps: 24 },
      refine: null,
    });

    expect(graph.scheduler).toMatchObject({
      class_type: 'Flux2Scheduler',
      inputs: { steps: 24, width: 1344, height: 896 },
    });
    expect(graph.sample_base?.class_type).toBe('SamplerCustomAdvanced');
    expect(graph.guider?.class_type).toBe('BasicGuider');
    expect(graph.sample_base?.inputs.sigmas).toEqual(['scheduler', 0]);
    expect(Object.values(graph).some((node) => node.class_type === 'KSampler')).toBe(false);
  });

  it('keeps the conditional editorial refine only for master-style graphs', () => {
    const graph = buildFluxTextToImageGraph({
      unetName: 'u', clipName: 'c', vaeName: 'v', prompt: 'p', seed: 1, filenamePrefix: 'x',
      base: { width: 896, height: 1120, steps: 28 },
      refine: { width: 1088, height: 1360, steps: 12, denoise: 0.38 },
    });
    expect(graph.sample_base?.class_type).toBe('SamplerCustomAdvanced');
    expect(graph.sample_refine?.class_type).toBe('KSampler');
    expect(graph.neg?.class_type).toBe('ConditioningZeroOut');
  });
});

describe('FLUX.2 native multi-reference graph', () => {
  it('chains one ReferenceLatent per reference in order', () => {
    const graph = buildFluxMultiReferenceGraph({
      unetName: 'flux2.safetensors',
      clipName: 'mistral.safetensors',
      vaeName: 'flux2-vae.safetensors',
      prompt: 'Use Reference Image 1 as scene and Reference Image 2 as product.',
      seed: 42,
      filenamePrefix: 'test',
      referenceImageNames: ['scene.png', 'product.png'],
      steps: 24,
      width: 1344,
      height: 896,
      targetMegapixels: 1,
    });

    expect(graph.ref_1_condition?.class_type).toBe('ReferenceLatent');
    expect(graph.ref_1_fit?.inputs).toMatchObject({
      upscale_method: 'lanczos',
      megapixels: 1,
      resolution_steps: 1,
    });
    expect(graph.ref_2_condition?.inputs.conditioning).toEqual(['ref_1_condition', 0]);
    expect(graph.guider?.inputs.conditioning).toEqual(['ref_2_condition', 0]);
    expect(graph.sample?.class_type).toBe('SamplerCustomAdvanced');
    expect(graph.scheduler?.class_type).toBe('Flux2Scheduler');
    expect(graph.latent?.class_type).toBe('EmptyFlux2LatentImage');
  });

  it('caps native references at ten', () => {
    const graph = buildFluxMultiReferenceGraph({
      unetName: 'u', clipName: 'c', vaeName: 'v', prompt: 'p', seed: 1, filenamePrefix: 'x',
      referenceImageNames: Array.from({ length: 12 }, (_, index) => `${index}.png`),
      steps: 20, width: 1024, height: 1024, targetMegapixels: 1,
    });
    expect(Object.values(graph).filter((node) => node.class_type === 'ReferenceLatent')).toHaveLength(10);
  });
});
