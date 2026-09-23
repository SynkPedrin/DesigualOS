import { describe, expect, it } from 'vitest';
import {
  carouselPlanSchema,
  creativePlanSchema,
  criticFlagsSchema,
  productionSpecSchema,
  realWorldFidelitySchema,
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
   * REGRESSÃO REAL: validação ao vivo do caso Cosentino (Otto Senior 20Y) —
   * delivery_format sumiu inteiro do JSON de REWRITE #1 e derrubou o turno
   * inteiro. TYPE A (Missão 2): o campo é derivável de jobType+aspect_ratio,
   * que o código já sabe — não devia ser exigido do modelo.
   */
  it('delivery_format é opcional: plano sem o campo continua válido', () => {
    const semDeliveryFormat = { ...validPlan } as Record<string, unknown>;
    delete semDeliveryFormat.delivery_format;
    const result = creativePlanSchema.safeParse(semDeliveryFormat);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delivery_format).toBeUndefined();
  });

  it('delivery_format vazio ("") também é tratado como ausente, não erro', () => {
    const result = creativePlanSchema.safeParse({ ...validPlan, delivery_format: '' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delivery_format).toBeUndefined();
  });

  /**
   * REGRESSÃO REAL (Otto Elite, Blocker 2): validação ao vivo do caso
   * Cosentino — REWRITE #1 quebrou com `reference_strategy: Expected array,
   * received string`, derrubando o turno inteiro mesmo com um draft válido
   * de 87/100 em mãos. reference_strategy é metadado de produção OPCIONAL
   * (decide o papel de cada referência anexada; nunca aparece no texto que
   * o usuário lê) — um valor malformado degrada pra [] em vez de fabricar
   * um objeto falso ou derrubar o parse inteiro.
   */
  it('reference_strategy como string solta (malformado) degrada pra lista vazia, não derruba o parse (Blocker 2)', () => {
    const result = creativePlanSchema.safeParse({ ...validPlan, reference_strategy: 'uma referência de produto' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reference_strategy).toEqual([]);
  });

  it('reference_strategy ausente continua vazio por padrão (comportamento anterior preservado)', () => {
    const semReferenceStrategy = { ...validPlan } as Record<string, unknown>;
    delete semReferenceStrategy.reference_strategy;
    const result = creativePlanSchema.safeParse(semReferenceStrategy);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reference_strategy).toEqual([]);
  });

  it('reference_strategy com array de objetos válidos continua funcionando normalmente', () => {
    const comReferenceStrategy = {
      ...validPlan,
      reference_strategy: [
        { reference_index: 1, role: 'product', fidelity: 'exact', instruction: 'Preserve product geometry.', placement: 'in_scene' },
      ],
    };
    const result = creativePlanSchema.safeParse(comReferenceStrategy);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reference_strategy).toHaveLength(1);
  });

  /**
   * REGRESSÃO REAL: a MESMA validação ao vivo também reprovou por
   * real_world_fidelity.entity_type recebendo "" em vez de omitido —
   * mesma classe do bug de spoken_line/on_screen_text (Fase 1), agora
   * confirmada num campo enum, não só string.
   */
  it('real_world_fidelity.entity_type: "" é tratado como ausente', () => {
    const result = realWorldFidelitySchema.safeParse({ requires_reference: true, entity_type: '', entity_description: 'a fachada real' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.entity_type).toBeUndefined();
  });

  /**
   * REGRESSÃO REAL: segunda validação ao vivo do caso Cosentino (Otto
   * Senior 20Y, após os fixes de Missão 1-7) — desta vez o modelo mandou
   * `null` explícito em vez de "", e o fix anterior (só tratava "") não
   * cobria essa forma. Mesma classe (Missão 19: fix classes, não
   * instâncias) — agora `null` também conta como ausente.
   */
  it('real_world_fidelity.entity_type: null é tratado como ausente (mesma classe do bug de "", forma diferente)', () => {
    const result = realWorldFidelitySchema.safeParse({ requires_reference: true, entity_type: null, entity_description: 'a fachada real' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.entity_type).toBeUndefined();
  });

  it('real_world_fidelity.entity_type: valor não-vazio e inválido continua sendo erro real (não vira undefined silenciosamente)', () => {
    const result = realWorldFidelitySchema.safeParse({ requires_reference: true, entity_type: 'banana' });
    expect(result.success).toBe(false);
  });

  it('real_world_fidelity.entity_type: valor válido passa normalmente', () => {
    const result = realWorldFidelitySchema.safeParse({ requires_reference: true, entity_type: 'product' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.entity_type).toBe('product');
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

  it('tolera references vindo como null (mesma classe, forma diferente)', () => {
    const result = creativePlanSchema.safeParse({ ...validPlan, references: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.references).toEqual([]);
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

  it('render_mode "" é tratado como ausente e cai no default "editorial" (mesma classe do bug de entity_type)', () => {
    const slides = [
      slide(1, 'hook'),
      ...Array.from({ length: 8 }, (_, i) => slide(i + 2, 'development')),
      slide(10, 'cta'),
    ];
    const result = carouselPlanSchema.safeParse({ concept: 'X', render_mode: '', slide_count: 10, slides });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.render_mode).toBe('editorial');
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
          shot_type: '',
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
    expect(result.data.scenes[0]!.shot_type).toBeUndefined();
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

  it('duration_seconds: null é tratado como ausente (mesma classe, forma diferente)', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'X', duration: 5, aspect_ratio: '9:16',
      scenes: [{ camera_movement: 'a', subject_movement: 'a', environment: 'a', lighting: 'a', transition: 'a', pacing: 'a', duration_seconds: null }],
      sound_direction: 'x', text_overlays: [], cta: 'x', generation_prompts: ['x'],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scenes[0]!.duration_seconds).toBeUndefined();
  });

  /**
   * REGRESSÃO REAL: Otto Elite, Blocker 3 — validação ao vivo real (mesma
   * sessão) mandou text_overlays como STRING ("Abertura 24/09") em vez de
   * array (["Abertura 24/09"]), derrubando a reescrita inteira. "abc" ->
   * ["abc"] não perde informação — o modelo tinha UM item e não empacotou.
   */
  it('text_overlays: string solta vira array de um item (Blocker 3)', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'X', duration: 5, aspect_ratio: '9:16',
      scenes: [{ camera_movement: 'a', subject_movement: 'a', environment: 'a', lighting: 'a', transition: 'a', pacing: 'a', duration_seconds: 5 }],
      sound_direction: 'x', text_overlays: 'Abertura 24/09', cta: 'x', generation_prompts: ['x'],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.text_overlays).toEqual(['Abertura 24/09']);
  });

  it('text_overlays: null ou "" viram lista vazia', () => {
    const comNull = videoPlanSchema.safeParse({
      concept: 'X', duration: 5, aspect_ratio: '9:16',
      scenes: [{ camera_movement: 'a', subject_movement: 'a', environment: 'a', lighting: 'a', transition: 'a', pacing: 'a', duration_seconds: 5 }],
      sound_direction: 'x', text_overlays: null, cta: 'x', generation_prompts: ['x'],
    });
    expect(comNull.success).toBe(true);
    if (comNull.success) expect(comNull.data.text_overlays).toEqual([]);
  });

  it('generation_prompts: string solta vira array de um item, mas continua exigindo 1 por cena (min 1 preservado)', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'X', duration: 5, aspect_ratio: '9:16',
      scenes: [{ camera_movement: 'a', subject_movement: 'a', environment: 'a', lighting: 'a', transition: 'a', pacing: 'a', duration_seconds: 5 }],
      sound_direction: 'x', text_overlays: [], cta: 'x', generation_prompts: 'construction site golden hour',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.generation_prompts).toEqual(['construction site golden hour']);
  });

  it('generation_prompts: array vazio continua rejeitado (min(1) real não vira ausência tolerada)', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'X', duration: 5, aspect_ratio: '9:16',
      scenes: [{ camera_movement: 'a', subject_movement: 'a', environment: 'a', lighting: 'a', transition: 'a', pacing: 'a', duration_seconds: 5 }],
      sound_direction: 'x', text_overlays: [], cta: 'x', generation_prompts: [],
    });
    expect(result.success).toBe(false);
  });

  it('objeto ou número em campo de array continua erro real (não é ruído de representação)', () => {
    const result = videoPlanSchema.safeParse({
      concept: 'X', duration: 5, aspect_ratio: '9:16',
      scenes: [{ camera_movement: 'a', subject_movement: 'a', environment: 'a', lighting: 'a', transition: 'a', pacing: 'a', duration_seconds: 5 }],
      sound_direction: 'x', text_overlays: 42 as unknown as string[], cta: 'x', generation_prompts: ['x'],
    });
    expect(result.success).toBe(false);
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

describe('criticFlagsSchema (Blocker 3)', () => {
  it('missing_deliverables e unsupported_claims toleram string solta como array de um item', () => {
    const result = criticFlagsSchema.safeParse({ missing_deliverables: 'roteiro', unsupported_claims: 'preço não informado no briefing' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.missing_deliverables).toEqual(['roteiro']);
      expect(result.data.unsupported_claims).toEqual(['preço não informado no briefing']);
    }
  });

  it('null e "" viram lista vazia nos dois campos', () => {
    const result = criticFlagsSchema.safeParse({ missing_deliverables: null, unsupported_claims: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.missing_deliverables).toEqual([]);
      expect(result.data.unsupported_claims).toEqual([]);
    }
  });
});
