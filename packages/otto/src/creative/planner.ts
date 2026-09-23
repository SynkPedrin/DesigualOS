import type { Logger } from '@desigual-os/logging';
import { AGENT_PERSONALITIES, type CreativeSpec, type StudioReferenceAsset } from '@desigual-os/types';
import type { RetrievedKnowledge } from '../brain/retrieval.js';
import type { OttoLLMProvider } from '../llm/ollama-provider.js';
import {
  carouselPlanSchema,
  creativePlanSchema,
  productionSpecSchema,
  videoPlanSchema,
} from './schemas.js';
import type {
  CarouselPlan,
  CreativePlan,
  ProductionSpec,
  StudioJobType,
  VideoPlan,
} from './schemas.js';

/**
 * Planner criativo do Otto: orquestra LLM (Ollama local) + conhecimento do
 * Brain pra transformar briefing em plano estruturado. Os prompts de sistema
 * são pt-BR porque o Otto é diretor criativo de uma agência brasileira e a
 * saída criativa (copy, conceito) é em português; os prompts de imagem/vídeo
 * pedem inglês porque os geradores (ComfyUI/SDXL/Flux) entendem melhor.
 */

export interface PlannerDeps {
  llm: OttoLLMProvider;
  logger?: Logger;
}

export interface CreateCreativePlanInput {
  briefing: string;
  /** Contexto do cliente (brand kit, histórico, restrições) em texto livre. */
  clientContext?: string;
  /** Docs recuperados do Brain (retrieveRelevantKnowledge) pra este briefing. */
  knowledge?: RetrievedKnowledge[];
  /** Referências anexadas neste turno, na ordem apresentada ao FLUX.2. */
  referenceAssets?: StudioReferenceAsset[];
}

function formatKnowledgeBlock(knowledge: RetrievedKnowledge[] | undefined): string {
  if (!knowledge || knowledge.length === 0) {
    return '(nenhum conhecimento específico recuperado do Brain para este briefing; siga os princípios gerais da agência.)';
  }
  // Texto plano, sem "###": este bloco entra literal no system prompt, e o
  // preâmbulo já pede "SOMENTE o JSON pedido, sem markdown" - um cabeçalho
  // markdown aqui dentro é a própria fonte contradizendo a regra.
  return knowledge
    .map((entry) => `Documento: ${entry.doc.titulo} (${entry.doc.path})\n${entry.snippet}`)
    .join('\n\n');
}

const CREATIVE_DIRECTOR_PREAMBLE = `${AGENT_PERSONALITIES.otto}

Você não é um gerador de imagens: você PENSA antes de gerar. Seu trabalho é transformar briefing em direção criativa completa - estratégia, conceito, narrativa, direção de arte e critérios de qualidade - antes que qualquer pixel exista.

Regras inegociáveis:
- Português do Brasil com acentos sempre, exceto nos campos de prompt de geração (image_prompt, negative_prompt), que são em inglês porque os modelos de imagem entendem melhor.
- NUNCA genérico: "foto bonita de produto" é falha de direção. Cada campo de art_direction é uma decisão concreta e específica.
- NUNCA usar travessão (-) em nenhum texto em português.
- Quando houver referências, decida explicitamente o papel de CADA uma. Use scene para preservar um lugar, subject para identidade, product para geometria/material, style apenas para linguagem visual, logo para um ativo de marca e mask para limitar uma edição.
- Descreva preservação de forma positiva e observável: "keep the same face, camera, perspective and light direction". Não use uma lista vaga de negativos.
- Uma logo em canvas deve ser aplicada pelo compositor, com placement canvas_*. Uma logo integrada a embalagem, roupa ou objeto usa in_scene e precisa ser conferida no QA.
- Se o briefing pedir para representar um produto, máquina, pessoa, marca ou local REAL e específico (ex: "o trator X da marca Y", "a fachada da loja do cliente", "o CEO", um prédio ou monumento real) - e não algo genérico como "um trator" ou "uma pessoa sorrindo" - marque isso em real_world_fidelity. Sem uma referência de imagem fiel, o gerador INVENTA uma aproximação genérica que parece certa mas não é a coisa real, e isso é inaceitável quando a intenção era representar algo que existe de verdade.
- Responda SOMENTE com o JSON pedido, sem markdown, sem texto antes ou depois.`;

/**
 * Passo 1 do pipeline criativo: briefing -> CreativePlan estruturado.
 * O conhecimento do Brain entra como camada estratégica (posicionamento,
 * funil, frameworks), nunca como substituto do briefing do cliente.
 */
export async function createCreativePlan(
  deps: PlannerDeps,
  input: CreateCreativePlanInput,
): Promise<CreativePlan> {
  const system = `${CREATIVE_DIRECTOR_PREAMBLE}

Gere o plano criativo completo com estas chaves. O campo image_prompt deve ser um
prompt autocontido em inglês: reescreva nele todas as decisões visuais
necessárias para gerar a imagem, inclusive câmera, perspectiva, luz, sombra,
materiais, anatomia, local e preservações das referências. O gerador não deve
precisar traduzir os outros campos para entender a direção.

Formato:
{"client": string, "project": string (opcional), "objective": string, "audience": string, "strategy": string, "concept": string, "narrative": string, "copy": string, "art_direction": {"composition": string, "typography": string, "color": string, "lighting": string, "photography": string, "materials": string, "atmosphere": string}, "references": string[], "reference_strategy": [{"reference_index": number começando em 1, "role": "auto"|"scene"|"subject"|"product"|"style"|"layout"|"logo"|"mask", "fidelity": "exact"|"high"|"interpretive", "instruction": string em inglês, "placement": "reference_only"|"in_scene"|"canvas_top_left"|"canvas_top_right"|"canvas_bottom_left"|"canvas_bottom_right"}], "real_world_fidelity": {"requires_reference": boolean, "entity_type": "product"|"brand"|"person"|"location"|"machine" (opcional), "entity_description": string (opcional, o que precisa ser fiel)}, "image_prompt": string (inglês, detalhado), "negative_prompt": string (inglês), "technical_specs": string, "production_requirements": string, "quality_criteria": [{"criterion": string, "description": string, "weight": number 0..1}], "delivery_format": string (opcional; o sistema já sabe o formato de entrega pelo tipo do pedido, deixe de fora se não tiver certeza)}`;

  const user = [
    input.clientContext ? `Contexto do cliente:\n${input.clientContext}` : null,
    `Conhecimento estratégico do Brain da agência (camada de embasamento):\n\n${formatKnowledgeBlock(input.knowledge)}`,
    `Briefing:\n${input.briefing}`,
    input.referenceAssets?.length
      ? `Manifesto de referências anexadas (use os índices exatamente como estão):\n${input.referenceAssets
          .map((asset, index) => `Reference Image ${index + 1}: filename="${asset.filename}", content_type="${asset.contentType}"`)
          .join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  deps.logger?.info({ client: input.clientContext ? 'with-context' : 'no-context' }, 'otto: gerando plano criativo');
  return deps.llm.chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    creativePlanSchema,
    { temperature: 0.8 },
  );
}

/**
 * Planejamento de carrossel respeitando as leis do modus operandi canônico
 * (.agents/skills/carrossel-cinema-impossivel): 10 a 16 cards, hook na capa,
 * CTA emocional no último, desenvolvimento no meio. slideCount é clampado
 * pro intervalo canônico: pedir 5 cards não produz carrossel, produz peça
 * quebrada - melhor ajustar do que entregar fora da lei.
 */
export async function planCarousel(
  deps: PlannerDeps,
  plan: CreativePlan,
  slideCount = 10,
  opts: { revisionNote?: string; strategyBriefing?: string } = {},
): Promise<CarouselPlan> {
  const count = Math.min(16, Math.max(10, Math.round(slideCount)));

  const system = `${CREATIVE_DIRECTOR_PREAMBLE}

Você está planejando um carrossel de Instagram (1080x1350) a partir de um plano criativo aprovado.

Leis do carrossel (inegociáveis):
- Estrutura: 1º slide é "hook" (promessa que para o feed), último é "cta" (CTA emocional: salvar/enviar, nunca "segue agora"), o meio alterna "context", "development" e "value".
- Uma ideia por slide. Galeria espremida mata a curiosidade.
- Copy direta, primeira pessoa, sem travessão, sem emoji nos cards.
- Cada slide carrega seu próprio image_prompt (inglês, detalhado, herdando a direção de arte do plano).
- Quando o briefing pede takes fotográficos, sequência de imagens ou storyboard visual, use render_mode="photographic": as imagens não recebem títulos/textos sobrepostos. Alterne retrato, detalhe, ação e ambiente conforme o briefing, com os mesmos sujeitos, produtos, roupas, local e luz. Copy pode ser legenda separada. Caso contrário, render_mode="editorial".

Gere exatamente ${count} slides com estas chaves:
{"concept": string, "render_mode": "editorial"|"photographic", "slide_count": ${count}, "slides": [{"index": number (1..${count}), "narrative_function": "hook"|"context"|"development"|"value"|"cta", "objective": string, "copy": string, "visual": string, "composition": string, "layout": string, "image_prompt": string}]}`;

  const user = [
    `Plano criativo aprovado:\n\n${JSON.stringify(plan, null, 2)}`,
    opts.strategyBriefing ?? '',
    // Mesmo raciocínio de planVideo: sem isto, a reescrita regenerava o
    // carrossel do zero sem saber o que a avaliação anterior reprovou.
    opts.revisionNote
      ? `REVISÃO OBRIGATÓRIA (o carrossel anterior falhou nesta avaliação; corrija, não regenere às cegas):\n${opts.revisionNote}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  deps.logger?.info({ slideCount: count }, 'otto: planejando carrossel');
  return deps.llm.chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    carouselPlanSchema,
    { temperature: 0.7 },
  );
}

/**
 * REEL EXECUTION ENGINE (Otto Elite, missão de fechamento "Reel Execution
 * Engine Closure"): este prompt é a camada de INTELIGÊNCIA DE FORMATO
 * específica de vídeo curto — não um storyboard genérico de "cena com
 * câmera e luz". Achado ao vivo, repetido em DOIS modelos diferentes
 * (qwen3.5:4b local E qwen2.5:14b na GPU): mesmo com o schema certo, os
 * dois produziram cenas estáticas de 5s mecânicos, "Visual: None" em cenas
 * de tipografia, e câmera repetida sem variação — o gargalo não era o
 * tamanho do modelo, era faltar ESTA camada de raciocínio específica de
 * Reels antes de escrever a cena. O schema (videoSceneSchema) não ganhou
 * campos novos de propósito — todo o raciocínio abaixo (papel de retenção,
 * variedade de câmera, ritmo de duração) se expressa nos MESMOS campos que
 * já existiam (camera_movement, subject_movement, transition, duration),
 * só que com conteúdo de verdade em vez de placeholder.
 */
const REEL_EXECUTION_ENGINE = `RACIOCÍNIO DE REEL (pense nisto ANTES de escrever cada cena, mas só preencha os campos do schema — não crie campos novos):

PAPEL DE RETENÇÃO por cena (não é campo do schema, é como você decide o que a cena faz): a primeira cena existe pra PARAR o scroll (ação/enquadramento/contraste que justifica parar — nunca confie só na locução pros primeiros 2 segundos); as do meio ORIENTAM, DESENVOLVEM ou trazem uma QUEBRA DE PADRÃO (mudança de enquadramento, ritmo ou energia visual — reels sem NENHUMA quebra viram 6 fotos com voz por cima, o teste que reprova PLATFORM_FIT); a(s) última(s) fecham a PROMESSA e levam ao CTA. Nem toda cena precisa de um papel especial, mas a sequência como um todo precisa mostrar essa curva — não energia constante do início ao fim.

CÂMERA (camera_movement) é vocabulário de direção real, não "estático" repetido: push-in, pull-back, tracking, handheld, POV, over-the-shoulder, macro, pan, tilt, rack focus, whip, ou plano travado (locked) QUANDO for a escolha certa pra aquela cena — nunca o padrão default de todas. Toda decisão de câmera serve a atenção, emoção, clareza ou transição da cena; não enumere termos de câmera por enumerar.

AÇÃO DO SUJEITO (subject_movement) precisa responder "o que está de fato acontecendo" — não "família feliz na sala", e sim algo como "o casal entra pela porta enquanto a câmera acompanha lateralmente; os dois param um instante e olham o ambiente". Curto e genérico demais não é executável.

CENA SÓ DE TIPOGRAFIA é permitida, mas NUNCA "Visual: None" ou vazio — descreva fundo, composição do texto, entrada/saída (escala, wipe, corte no beat), como se fosse uma cena normal, só que sem sujeito humano.

TRANSIÇÃO (transition) tem que dizer o QUÊ, não só que existe: corte seco, corte no movimento (ex.: "corte no movimento da mão abrindo a porta"), match cut, corte por som, wipe — nunca só "transição dinâmica" sem dizer qual.

RITMO DE DURAÇÃO (duration_seconds): NÃO repita o mesmo número em todas as cenas por padrão (5s, 5s, 5s, 5s é ritmo mecânico, não editorial) — derive a duração do que cabe na cena: fala mais longa, ação mais complexa ou papel de retenção mais importante pedem mais tempo; um beat de texto ou corte rápido pode ser 1-2s. Varie de propósito.

TESTE DO EDITOR: se um editor recebesse só isto amanhã, ele precisa saber o que filmar, o que se move, que enquadramento, o que muda, que texto aparece, o que é dito e quando cortar — pra CADA cena, sem precisar perguntar.`;

/** Planejamento de vídeo/reels: cena a cena com direção de câmera e ritmo. */
export async function planVideo(
  deps: PlannerDeps,
  plan: CreativePlan,
  opts: { revisionNote?: string; strategyBriefing?: string } = {},
): Promise<VideoPlan> {
  const system = `${CREATIVE_DIRECTOR_PREAMBLE}

Você está planejando um vídeo/reels a partir de um plano criativo aprovado. Cada cena tem direção de câmera, movimento de sujeito, ambiente, luz, transição e ritmo - um storyboard em JSON, não um prompt único.

${REEL_EXECUTION_ENGINE}

Padrão de produção: editorial publicitário com detalhe fotográfico, não slideshow genérico.
- Planeje takes de 1 a 5 segundos, no máximo 16. A soma das durações deve ser duration.
- Alterne retrato, plano aberto, detalhe de material/produto, ação simples e ambiente quando fizer sentido para o briefing. Não force esporte, tênis, azul ou personagens da referência em outros clientes.
- Cada cena inclui image_prompt EM INGLÊS para uma fotografia FLUX.2 independente, shot_type e continuity. Repita os identificadores do mesmo personagem, roupa, produto real, local, paleta e direção de luz; altere apenas ação/enquadramento declarados.
- generation_prompts tem exatamente um prompt EM INGLÊS por cena, descrevendo uma ação física simples e no máximo um movimento de câmera controlado. Nada de cortes/montagens dentro do mesmo take.
- Preserve poros, cabelo/pelos, trama dos tecidos, reflexos e sombras de contato; não invente peças, identidade, logo ou modelo de produto. Referências reais têm prioridade sobre imaginação.
- Textos e logos exatos pertencem à composição gráfica, não peça ao gerador de vídeo para redesenhá-los. Não afirme que houve aprovação visual automática.
- Cuts são cortes de montagem entre takes. sound_direction descreve ambiente/SFX; trilha contínua, locução e tipografia exigem finalização separada.
- SE o briefing pede um vídeo INFORMATIVO — alguém explicando algo, anunciando uma data, um processo, uma condição de atendimento, e não só um b-roll mudo — preencha spoken_line em CADA cena com a fala exata daquele take, em português, na ordem em que vai ser gravada/locutada. Sem spoken_line, quem recebe o plano tem direção de câmera e nenhuma palavra do que dizer, e o roteiro não é executável. Preencha também on_screen_text quando aquela cena tiver texto próprio na tela (data, preço, condição), além do que já vai em text_overlays.
- Se o vídeo for puramente visual (b-roll, produto sem locução), deixe spoken_line de fora — não invente fala que ninguém pediu.

Gere com estas chaves:
{"concept": string, "duration": number (segundos), "aspect_ratio": string (ex: "9:16"), "scenes": [{"duration_seconds": number, "image_prompt": string, "shot_type": "portrait"|"wide"|"detail"|"action"|"environment"|"closing", "continuity": string, "camera_movement": string, "subject_movement": string, "environment": string, "lighting": string, "transition": string, "pacing": string, "spoken_line": string (opcional, português), "on_screen_text": string (opcional, português)}], "sound_direction": string, "text_overlays": string[], "cta": string, "generation_prompts": string[] (inglês, um por cena)}`;

  const user = [
    `Plano criativo aprovado:\n\n${JSON.stringify(plan, null, 2)}`,
    opts.strategyBriefing ?? '',
    /**
     * Otto Senior 20Y, achado ao vivo (segunda validação Cosentino): o loop
     * de critic/reescrita mandava a nota de revisão só pra createCreativePlan
     * — planVideo era chamado de novo, do zero, sem nenhuma ideia do que a
     * revisão pedia. Resultado medido: a fala (spoken_line) sumia de cenas
     * que já a tinham, e o gate de completude derrubava o entregável de novo
     * por "roteiro" ausente — a mesma falha se repetindo porque o segundo
     * passo do pipeline nunca soube que havia uma falha pra corrigir.
     */
    opts.revisionNote
      ? `REVISÃO OBRIGATÓRIA (o storyboard anterior falhou nesta avaliação; corrija, não regenere às cegas):\n${opts.revisionNote}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  deps.logger?.info('otto: planejando vídeo');
  return deps.llm.chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    videoPlanSchema,
    { temperature: 0.7 },
  );
}

/**
 * Monta o prompt de imagem final a partir do plano. Esta função existe pra
 * matar o prompt genérico: se o plano não tem direção de arte concreta, o
 * prompt resultante deixa isso escancarado (campos vazios viram ausência de
 * cláusula, não placeholder fofo). Saída em inglês (modelos de imagem).
 */
export function buildImagePrompt(plan: CreativePlan): string {
  const ad = plan.art_direction;
  const clauses = [
    `Primary generation direction: ${plan.image_prompt}`,
    `Subject and concept: ${plan.concept}`,
    `Narrative: ${plan.narrative}`,
    `Environment and composition: ${ad.composition}`,
    `Photography: ${ad.photography}`,
    `Lighting: ${ad.lighting}`,
    `Color palette: ${ad.color}`,
    `Materials and texture: ${ad.materials}`,
    `Atmosphere: ${ad.atmosphere}`,
    `Typography (if any text is rendered): ${ad.typography}`,
    ...(plan.technical_specs ? [`Technical: ${plan.technical_specs}`] : []),
    `Visual hierarchy follows the objective: ${plan.objective}`,
  ];
  if (plan.references.length > 0) {
    clauses.push(`Style references: ${plan.references.join('; ')}`);
  }
  return clauses.join('. ');
}

export interface BuildProductionSpecOptions {
  clientId: string;
  jobType?: StudioJobType;
  /** Carrossel: o plano slide a slide vira o campo slides do spec. */
  carouselPlan?: Omit<CarouselPlan, 'render_mode'> & { render_mode?: CarouselPlan['render_mode'] };
  /** Storyboard completo: não perder cenas ao atravessar a fila. */
  videoPlan?: VideoPlan;
  quality?: string;
  aspectRatio?: string;
  metadata?: Record<string, unknown>;
  referenceAssets?: StudioReferenceAsset[];
}

/**
 * `delivery_format` TYPE A (Otto Senior 20Y, Missão 2): jobType e aspect
 * ratio já são conhecidos pelo CÓDIGO no momento de montar o spec — não faz
 * sentido pedir pro modelo ser a fonte de verdade de um campo de
 * roteamento do sistema, e um achado ao vivo (validação Cosentino) mostrou
 * o modelo derrubando o turno inteiro por esquecer esse campo numa
 * reescrita longa. Só usado quando o plano não trouxe um (ou trouxe vazio).
 */
function deriveDeliveryFormat(jobType: StudioJobType, aspectRatio: string): string {
  const labels: Record<StudioJobType, string> = {
    image: 'Imagem',
    carousel: 'Carrossel',
    video: 'Vídeo',
    reels: 'Reels',
    upscale: 'Upscale',
  };
  return `${labels[jobType]} ${aspectRatio}`;
}

function applyReferenceStrategy(plan: CreativePlan, assets: StudioReferenceAsset[]): StudioReferenceAsset[] {
  return assets.slice(0, 10).map((asset, index) => {
    const strategy = plan.reference_strategy.find((item) => item.reference_index === index + 1);
    return {
      ...asset,
      ...(strategy
        ? {
            role: strategy.role,
            fidelity: strategy.fidelity,
            instruction: strategy.instruction,
            placement: strategy.placement,
          }
        : {}),
    };
  });
}

function buildCreativeSpec(
  plan: CreativePlan,
  assets: StudioReferenceAsset[],
  jobType: StudioJobType,
  quality: string,
  aspectRatio: string,
): CreativeSpec {
  const hasScene = assets.some((asset) => asset.role === 'scene');
  const hasSubject = assets.some((asset) => asset.role === 'subject');
  const hasProduct = assets.some((asset) => asset.role === 'product');
  const logo = assets.find((asset) => asset.role === 'logo' && asset.placement?.startsWith('canvas_'));
  return {
    objective: plan.objective,
    contentType: jobType === 'reels' ? 'reel' : jobType === 'upscale' ? 'image' : jobType,
    operation: assets.length > 0 ? 'edit' : 'generate',
    subject: { description: plan.concept, identityCritical: hasSubject, productCritical: hasProduct },
    environment: { description: plan.art_direction.atmosphere },
    composition: { framing: plan.art_direction.composition, aspectRatio },
    camera: { look: plan.art_direction.photography },
    lighting: { description: plan.art_direction.lighting },
    artDirection: { mood: plan.art_direction.atmosphere },
    preservation: {
      identity: hasSubject,
      product: hasProduct,
      background: hasScene,
      composition: hasScene,
      camera: hasScene,
      lighting: hasScene,
      perspective: hasScene,
      materials: hasProduct,
      textAndLogos: assets.some((asset) => asset.role === 'logo'),
    },
    referencePlan: { assets },
    fidelity: {
      level: 'maximum',
      location: hasScene,
      identity: hasSubject,
      productGeometry: hasProduct,
      physicalLighting: true,
      materialMicrodetail: true,
      anatomy: true,
      typography: true,
    },
    qualityProfile: quality === 'draft' ? 'draft' : quality === 'standard' ? 'standard' : 'master',
    brandComposition: logo
      ? { logo: { sourceUrl: logo.url, placement: logo.placement ?? 'canvas_bottom_right', widthRatio: 0.18, marginRatio: 0.04 }, renderTextDeterministically: true }
      : { renderTextDeterministically: true },
  };
}

/**
 * Não BLOQUEIA a geração: um plano de LLM tem falso positivo/negativo
 * demais pra travar o pipeline inteiro numa aposta binária. Em vez disso,
 * anexa um aviso (metadata.fidelity_warning, dado de produção de verdade)
 * que a resposta do Otto no chat e o job do Studio carregam adiante, pra
 * pessoa saber que está recebendo um conceito fictício em vez de fingir uma
 * fidelidade que a geração sem referência não consegue entregar.
 *
 * Otto Elite, Blocker 5: a versão anterior deste texto era um parágrafo
 * técnico completo ("Atenção: este briefing pede para representar... anexe
 * uma foto de referência se a fidelidade ao real importar aqui") que virava
 * a PRIMEIRA COISA que a pessoa lia na resposta — dominando um pedido de
 * conteúdo normal com um aviso técnico longo antes de qualquer criação
 * aparecer. Curto e no fim, não em cima: é dado de produção, não a
 * manchete da entrega.
 */
export function checkRealWorldFidelity(
  plan: CreativePlan,
  referenceAssets: StudioReferenceAsset[],
): string | null {
  const fidelity = plan.real_world_fidelity;
  if (!fidelity?.requires_reference) return null;
  const hasFaithfulReference = referenceAssets.some((asset) => asset.fidelity === 'exact' || asset.fidelity === 'high');
  if (hasFaithfulReference) return null;
  const entity = fidelity.entity_description?.trim() || `${fidelity.entity_type ?? 'elemento'} real mencionado no briefing`;
  return `Nota de produção: sem referência de imagem fiel de ${entity} — o visual é aproximado, não o real.`;
}

/**
 * Converte o plano criativo na Production Spec que alimenta a fila
 * studio-jobs: prompt final + negative + slides/copy quando couber.
 * A saída é validada contra productionSpecSchema antes de sair daqui:
 * spec inválida nunca chega na fila.
 */
export function buildProductionSpec(
  plan: CreativePlan,
  opts: BuildProductionSpecOptions,
): ProductionSpec {
  const jobType = opts.jobType ?? 'image';
  const quality = opts.quality ?? 'high';
  const aspectRatio = opts.aspectRatio ?? '4:5';
  const referenceAssets = applyReferenceStrategy(plan, opts.referenceAssets ?? []);
  const creativeSpec = buildCreativeSpec(plan, referenceAssets, jobType, quality, aspectRatio);
  const fidelityWarning = checkRealWorldFidelity(plan, referenceAssets);
  const spec = {
    job_type: jobType,
    client_id: opts.clientId,
    // O prompt final é o detalhado (buildImagePrompt), não o rascunho do
    // plano: o campo image_prompt do LLM é insumo, a montagem é nossa.
    prompt: buildImagePrompt(plan),
    negative_prompt: plan.negative_prompt,
    ...(jobType === 'carousel' && opts.carouselPlan ? { slides: opts.carouselPlan.slides } : {}),
    copy: plan.copy,
    quality,
    aspect_ratio: aspectRatio,
    references: plan.references,
    reference_assets: referenceAssets,
    metadata: {
      objective: plan.objective,
      concept: plan.concept,
      delivery_format: plan.delivery_format ?? deriveDeliveryFormat(jobType, aspectRatio),
      ...(plan.production_requirements ? { production_requirements: plan.production_requirements } : {}),
      creative_spec: creativeSpec,
      ...(opts.carouselPlan ? { carousel_plan: opts.carouselPlan } : {}),
      ...(opts.carouselPlan?.render_mode === 'photographic' ? { design: 'photographic' } : {}),
      ...(opts.videoPlan ? { video_plan: opts.videoPlan } : {}),
      ...(fidelityWarning ? { fidelity_warning: fidelityWarning } : {}),
      ...opts.metadata,
    },
  };
  return productionSpecSchema.parse(spec);
}
