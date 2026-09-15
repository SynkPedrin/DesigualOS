/**
 * research.ts — pesquisa externa REAL do Otto (§55-59), com a inteligência
 * separada do provedor. O provedor (busca/fetch) é INJETADO: em produção é a
 * ferramenta de busca real; no teste é um mock. O que vive aqui e é
 * determinístico/testável: classificação de qualidade de fonte, síntese
 * multi-fonte (nunca "primeiro resultado e pronto", §57) e a conversão de
 * achado factual em Evidence (§59), pra a inteligência criativa também ficar
 * grounded. Se não há lacuna que exija dado atual, NÃO se pesquisa (§67).
 */

export type SourceQuality = 'primary' | 'official' | 'reputable' | 'community' | 'unknown';

export interface ResearchSource {
  url: string;
  title?: string;
  snippet: string;
}

export interface ResearchFinding {
  claim: string;
  url: string;
  title: string | null;
  quality: SourceQuality;
}

export interface ResearchProvider {
  /** Busca candidatos. Deve devolver VÁRIAS fontes, não uma. */
  search(query: string): Promise<ResearchSource[]>;
}

export interface ResearchEvidence {
  type: 'web';
  source: string;
  sourceId: string;
  summary: string;
  confidence: number;
  retrievedAt: string;
}

export interface ResearchResult {
  performed: boolean;
  findings: ResearchFinding[];
  /** Síntese curta a partir das melhores fontes. */
  summary: string;
  evidence: ResearchEvidence[];
  /** true quando só uma fonte útil apareceu — o caller deve tratar com cautela (§57). */
  singleSource: boolean;
}

const QUALITY_RANK: Record<SourceQuality, number> = { primary: 0, official: 1, reputable: 2, community: 3, unknown: 4 };
const QUALITY_CONFIDENCE: Record<SourceQuality, number> = { primary: 0.95, official: 0.9, reputable: 0.8, community: 0.55, unknown: 0.4 };

const REPUTABLE_HOSTS = [
  'g1.globo.com', 'folha.uol.com.br', 'estadao.com.br', 'exame.com', 'valor.globo.com',
  'meioemensagem.com.br', 'nytimes.com', 'theguardian.com', 'bbc.com', 'reuters.com',
  'bloomberg.com', 'wired.com', 'techcrunch.com', 'hbr.org', 'mckinsey.com',
];
const COMMUNITY_HOSTS = ['reddit.com', 'quora.com', 'medium.com', 'x.com', 'twitter.com', 'facebook.com', 'linkedin.com', 'tiktok.com'];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Classifica a qualidade da fonte pelo host. Pragmático, não um crawler. */
export function classifySourceQuality(url: string): SourceQuality {
  const host = hostOf(url);
  if (host === 'gov.br' || host.endsWith('.gov.br') || /(^|\.)gov$/.test(host) || /\.gov\.[a-z]{2}$/.test(host)) return 'official';
  if (/\.edu(\.[a-z]{2})?$/.test(host) || /\.(who|un|oecd)\.int$/.test(host)) return 'primary';
  if (REPUTABLE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'reputable';
  if (COMMUNITY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'community';
  return 'unknown';
}

/**
 * Sintetiza várias fontes numa leitura só: ordena por qualidade, dedup por
 * host, e monta a síntese com as melhores. NÃO usa só a primeira (§57).
 */
export function synthesizeFindings(sources: ResearchSource[], opts: { max?: number } = {}): { findings: ResearchFinding[]; summary: string; singleSource: boolean } {
  const max = opts.max ?? 5;
  const seenHost = new Set<string>();
  const findings: ResearchFinding[] = [];
  for (const s of sources) {
    const host = hostOf(s.url);
    if (seenHost.has(host)) continue; // dedup por veículo
    seenHost.add(host);
    findings.push({ claim: s.snippet.trim(), url: s.url, title: s.title ?? null, quality: classifySourceQuality(s.url) });
  }
  findings.sort((a, b) => QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality]);
  const top = findings.slice(0, max);
  const summary = top.map((f) => `- (${f.quality}) ${f.claim}${f.title ? ` [${f.title}]` : ''}`).join('\n');
  return { findings: top, summary, singleSource: top.length <= 1 };
}

/** Achado factual externo vira Evidence (§59), com confiança pela qualidade da fonte. */
export function researchToEvidence(findings: ResearchFinding[], now: Date = new Date()): ResearchEvidence[] {
  const iso = now.toISOString();
  return findings.map((f) => ({
    type: 'web' as const,
    source: hostOf(f.url),
    sourceId: f.url,
    summary: f.claim.slice(0, 240),
    confidence: QUALITY_CONFIDENCE[f.quality],
    retrievedAt: iso,
  }));
}

/**
 * Orquestra a pesquisa: só roda quando `shouldResearch` é true (§67); busca,
 * classifica, sintetiza e gera evidência. Não lança — falha vira resultado
 * vazio marcado como não realizado, e o caller decide seguir sem pesquisa.
 */
export async function runResearch(
  provider: ResearchProvider,
  question: string,
  opts: { shouldResearch: boolean; max?: number; now?: Date } = { shouldResearch: true },
): Promise<ResearchResult> {
  if (!opts.shouldResearch) {
    return { performed: false, findings: [], summary: '', evidence: [], singleSource: false };
  }
  let sources: ResearchSource[] = [];
  try {
    sources = await provider.search(question);
  } catch {
    return { performed: false, findings: [], summary: '', evidence: [], singleSource: false };
  }
  const { findings, summary, singleSource } = synthesizeFindings(sources, { ...(opts.max ? { max: opts.max } : {}) });
  return { performed: true, findings, summary, evidence: researchToEvidence(findings, opts.now ?? new Date()), singleSource };
}
