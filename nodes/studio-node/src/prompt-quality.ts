/**
 * Enriquecedor de prompt.
 *
 * O colaborador digita "um elefante numa praia", não um parágrafo
 * cinematográfico — e o Flux entrega exatamente o que foi pedido: uma foto
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

const CINEMATIC_SUFFIX =
  ', cinematic film still, shot on 35mm film, dramatic cinematic lighting, volumetric light, ' +
  'shallow depth of field, ultra detailed, high dynamic range, professional color grading, photorealistic';

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
