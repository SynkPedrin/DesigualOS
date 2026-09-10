import { describe, expect, it } from 'vitest';
import { buildImagePrompt, buildProductionSpec, checkRealWorldFidelity } from './planner.js';
import type { CreativePlan } from './schemas.js';
import { creativePlanSchema, studioJobTypeSchema } from './schemas.js';

function makePlan(): CreativePlan {
  return creativePlanSchema.parse({
    client: 'Colpar',
    objective: 'Lançar a nova linha de pisos vinílicos',
    audience: 'Arquitetos e especificadores',
    strategy: 'Prova visual de durabilidade em ambiente real de obra',
    concept: 'O piso que sobrevive ao canteiro',
    narrative: 'Do canteiro sujo ao showroom impecável, o mesmo piso',
    copy: 'Feito pra obra, pensado pro showroom.',
    art_direction: {
      composition: 'Regra dos terços, piso em diagonal guiando o olhar',
      typography: 'Space Grotesk 500, caixa mista',
      color: 'Terrosos de obra com acento cobre',
      lighting: 'Luz dura de fim de tarde pelo vão sem esquadria',
      photography: 'Lente 35mm, f/4, perspectiva baixa de canteiro',
      materials: 'Concreto aparente, poeira de obra, vinílico texturizado',
      atmosphere: 'Bruto mas preciso',
    },
    references: [],
    image_prompt: 'construction site golden hour, vinyl flooring detail',
    negative_prompt: 'blurry, stock photo look',
    technical_specs: '1080x1350, sRGB',
    production_requirements: 'Aprovação do cliente antes das variações',
    quality_criteria: [
      { criterion: 'coerência de marca', description: 'Paleta terrosa', weight: 1 },
    ],
    delivery_format: 'PNG 1080x1350',
  });
}

describe('buildImagePrompt', () => {
  it('carrega a direção de arte inteira no prompt (nunca genérico)', () => {
    const prompt = buildImagePrompt(makePlan());
    expect(prompt).toContain('construction site golden hour');
    for (const expected of [
      'Regra dos terços',
      'Lente 35mm',
      'Luz dura de fim de tarde',
      'Concreto aparente',
      'Space Grotesk',
      '1080x1350',
    ]) {
      expect(prompt).toContain(expected);
    }
  });

  it('não é um prompt de uma linha genérico', () => {
    const prompt = buildImagePrompt(makePlan());
    // Prompt genérico é curto e sem cláusulas; o nosso tem no mínimo 8 decisões
    // de direção separadas por ponto.
    expect(prompt.split('. ').length).toBeGreaterThanOrEqual(8);
    expect(prompt.length).toBeGreaterThan(400);
  });
});

describe('buildProductionSpec', () => {
  it('produz spec compatível com o shape do StudioJobData', () => {
    const spec = buildProductionSpec(makePlan(), { clientId: 'colpar-uuid', jobType: 'image' });

    // Campos que a fila studio-jobs consome (packages/orchestrator/studio-queue.ts):
    // job_type dentro dos tipos aceitos, client_id presente, prompt final não vazio.
    expect(studioJobTypeSchema.safeParse(spec.job_type).success).toBe(true);
    expect(spec.client_id).toBe('colpar-uuid');
    expect(spec.prompt.length).toBeGreaterThan(0);
    expect(spec.negative_prompt).toBe('blurry, stock photo look');
    expect(spec.copy).toBe('Feito pra obra, pensado pro showroom.');
  });

  it('carrossel carrega slides na ordem', () => {
    const carouselPlan = {
      concept: 'X',
      slide_count: 10,
      slides: Array.from({ length: 10 }, (_, i) => ({
        index: i + 1,
        narrative_function: (i === 0 ? 'hook' : i === 9 ? 'cta' : 'development') as
          | 'hook'
          | 'development'
          | 'cta',
        objective: 'o',
        copy: `Card ${i + 1}`,
        visual: 'v',
        composition: 'c',
        layout: 'l',
        image_prompt: 'p',
      })),
    };
    const spec = buildProductionSpec(makePlan(), {
      clientId: 'c',
      jobType: 'carousel',
      carouselPlan,
    });
    expect(spec.slides).toHaveLength(10);
    expect(spec.slides?.[0]?.narrative_function).toBe('hook');
    expect(spec.slides?.[9]?.narrative_function).toBe('cta');
    expect(spec.metadata.carousel_plan).toEqual(carouselPlan);
  });

  it('preserva storyboard e duração no metadata enviado à fila', () => {
    const videoPlan = {
      concept: 'Editorial', duration: 3, aspect_ratio: '9:16',
      scenes: [{ duration_seconds: 3, image_prompt: 'product macro', camera_movement: 'slow dolly', subject_movement: 'still', environment: 'studio', lighting: 'side light', transition: 'cut', pacing: 'calm' }],
      sound_direction: 'ambient', text_overlays: [], cta: 'Conheça', generation_prompts: ['slow product reveal'],
    };
    const spec = buildProductionSpec(makePlan(), { clientId: 'c', jobType: 'reels', videoPlan, aspectRatio: videoPlan.aspect_ratio });
    expect(spec.metadata.video_plan).toEqual(videoPlan);
    expect(spec.aspect_ratio).toBe('9:16');
  });

  it('metadata carrega contexto do plano pra auditoria do job', () => {
    const spec = buildProductionSpec(makePlan(), { clientId: 'c' });
    expect(spec.metadata.objective).toBe('Lançar a nova linha de pisos vinílicos');
    expect(spec.metadata.concept).toBe('O piso que sobrevive ao canteiro');
  });

  it('propaga referências com papel semântico e CreativeSpec de fidelidade máxima', () => {
    const plan = makePlan();
    plan.reference_strategy = [
      {
        reference_index: 1,
        role: 'scene',
        fidelity: 'high',
        instruction: 'Keep the exact location, perspective and light direction.',
        placement: 'reference_only',
      },
      {
        reference_index: 2,
        role: 'product',
        fidelity: 'exact',
        instruction: 'Preserve the exact product geometry and materials.',
        placement: 'in_scene',
      },
    ];

    const spec = buildProductionSpec(plan, {
      clientId: 'c',
      referenceAssets: [
        { url: 'https://example.com/place.jpg', filename: 'place.jpg', contentType: 'image/jpeg' },
        { url: 'https://example.com/product.png', filename: 'product.png', contentType: 'image/png' },
      ],
    });

    expect(spec.reference_assets).toHaveLength(2);
    expect(spec.reference_assets[0]).toMatchObject({ role: 'scene', fidelity: 'high' });
    expect(spec.reference_assets[1]).toMatchObject({ role: 'product', fidelity: 'exact', placement: 'in_scene' });
    expect(spec.metadata.creative_spec).toMatchObject({
      operation: 'edit',
      qualityProfile: 'master',
      preservation: { background: true, perspective: true, product: true, materials: true },
      fidelity: { level: 'maximum', location: true, productGeometry: true, physicalLighting: true },
    });
  });

  it('marca logo de canvas para composição determinística, sem redesenho pelo modelo', () => {
    const plan = makePlan();
    plan.reference_strategy = [{
      reference_index: 1,
      role: 'logo',
      fidelity: 'exact',
      instruction: 'Use the supplied logo exactly.',
      placement: 'canvas_bottom_right',
    }];
    const logoUrl = 'https://example.com/logo.png';
    const spec = buildProductionSpec(plan, {
      clientId: 'c',
      referenceAssets: [{ url: logoUrl, filename: 'logo.png', contentType: 'image/png' }],
    });

    expect(spec.metadata.creative_spec).toMatchObject({
      preservation: { textAndLogos: true },
      brandComposition: {
        renderTextDeterministically: true,
        logo: { sourceUrl: logoUrl, placement: 'canvas_bottom_right' },
      },
    });
  });

  describe('gate de fidelidade real (produto/marca/pessoa/local reais sem referência)', () => {
    it('avisa quando o plano pede uma entidade real e não há referência fiel anexada', () => {
      const plan = makePlan();
      plan.real_world_fidelity = {
        requires_reference: true,
        entity_type: 'machine',
        entity_description: 'o trator modelo X da marca Y do cliente',
      };
      const spec = buildProductionSpec(plan, { clientId: 'c' });
      expect(spec.metadata.fidelity_warning).toContain('o trator modelo X da marca Y do cliente');
    });

    it('não avisa quando uma referência exact/high já cobre a entidade real', () => {
      const plan = makePlan();
      plan.real_world_fidelity = { requires_reference: true, entity_type: 'product' };
      plan.reference_strategy = [{
        reference_index: 1,
        role: 'product',
        fidelity: 'exact',
        instruction: 'Preserve the exact product geometry and materials.',
        placement: 'in_scene',
      }];
      const spec = buildProductionSpec(plan, {
        clientId: 'c',
        referenceAssets: [{ url: 'https://example.com/product.png', filename: 'product.png', contentType: 'image/png' }],
      });
      expect(spec.metadata.fidelity_warning).toBeUndefined();
    });

    it('não avisa quando o briefing não pede fidelidade a uma entidade real', () => {
      const spec = buildProductionSpec(makePlan(), { clientId: 'c' });
      expect(spec.metadata.fidelity_warning).toBeUndefined();
    });

    it('checkRealWorldFidelity ignora referência de fidelidade interpretive', () => {
      const plan = makePlan();
      plan.real_world_fidelity = { requires_reference: true, entity_type: 'location' };
      const warning = checkRealWorldFidelity(plan, [
        { url: 'https://example.com/x.png', filename: 'x.png', contentType: 'image/png', fidelity: 'interpretive' },
      ]);
      expect(warning).not.toBeNull();
    });
  });
});
