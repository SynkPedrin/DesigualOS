/**
 * grounding.ts — claim-grounding por AFIRMAÇÃO (§20-24 da spec final).
 *
 * A Evidence Layer já garante "a resposta tem evidência". Isto vai além: separa
 * cada afirmação da resposta em FACT / INFERENCE / RECOMMENDATION e liga fato a
 * evidência. É o que permite dizer, internamente, "Cliente A é prioridade PORQUE
 * tem 4 atrasadas (evidências 1-4) e 1 campanha bloqueada (evidência 8)". Puro e
 * determinístico: nada de LLM, então é reproduzível e testável sem rede.
 */

export type ClaimType = 'fact' | 'inference' | 'recommendation';

export interface GroundedClaim {
  text: string;
  type: ClaimType;
  /** Ids das evidências que sustentam a afirmação (fato/inferência). */
  evidenceIds: string[];
  /** 0..1: fato com evidência casada = alta; sem casar = baixa; inferência = média. */
  confidence: number;
}

export interface EvidenceRef {
  id: string;
  summary: string;
}

export interface GroundingReport {
  claims: GroundedClaim[];
  /** Fatos afirmados SEM nenhuma evidência ligada — o que não pode ser dito com segurança. */
  ungroundedFacts: GroundedClaim[];
}

const RECOMMENDATION_MARKERS = /\b(recomend|sugir|sugere-se|deveria|dever[aá]|precisa|vale a pena|melhor seria|prioriz|resolver hoje|cobrar|redistribu|designar|destravar|repactuar|conv[eé]m|a[cç][aã]o recomendada|pr[oó]xima a[cç][aã]o)/i;
const INFERENCE_MARKERS = /\b(parece|aparenta|provavelmente|possivelmente|talvez|indica que|sugere que|pode estar|est[aá] a caminho de|sinal de|d[aá] a entender|estim|tende a)/i;

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Classifica UMA afirmação. Ordem importa: recomendação e inferência vencem o default fato. */
export function classifyClaimType(sentence: string): ClaimType {
  const flat = stripAccents(sentence);
  if (RECOMMENDATION_MARKERS.test(flat)) return 'recommendation';
  if (INFERENCE_MARKERS.test(flat)) return 'inference';
  return 'fact';
}

/** Quebra em afirmações (frases). Simples e estável: por ponto/;/quebra de linha. */
export function splitClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

/** Tokens salientes de uma frase: números e palavras longas (nomes próprios, termos). */
function salientTokens(sentence: string): string[] {
  const flat = stripAccents(sentence).toLowerCase();
  const numbers = flat.match(/\d+([.,]\d+)?/g) ?? [];
  const words = (flat.match(/[a-z]{5,}/g) ?? []).filter(
    (w) =>
      ![
        'tarefa', 'tarefas', 'porque', 'porem', 'ainda', 'sobre', 'assim', 'entao', 'agora',
        'cliente', 'clientes', 'campanha', 'campanhas', 'aprovacao', 'aprovacoes', 'lista', 'listas',
        'clickup', 'projeto', 'projetos', 'status', 'prazo', 'prazos',
      ].includes(w),
  );
  return [...numbers, ...words];
}

/** Números da evidência como TOKENS inteiros, não como pedaço de string. */
function numbersIn(text: string): Set<string> {
  return new Set(text.match(/\d+([.,]\d+)?/g) ?? []);
}

/**
 * Evidências cujo resumo compartilha um token saliente com a afirmação.
 *
 * NÚMERO casa por igualdade de token; PALAVRA casa por substring.
 *
 * A distinção não é preciosismo — é o que faz a checagem de contagem existir.
 * Com substring, "5" casava dentro de "15", "5 cliente(s)" e "50", então
 * QUALQUER número dado como resposta ficava "ancorado" e a régua de grounding
 * era decorativa pra todo fato quantitativo. Achado ao vivo no release gate
 * (15/09/2026): o Bento respondeu "5 tarefas vencem hoje" com 15 na evidência
 * e o grounding não acusou nada. Palavra continua por substring de propósito
 * (plural, flexão): ali o falso positivo é barato, no número não é.
 */
function linkEvidence(sentence: string, evidence: EvidenceRef[]): string[] {
  const tokens = salientTokens(sentence);
  if (tokens.length === 0) return [];
  const numericos = tokens.filter((t) => /^\d/.test(t));
  const palavras = tokens.filter((t) => !/^\d/.test(t));
  const linked: string[] = [];
  for (const ev of evidence) {
    const evFlat = stripAccents(ev.summary).toLowerCase();
    const evNumeros = numbersIn(evFlat);
    const casou = palavras.some((t) => evFlat.includes(t)) || numericos.some((t) => evNumeros.has(t));
    if (casou) linked.push(ev.id);
  }
  return linked;
}

/**
 * Aterra a resposta: cada afirmação vira um GroundedClaim. Fato ganha confiança
 * alta só quando há evidência ligada; sem evidência ligada, é fato NÃO ancorado
 * (confiança baixa) — exatamente o que não pode ser afirmado com segurança (§24).
 */
export function groundClaims(text: string, evidence: EvidenceRef[]): GroundingReport {
  const claims: GroundedClaim[] = [];
  for (const sentence of splitClaims(text)) {
    const type = classifyClaimType(sentence);
    if (type === 'recommendation') {
      // Recomendação deriva do estado; não exige evidência direta 1:1.
      claims.push({ text: sentence, type, evidenceIds: [], confidence: 0.6 });
      continue;
    }
    const evidenceIds = linkEvidence(sentence, evidence);
    if (type === 'inference') {
      claims.push({ text: sentence, type, evidenceIds, confidence: evidenceIds.length > 0 ? 0.6 : 0.4 });
      continue;
    }
    // fact
    claims.push({ text: sentence, type, evidenceIds, confidence: evidenceIds.length > 0 ? 0.9 : 0.3 });
  }
  const ungroundedFacts = claims.filter((c) => c.type === 'fact' && c.evidenceIds.length === 0);
  return { claims, ungroundedFacts };
}
