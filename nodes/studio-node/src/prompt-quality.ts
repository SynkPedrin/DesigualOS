import type { CreativeSpec } from '@desigual-os/types';
import type { ResolvedReferenceAsset } from './reference-plan';
import { buildReferencePromptDirective } from './reference-plan';

/**
 * Enriquecedor de prompt.
 *
 * O colaborador digita "um elefante numa praia", não um parágrafo
 * cinematográfico - e o Flux entrega exatamente o que foi pedido: uma foto
 * de banco de imagem, céu azul, sem clima nenhum. A referência de qualidade
 * que o Endrigo mandou vem de prompt longo e descritivo.
 *
 * Comparação medida na RTX 4090 (mesmo prompt "um elefante numa praia",
 * mesma seed 2024, 1344x896, 28 steps):
 *   sem sufixo -> foto chapada, céu azul claro, sem direção de arte;
 *   com sufixo -> golden hour, grading teal/orange, luz volumétrica,
 *                 reflexo na areia molhada, profundidade real.
 * Só o sufixo mudou. É a alavanca mais barata de qualidade que existe aqui.
 */

/**
 * Padrão de qualidade "realismo" (09/09/2026, achado real testando com
 * humanos numa cena): sem isso explícito no sufixo, o FLUX.2 tende a
 * entregar pele lisa demais, sem poro nem textura - o resultado é bonito mas
 * dá pra saber que é IA num relance. É a mesma alavanca do sufixo
 * cinematográfico: barata (só texto) e o efeito é grande o suficiente pra
 * decidir se a peça passa no teste do "olhar rápido" ou não.
 */
const REALISM_SUFFIX =
  ', shot on a real DSLR camera, unretouched documentary photograph, visible skin pores and fine texture, ' +
  'natural skin tone variation and subtle imperfections, authentic photographic grain and sensor noise, ' +
  'hard-edged contact shadows grounding every figure and object, imperfect weathered surfaces (worn asphalt, ' +
  'uneven grass, scuffed fabric), natural fabric wrinkles and creases, not a render, not 3D, not CGI, ' +
  'not a video game screenshot, avoid airbrushed, waxy, plastic, over-smoothed or synthetic look';

const CINEMATIC_SUFFIX =
  ', cinematic film still, shot on 35mm film, dramatic cinematic lighting, volumetric light, ' +
  'shallow depth of field, ultra detailed, high dynamic range, professional color grading, photorealistic' +
  REALISM_SUFFIX;

/**
 * Sinais de que a pessoa JÁ dirigiu o visual. Nesses casos não empilha o
 * sufixo: além de virar prompt redundante, sobrescreveria uma escolha
 * consciente (quem pede "flat vector logo" não quer film still de 35mm).
 */
const ALREADY_DIRECTED = [
  'cinematic',
  'film still',
  'photoreal',
  '35mm',
  'photograph',
  'render',
  '3d',
  'flat',
  'vector',
  'logo',
  'ilustra',
  'illustration',
  'cartoon',
  'anime',
  'aquarela',
  'watercolor',
  'minimalist',
  'minimalista',
  'lighting',
  'iluminação',
];

export function enrichImagePrompt(prompt: string): { prompt: string; enriched: boolean } {
  const trimmed = prompt.trim();
  if (!trimmed) return { prompt: trimmed, enriched: false };

  const normalized = trimmed
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  if (ALREADY_DIRECTED.some((token) => normalized.includes(token))) {
    return { prompt: trimmed, enriched: false };
  }

  return { prompt: trimmed + CINEMATIC_SUFFIX, enriched: true };
}

/**
 * Compila direção de arte em uma instrução adequada ao FLUX.2. O modelo
 * responde melhor a relações concretas e preservações positivas do que a
 * pilhas de adjetivos ou negative prompts herdados de SDXL.
 */
export function compileFlux2Prompt(params: {
  prompt: string;
  spec: CreativeSpec;
  references: ResolvedReferenceAsset[];
}): { prompt: string; enriched: boolean } {
  const base = params.prompt.trim();
  const maximum = params.spec.fidelity?.level === 'maximum' || params.spec.qualityProfile === 'master';

  if (!maximum && params.references.length === 0) return enrichImagePrompt(base);

  const blocks = [
    `Create a production-grade ${params.spec.camera?.look ?? 'commercial photograph'} that fulfills this instruction: ${base}. This must read as an unretouched photograph shot on a real camera, not a 3D render, not CGI, not a video game screenshot.`,
    params.spec.subject?.description ? `Subject: ${params.spec.subject.description}.` : '',
    params.spec.environment?.description ? `Environment: ${params.spec.environment.description}.` : '',
    params.spec.composition?.framing ? `Composition and framing: ${params.spec.composition.framing}.` : '',
    params.spec.composition?.angle ? `Camera angle: ${params.spec.composition.angle}.` : '',
    params.spec.camera?.lens ? `Lens behavior: ${params.spec.camera.lens}.` : '',
    params.spec.lighting?.description ? `Lighting design: ${params.spec.lighting.description}.` : '',
    buildReferencePromptDirective(params.references),
    'Maintain one physically coherent camera model: consistent horizon and vanishing points, believable scale, occlusion, depth, surface contact and perspective across every element.',
    'Maintain one physically coherent lighting setup: consistent light direction, color temperature, softness, reflections, ambient fill, contact shadows and cast shadows. Every inserted object belongs naturally in the scene. Ground every figure and object with a visible, hard-edged contact shadow directly beneath it - floating subjects with no contact shadow are a render artifact and must not happen.',
    'Render natural human anatomy and interaction: correct hands and joints, realistic weight and grip, asymmetric expressions, individual flyaway hair strands, facial microstructure and skin with visible pores, fine lines, faint blemishes, natural oil sheen variation and uneven tone typical of real skin - never airbrushed, waxy, plastic or CGI-smooth. A viewer glancing at the image for one second should read it as a real photograph, not an AI render.',
    'Render product and environment materials with truthful microdetail: rubber, metal, glass, fabric, wood, soil, grass and fur retain distinct roughness, texture, edge wear and reflections without plastic smoothing or artificial oversharpening.',
    'Capture characteristics of a real camera sensor: fine grain or noise in shadow areas, slight micro-variation in tone across large flat surfaces, natural specular highlights - avoid the flat, noise-free, over-denoised look typical of synthetic renders.',
    'Use controlled commercial color grading, broad dynamic range with recoverable highlights and shadows, natural local contrast and detail at the focal plane.',
    params.spec.preservation?.background
      ? 'Keep the referenced background architecture, landmarks, spatial relationships and camera placement recognizable and unchanged except for the requested edit.'
      : '',
    params.spec.preservation?.identity
      ? 'Keep referenced identities recognizable through facial geometry, proportions, age cues, hairline and skin tone.'
      : '',
    params.spec.preservation?.product
      ? 'Keep referenced product geometry, part count, proportions, material boundaries, colors and identifying features accurate.'
      : '',
    params.spec.brandComposition?.renderTextDeterministically
      ? 'Reserve clean negative space for final typography and canvas branding; do not invent extra captions, watermarks or unrelated marks.'
      : '',
  ].filter(Boolean);

  return { prompt: blocks.join(' '), enriched: true };
}

/**
 * Estilo escolhido na tela do Studio (studio_jobs.style) traduzido pra
 * modificador de prompt. 'padrao' não adiciona nada - o enriquecimento
 * cinematográfico acima já é o padrão da casa.
 */
const STYLE_MODIFIERS: Record<string, string> = {
  minimalista: 'minimalist composition, generous negative space, clean design',
  cinematico: 'cinematic lighting, film still, anamorphic',
  editorial: 'editorial photography, magazine layout aesthetic',
  '3d': 'stylized 3d render, octane, soft studio lighting',
};

export function stylePromptModifier(style: string | null | undefined): string {
  if (!style || style === 'padrao') return '';
  return STYLE_MODIFIERS[style] ?? '';
}

/**
 * Diretiva curta derivada do snapshot de brand kit que a API grava em
 * studio_jobs.metadata.brand_kit (ver POST /studio/jobs). Paleta e tom
 * entram no prompt; logo/fontes não se traduzem em prompt de difusão.
 */
export function brandKitPromptDirective(brandKit: unknown): string {
  if (!brandKit || typeof brandKit !== 'object') return '';
  const kit = brandKit as { colors?: unknown; tone_of_voice?: unknown };
  const parts: string[] = [];
  if (Array.isArray(kit.colors) && kit.colors.length > 0) {
    parts.push(`brand palette: ${kit.colors.filter((color) => typeof color === 'string').join(', ')}`);
  }
  if (typeof kit.tone_of_voice === 'string' && kit.tone_of_voice.trim().length > 0) {
    parts.push(`tone: ${kit.tone_of_voice.trim()}`);
  }
  return parts.filter((part) => !part.endsWith(': ')).join('; ');
}
