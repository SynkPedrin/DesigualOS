import type { CarouselPlan } from './schemas.js';

/**
 * CAROUSEL QUALITY — REPETITION / PROGRESSION (Otto Senior V1, "Universal
 * Quality Floor" — carousel repair task).
 *
 * Achado ao vivo real (certificação não-vídeo, mesma sessão): o carrossel
 * da LaunchDesk repetiu a mesma ideia ("configuração manual toma tempo,
 * automação resolve") em pelo menos três pares de slides diferentes
 * (2-3, 5-6, 8-9) com palavras trocadas — nota de retenção/platform_fit
 * despencou (3/10) e o critic (LLM) não tinha nenhum sinal determinístico
 * pra apontar ONDE a repetição estava, só que "havia" repetição.
 *
 * Este módulo é DELIBERADAMENTE independente de qualquer skill externa —
 * é raciocínio próprio do Otto, generalizado a partir de um princípio
 * universal que qualquer sistema de carrossel bem feito respeita ("cada
 * card revela algo NOVO, senão a peça pagina uma ideia só em vez de
 * progredir"), nunca de uma regra específica de produto de terceiros.
 */
export type CarouselQualityFinding = 'REPEATED_IDEA' | 'GENERIC_CTA';

export interface CarouselQualityIssue {
  finding: CarouselQualityFinding;
  slideIndexes?: number[];
  detail: string;
}

function normalizeWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4); // ignora artigo/preposição — só palavras com carga de sentido
}

/** Jaccard simples sobre o conjunto de palavras significativas — barato, determinístico, sem chamada de LLM. */
function similarity(a: string, b: string): number {
  const setA = new Set(normalizeWords(a));
  const setB = new Set(normalizeWords(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Generalização de "prometa N entregue N-1"/"um segredo por card" — não a
 * MECÂNICA (que é de um produto específico e não transfere), o PRINCÍPIO:
 * cada card precisa introduzir algo que o anterior não disse. Dois slides
 * (não necessariamente adjacentes — o achado real repetia em 2-3 E em 5-6
 * E em 8-9, não só vizinhos) com similaridade alta de vocabulário
 * significativo estão pagando a mesma ideia duas vezes.
 */
const SIMILARITY_THRESHOLD = 0.2;

/** Frases de CTA genéricas que não carregam ação real — princípio universal (CTA vago não converte), não a lista específica de nenhum produto. */
const GENERIC_CTA_PATTERNS = [/\bmarca\s+\d+\s+amigos?\b/i, /\bsegue\s+(agora|j[aá])\b/i, /\bclique\s+aqui\b/i, /\bn[aã]o\s+perca\b/i];

/**
 * Rótulo repetido ("Antes:"/"Depois:"/"Mito:"/"Verdade:"...) usado como
 * MULETA estrutural em vários slides é um sinal independente, mais barato
 * e mais confiável que a similaridade de vocabulário sozinha — o achado
 * real repetiu "Antes:"/"Depois:" em dois pares de slides diferentes
 * (5-6 e 8-9), cada par com vocabulário quase todo distinto (a
 * similaridade de conteúdo ali, medida, foi baixa: ~0.06-0.12), mas a
 * ESTRUTURA informacional — mesmo formato, mesmo par de rótulos — se
 * repetiu sem progressão real.
 */
function detectRepeatedLeadingLabel(slides: CarouselPlan['slides']): CarouselQualityIssue[] {
  const labelCounts = new Map<string, number[]>();
  for (const slide of slides) {
    const match = /^\s*([A-ZÀ-Ú][a-zà-ú]{2,15}):/.exec(slide.copy);
    if (!match) continue;
    const label = match[1]!.toLowerCase();
    const indexes = labelCounts.get(label) ?? [];
    indexes.push(slide.index);
    labelCounts.set(label, indexes);
  }
  const issues: CarouselQualityIssue[] = [];
  for (const [label, indexes] of labelCounts) {
    if (indexes.length >= 2) {
      issues.push({
        finding: 'REPEATED_IDEA',
        slideIndexes: indexes,
        detail: `rótulo "${label}:" reaparece em ${indexes.length} slides (${indexes.join(', ')}) — reusar o mesmo formato de abertura repetidamente é muleta estrutural, não progressão`,
      });
    }
  }
  return issues;
}

export function detectCarouselRepetition(plan: CarouselPlan): CarouselQualityIssue[] {
  const issues: CarouselQualityIssue[] = [...detectRepeatedLeadingLabel(plan.slides)];
  const slides = plan.slides;

  for (let i = 0; i < slides.length; i++) {
    for (let j = i + 1; j < slides.length; j++) {
      const score = similarity(slides[i]!.copy, slides[j]!.copy);
      if (score >= SIMILARITY_THRESHOLD) {
        issues.push({
          finding: 'REPEATED_IDEA',
          slideIndexes: [slides[i]!.index, slides[j]!.index],
          detail: `slides ${slides[i]!.index} e ${slides[j]!.index} pagam a mesma ideia com palavras trocadas ("${slides[i]!.copy}" / "${slides[j]!.copy}") — a peça precisa progredir, não paginar`,
        });
      }
    }
  }

  const ctaSlide = slides.find((s) => s.narrative_function === 'cta') ?? slides[slides.length - 1];
  if (ctaSlide && GENERIC_CTA_PATTERNS.some((re) => re.test(ctaSlide.copy))) {
    issues.push({
      finding: 'GENERIC_CTA',
      slideIndexes: [ctaSlide.index],
      detail: `slide ${ctaSlide.index} (CTA) usa fórmula genérica ("${ctaSlide.copy}") em vez de uma ação específica`,
    });
  }

  return issues;
}

export function formatCarouselQualityNote(issues: CarouselQualityIssue[]): string {
  return [
    'A checagem determinística de repetição/progressão do carrossel encontrou:',
    ...issues.map((issue) => `- ${issue.detail}`),
    'Reescreva os slides apontados pra cada um introduzir uma informação, prova ou ângulo NOVO — nunca a mesma ideia com sinônimo.',
  ].join('\n');
}
