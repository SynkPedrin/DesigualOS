/**
 * anti-generic.ts — porta determinística de qualidade criativa (§74, §76).
 *
 * A spec é explícita: o LLM NÃO pode ser o único avaliador (§76). Antes da
 * avaliação por modelo (evaluateCreative), esta régua barata e determinística
 * pega o pior tipo de saída criativa: a copy que "poderia servir para qualquer
 * marca". É PURA — mesma entrada, mesma resposta — e é o gatilho de auto-revisão
 * no runtime: copy genérica reprova, e o loop replaneja (§73).
 */

/** Frases-clichê que sozinhas não dizem nada de específico sobre marca nenhuma. */
const GENERIC_PHRASES = [
  'transforme seu negocio',
  'transforme sua empresa',
  'leve sua empresa para o proximo nivel',
  'leve seu negocio para o proximo nivel',
  'proximo nivel',
  'solucao completa',
  'solucao ideal',
  'a solucao perfeita',
  'resultados que voce merece',
  'o parceiro ideal',
  'seu parceiro ideal',
  'qualidade e excelencia',
  'excelencia em',
  'inovacao e tecnologia',
  'pensando em voce',
  'feito para voce',
  'a melhor escolha',
  'nao perca tempo',
  'nao perca mais tempo',
  'invista no seu futuro',
  'descubra o poder',
  // Família "potencial": medida ao vivo nos modelos reais do node do Otto
  // (15/09/2026) — qwen2.5:3b devolveu "Descubra seu potencial" e
  // llama3.2:3b devolveu "Desperte o seu potencial", as duas passando batido
  // pela régua antiga.
  'descubra seu potencial',
  'desperte seu potencial',
  'desperte o seu potencial',
  'todo o seu potencial',
  'alcance seus objetivos',
  'eleve seu negocio',
  'eleve sua marca',
  'transforme sua jornada',
  'experiencia unica',
  'experiencia a perfeicao',
  'sem comprometimentos',
  'a perfeicao em',
  'revolucione',
  'potencialize seus resultados',
  'conte com a gente',
  'sua satisfacao e nossa prioridade',
  'compromisso com a qualidade',
  'do seu jeito',
  'venha para',
  'o futuro chegou',
  'muito mais que',
];

export interface CopyAssessment {
  /** true quando a copy é dominada por clichê e não ancora em nada específico. */
  generic: boolean;
  /** Clichês encontrados (o que faz a copy servir pra qualquer marca). */
  hits: string[];
  /** true quando há âncora concreta: número, termo de marca, especificidade. */
  hasSpecificAnchor: boolean;
  /** Motivo legível, pra o replan escolher o que corrigir. */
  reason: string | null;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface AssessCopyOptions {
  /** Termos da marca/cliente que, se citados, contam como âncora específica. */
  brandTerms?: string[];
}

/**
 * Avalia uma copy contra o teste de genericidade (§74). Conservadora de
 * propósito: só marca `generic` quando o sinal é forte, pra não reprovar
 * criação boa e virar ruído no loop.
 */
export function assessCreativeCopy(text: string, options: AssessCopyOptions = {}): CopyAssessment {
  const flat = normalize(text);
  const hits = GENERIC_PHRASES.filter((phrase) => flat.includes(phrase));

  const brandTerms = (options.brandTerms ?? []).map(normalize).filter((t) => t.length >= 3);
  const mentionsBrand = brandTerms.some((term) => flat.includes(term));
  // Número NÃO resgata copy com clichê. Medido ao vivo: os modelos inventaram
  // "2023" e "30 minutos por dia" (nenhum dos dois estava no briefing) e esses
  // números faziam a copy parecer ancorada. Número inventado é pior que frase
  // vaga — vira fato falso. Só menção de MARCA sustenta especificidade aqui;
  // o número continua reportado pra quem lê o assessment.
  const hasSpecificAnchor = mentionsBrand;

  const words = countWords(text);

  // Genérica quando: (a) dois ou mais clichês, OU (b) um clichê numa copy curta
  // sem menção de marca. Um clichê isolado numa copy longa que cita a marca NÃO
  // reprova — entrega específica com um clichê perdido não vira replan à toa.
  const generic = !hasSpecificAnchor && (hits.length >= 2 || (hits.length >= 1 && words <= 14));

  const reason = generic
    ? `copy genérica que serviria para qualquer marca (clichê: ${hits.join(', ')})${hasSpecificAnchor ? '' : '; sem âncora concreta (marca ou número)'}`
    : null;

  return { generic, hits, hasSpecificAnchor, reason };
}
