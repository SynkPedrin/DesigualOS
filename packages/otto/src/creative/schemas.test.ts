import { describe, expect, it } from 'vitest';
import {
  carouselPlanSchema,
  creativePlanSchema,
  productionSpecSchema,
  videoPlanSchema,
} from './schemas.js';

const validPlan = {
  client: 'Colpar',
  objective: 'Lançar a nova linha de pisos vinílicos',
  audience: 'Arquitetos e especificadores de obra',
  strategy: 'Prova visual de durabilidade em ambiente real de obra',
  concept: 'O piso que sobrevive ao canteiro',
  narrative: 'Do canteiro sujo ao showroom impecável, o mesmo piso',
  copy: 'Feito pra obra, pensado pro showroom.',
  art_direction: {
    composition: 'Regra dos terços com piso em diagonal guiando o olhar',
    typography: 'Space Grotesk 500, caixa mista, tracking apertado',
    color: 'Terrosos de obra (ocre, cimento) com acento cobre',
    lighting: 'Luz dura de fim de tarde entrando pela vão sem esquadria',
    photography: 'Lente 35mm, f/4, perspectiva baixa de quem está no canteiro',
    materials: 'Concreto aparente, poeira de obra, vinílico texturizado',
    atmosphere: 'Bruto mas preciso, orgulho de obra bem entregue',
  },
  references: ['editorial de obra da revista AU'],
  image_prompt: 'construction site at golden hour, vinyl flooring detail...',
  negative_prompt: 'blurry, stock photo look, oversaturated',
  technical_specs: '1080x1350, sRGB, grão fino de filme',
  production_requirements: 'Aprovação do marketing do cliente antes de gerar variações',
  quality_criteria: [
    { criterion: 'coerência de marca', description: 'Paleta terrosa do brand kit', weight: 1 },
  ],
  delivery_format: 'PNG 1080x1350 + legenda',
};

describe('creativePlanSchema', () => {
  it('aceita plano válido completo', () => {
    const result = creativePlanSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
  });

  it('rejeita plano sem direção de arte completa', () => {
    const broken = structuredClone(validPlan) as Record<string, unknown>;
    broken.art_direction = { composition: 'x' };
    expect(creativePlanSchema.safeParse(broken).success).toBe(false);
  });

  it('rejeita plano sem quality_criteria', () => {
    const broken = { ...validPlan, quality_criteria: [] };
    expect(creativePlanSchema.safeParse(broken).success).toBe(false);
  });
});

describe('carouselPlanSchema', () => {
  const slide = (index: number, narrativeFunction: string) => ({
    index,
    narrative_function: narrativeFunction,
    objective: 'Prender atenção',
    copy: 'Texto do card',
    visual: 'Frame do filme',
    composition: 'Texto na base',
    layout: 'capa',
    image_prompt: 'cinematic still, warm light',
  });

  it('aceita carrossel canônico (10 slides, hook -> cta)', () => {
    const slides = [
      slide(1, 'hook'),
      ...Array.from({ length: 8 }, (_, i) => slide(i + 2, 'development')),
      slide(10, 'cta'),
    ];
    const result = carouselPlanSchema.safeParse({ concept: 'X', slide_count: 10, slides });
    expect(result.success).toBe(true);
  });

  it('rejeita carrossel fora da faixa canônica 10-16', () => {
    const slides = [slide(1, 'hook')];
    expect(carouselPlanSchema.safeParse({ concept: 'X', slide_count: 5, slides }).success).toBe(false);
  });

  it('rejeita narrative_function fora do enum', () => {
    const slides = [slide(1, 'abertura')];
    expect(
      carouselPlanSchema.safeParse({ concept: 'X', slide_count: 10, slides }).success,
    ).toBe(false);
  });
});

describe('videoPlanSchema', () => {
  it('aceita plano de vídeo com cenas completas', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'Obra viva',
      duration: 15,
      aspect_ratio: '9:16',
      scenes: [
        {
          camera_movement: 'dolly in lento',
          subject_movement: 'pedreiro assentando piso',
          environment: 'canteiro ao entardecer',
          lighting: 'golden hour lateral',
          transition: 'match cut no encaixe da régua',
          pacing: 'respirado, 3s por cena',
        },
      ],
      sound_direction: 'som diegético de obra + batida minimalista',
      text_overlays: ['Feito pra obra.'],
      cta: 'Salva pra mostrar pro seu arquiteto',
      generation_prompts: ['construction site golden hour, dolly in'],
    });
    expect(result.success).toBe(true);
  });

  it('rejeita plano sem cenas', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'X',
      duration: 15,
      aspect_ratio: '9:16',
      scenes: [],
      sound_direction: 'x',
      cta: 'x',
      generation_prompts: ['x'],
    });
    expect(result.success).toBe(false);
  });
});

describe('productionSpecSchema', () => {
  it('aceita spec mínima compatível com a fila studio-jobs', () => {
    const result = productionSpecSchema.safeParse({
      job_type: 'image',
      client_id: 'colpar-id',
      prompt: 'detailed prompt',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita job_type fora dos aceitos pela fila', () => {
    expect(
      productionSpecSchema.safeParse({
        job_type: 'animacao',
        client_id: 'x',
        prompt: 'x',
      }).success,
    ).toBe(false);
  });
});
