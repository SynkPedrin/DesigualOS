import { describe, expect, it } from 'vitest';
import { buildReferencePromptDirective, resolveReferencePlan } from './reference-plan';

describe('resolveReferencePlan', () => {
  it('uses the first generic image as scene and subsequent one as style', () => {
    const plan = resolveReferencePlan({
      attachments: [
        { url: 'https://example.com/a.jpg', filename: 'a.jpg', contentType: 'image/jpeg' },
        { url: 'https://example.com/b.jpg', filename: 'b.jpg', contentType: 'image/jpeg' },
      ],
    });
    expect(plan.modelReferences.map((asset) => asset.role)).toEqual(['scene', 'style']);
  });

  it('keeps a canvas logo out of diffusion and marks it for exact composition', () => {
    const plan = resolveReferencePlan({
      attachments: [
        { url: 'https://example.com/place.jpg', filename: 'local.jpg', contentType: 'image/jpeg' },
        { url: 'https://example.com/logo.png', filename: 'logo-cliente.png', contentType: 'image/png' },
      ],
      prompt: 'adicione a marca no canto da imagem',
    });
    expect(plan.canvasLogo?.url).toBe('https://example.com/logo.png');
    expect(plan.canvasLogo?.placement).toBe('canvas_bottom_right');
    expect(plan.modelReferences).toHaveLength(1);
  });

  it('keeps an in-scene logo as a FLUX.2 reference', () => {
    const plan = resolveReferencePlan({
      attachments: [
        { url: 'https://example.com/logo.png', filename: 'logo.png', contentType: 'image/png' },
      ],
      prompt: 'aplique a logo na embalagem do produto',
    });
    expect(plan.canvasLogo).toBeUndefined();
    expect(plan.modelReferences[0]?.placement).toBe('in_scene');
  });

  it('honors the explicit Otto plan over filename inference', () => {
    const plan = resolveReferencePlan({
      attachments: [{ url: 'https://example.com/x.png', filename: 'x.png', contentType: 'image/png' }],
      spec: {
        referencePlan: {
          assets: [{
            url: 'https://example.com/x.png', filename: 'x.png', contentType: 'image/png', role: 'product', fidelity: 'exact',
          }],
        },
      },
    });
    expect(plan.modelReferences[0]?.role).toBe('product');
    expect(plan.modelReferences[0]?.fidelity).toBe('exact');
  });
});

describe('buildReferencePromptDirective', () => {
  it('names every image by the same 1-based order used by ReferenceLatent', () => {
    const plan = resolveReferencePlan({
      attachments: [
        { url: 'https://example.com/a.jpg', filename: 'local.jpg', contentType: 'image/jpeg' },
        { url: 'https://example.com/b.jpg', filename: 'produto.jpg', contentType: 'image/jpeg' },
      ],
    });
    const prompt = buildReferencePromptDirective(plan.modelReferences);
    expect(prompt).toContain('Reference Image 1 (scene)');
    expect(prompt).toContain('Reference Image 2 (product)');
  });
});
