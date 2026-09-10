import { describe, it, expect } from 'vitest';
import { deriveCreativeSpec, detectEditIntent } from './creative-spec';

describe('deriveCreativeSpec (fallback para jobs sem CreativeSpec)', () => {
  it('infers generate/text_to_image for a plain image job with no reference', () => {
    const spec = deriveCreativeSpec({ type: 'image', prompt: 'a cat', style: 'padrao', qualityPreset: 'standard', referenceImages: [], metadata: {} });
    expect(spec.operation).toBe('generate');
    expect(spec.contentType).toBe('image');
  });

  it('infers variation for a job with reference images', () => {
    const spec = deriveCreativeSpec({ type: 'image', prompt: 'a cat', style: 'padrao', qualityPreset: 'standard', referenceImages: ['url1'], metadata: {} });
    expect(spec.operation).toBe('variation');
  });

  it('infers animate for video/reels', () => {
    expect(deriveCreativeSpec({ type: 'video', prompt: null, style: 'padrao', qualityPreset: null, referenceImages: [], metadata: {} }).operation).toBe('animate');
    expect(deriveCreativeSpec({ type: 'reels', prompt: null, style: 'padrao', qualityPreset: null, referenceImages: [], metadata: {} }).contentType).toBe('reel');
  });

  it('maps quality_preset high to qualityProfile master, draft to draft, everything else to standard', () => {
    expect(deriveCreativeSpec({ type: 'image', prompt: null, style: 'padrao', qualityPreset: 'high', referenceImages: [], metadata: {} }).qualityProfile).toBe('master');
    expect(deriveCreativeSpec({ type: 'image', prompt: null, style: 'padrao', qualityPreset: 'draft', referenceImages: [], metadata: {} }).qualityProfile).toBe('draft');
    expect(deriveCreativeSpec({ type: 'image', prompt: null, style: 'padrao', qualityPreset: 'standard', referenceImages: [], metadata: {} }).qualityProfile).toBe('standard');
  });

  it('an explicit creative_spec in metadata wins over inferred fields', () => {
    const spec = deriveCreativeSpec({
      type: 'image',
      prompt: 'a cat',
      style: 'padrao',
      qualityPreset: 'standard',
      referenceImages: [],
      metadata: { creative_spec: { operation: 'edit', qualityProfile: 'master' } },
    });
    expect(spec.operation).toBe('edit');
    expect(spec.qualityProfile).toBe('master');
  });

  it('does not set artDirection for the default style', () => {
    const spec = deriveCreativeSpec({ type: 'image', prompt: null, style: 'padrao', qualityPreset: 'standard', referenceImages: [], metadata: {} });
    expect(spec.artDirection).toBeUndefined();
  });

  it('carries a non-default style into artDirection.style', () => {
    const spec = deriveCreativeSpec({ type: 'image', prompt: null, style: 'cinematico', qualityPreset: 'standard', referenceImages: [], metadata: {} });
    expect(spec.artDirection?.style).toEqual(['cinematico']);
  });
});

describe('detectEditIntent (edição localizada)', () => {
  it('detects "troque só a cor"', () => {
    expect(detectEditIntent('troque só a cor do carro para azul')).toBe(true);
  });

  it('detects "mantenha exatamente"', () => {
    expect(detectEditIntent('mantenha exatamente o rosto e o fundo')).toBe(true);
  });

  it('detects "preserve"', () => {
    expect(detectEditIntent('preserve a composição, só troque o céu')).toBe(true);
  });

  it('does not flag an unrelated prompt', () => {
    expect(detectEditIntent('um elefante numa praia ao pôr do sol')).toBe(false);
  });

  it('handles null/undefined without throwing', () => {
    expect(detectEditIntent(null)).toBe(false);
    expect(detectEditIntent(undefined)).toBe(false);
  });
});
