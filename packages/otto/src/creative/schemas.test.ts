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

  /**
   * REGRESSÃO REAL: baseline ao vivo (22/09/2026, Otto Elite Phase 2) —
   * qwen3.5:4b mandou "references": "nenhuma" (string) em vez de [], e como
   * chatJson só corrige uma vez, isso derrubava o turno inteiro por um campo
   * que, sem referência de verdade, é só uma lista vazia.
   */
  it('tolera references vindo como string (nenhuma/none/vazio vira lista vazia, texto real vira item único)', () => {
    const semReferencia = creativePlanSchema.safeParse({ ...validPlan, references: 'nenhuma' });
    expect(semReferencia.success).toBe(true);
    if (semReferencia.success) expect(semReferencia.data.references).toEqual([]);

    const stringVazia = creativePlanSchema.safeParse({ ...validPlan, references: '' });
    expect(stringVazia.success).toBe(true);
    if (stringVazia.success) expect(stringVazia.data.references).toEqual([]);

    const referenciaReal = creativePlanSchema.safeParse({ ...validPlan, references: 'campanha anterior do cliente' });
    expect(referenciaReal.success).toBe(true);
    if (referenciaReal.success) expect(referenciaReal.data.references).toEqual(['campanha anterior do cliente']);
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

  /**
   * REGRESSÃO REAL: baseline ao vivo contra qwen3.5:4b (22/09/2026, Otto
   * Elite Phase 2) — o modelo manda spoken_line/on_screen_text/continuity/
   * image_prompt como "" em cenas onde não se aplica, em vez de omitir a
   * chave. Antes deste fix isso derrubava o turno inteiro (chatJson só
   * corrige uma vez): "" tinha que valer como ausente, não como presente e
   * inválido.
   */
  it('trata string vazia como ausente em campos opcionais (spoken_line, on_screen_text, continuity, image_prompt)', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'Abertura sem fila',
      duration: 10,
      aspect_ratio: '9:16',
      scenes: [
        {
          camera_movement: 'estático',
          subject_movement: 'corretor caminha até a fachada',
          environment: 'stand de vendas',
          lighting: 'luz natural',
          transition: 'corte seco',
          pacing: 'direto',
          duration_seconds: 5,
          spoken_line: 'Dia 24 de setembro abre a venda.',
          on_screen_text: '',
          continuity: '',
          image_prompt: '',
        },
        {
          camera_movement: 'estático',
          subject_movement: 'atendente recebe visitante',
          environment: 'recepção',
          lighting: 'luz interna',
          transition: 'corte seco',
          pacing: 'direto',
          duration_seconds: 5,
          spoken_line: '',
          on_screen_text: 'Sem cadastro',
        },
      ],
      sound_direction: 'trilha leve',
      text_overlays: [],
      cta: 'Garanta seu horário',
      generation_prompts: ['sales stand facade', 'reception desk'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.scenes[0]!.spoken_line).toBe('Dia 24 de setembro abre a venda.');
    expect(result.data.scenes[0]!.on_screen_text).toBeUndefined();
    expect(result.data.scenes[1]!.spoken_line).toBeUndefined();
    expect(result.data.scenes[1]!.on_screen_text).toBe('Sem cadastro');
  });

  /**
   * REGRESSÃO REAL: mesma sessão de baseline — qwen3.5:4b consistentemente
   * erra a soma exata dos takes por 1-2s mesmo com cada duration_seconds
   * plausível, e a validação antiga REJEITAVA o plano inteiro por isso.
   * `duration` agora é derivada da soma, não cobrada do modelo.
   */
  it('deriva duration da soma dos takes em vez de exigir que o modelo acerte a soma', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'Abertura sem fila',
      duration: 8, // o modelo "chutou" 8; a soma real das cenas é 10
      aspect_ratio: '9:16',
      scenes: [
        {
          camera_movement: 'estático', subject_movement: 'a', environment: 'b', lighting: 'c',
          transition: 'd', pacing: 'e', duration_seconds: 5,
        },
        {
          camera_movement: 'estático', subject_movement: 'a', environment: 'b', lighting: 'c',
          transition: 'd', pacing: 'e', duration_seconds: 5,
        },
      ],
      sound_direction: 'trilha leve',
      text_overlays: [],
      cta: 'Garanta seu horário',
      generation_prompts: ['a', 'b'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.duration).toBe(10);
  });

  /**
   * REGRESSÃO REAL: validação ao vivo do caso Cosentino (Otto Senior V1.0
   * closure) — o modelo mandou uma cena com duration_seconds=6 (fora do
   * range [1,5]), a correção única do chatJson não resolveu, e o turno
   * inteiro morreu depois de ~293s por um valor de TIMING interno. Regra
   * 25-26 do brief de fechamento: ruído representacional inofensivo
   * (número finito fora do range) é normalizado (clampado), não descartado.
   */
  it('clampa duration_seconds fora de [1,5] em vez de rejeitar o plano inteiro', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'Abertura sem fila',
      duration: 11,
      aspect_ratio: '9:16',
      scenes: [
        { camera_movement: 'a', subject_movement: 'a', environment: 'a', lighting: 'a', transition: 'a', pacing: 'a', duration_seconds: 6 },
        { camera_movement: 'b', subject_movement: 'b', environment: 'b', lighting: 'b', transition: 'b', pacing: 'b', duration_seconds: 0.2 },
      ],
      sound_direction: 'trilha leve',
      text_overlays: [],
      cta: 'Garanta seu horário',
      generation_prompts: ['a', 'b'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.scenes[0]!.duration_seconds).toBe(5); // 6 clampado pro teto
    expect(result.data.scenes[1]!.duration_seconds).toBe(1); // 0.2 clampado pro piso
    expect(result.data.duration).toBe(6); // duration derivada da SOMA JÁ CLAMPADA (5+1)
  });

  it('valor não numérico continua sendo erro de verdade (não é ruído de representação)', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'X',
      duration: 5,
      aspect_ratio: '9:16',
      scenes: [
        { camera_movement: 'a', subject_movement: 'a', environment: 'a', lighting: 'a', transition: 'a', pacing: 'a', duration_seconds: 'muito' as unknown as number },
      ],
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
