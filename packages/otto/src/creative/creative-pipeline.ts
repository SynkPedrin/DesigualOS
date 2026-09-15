import { assembleCreativeState, assessCreativeReadiness, type CreativeReadiness, type CreativeStateInput } from './creative-state.js';
import { assessCreativeCopy, type CopyAssessment } from './anti-generic.js';
import { runResearch, type ResearchProvider, type ResearchResult } from '../research/research.js';

/**
 * creative-pipeline.ts — o LOOP criativo autônomo do Otto (§60, §66): estado ->
 * lacunas -> pesquisa (se preciso) -> geração -> porta de qualidade -> auto-revisão.
 * A geração é INJETADA (em produção é o node/LLM; no teste é um mock), então a
 * orquestração — inclusive a auto-revisão quando a copy sai genérica — é
 * determinística e testável sem rede. O anti-generic gate deixa de ser função
 * solta e passa a FAZER PARTE do fluxo (§66).
 */

export interface CreativeOutput {
  copy: string;
  concept?: string;
  [key: string]: unknown;
}

export interface CreativeGenerator {
  /** Gera a peça a partir do estado + pesquisa. `revisionNote` vem preenchido nas revisões. */
  generate(input: {
    state: ReturnType<typeof assembleCreativeState>;
    research: ResearchResult;
    revisionNote?: string;
  }): Promise<CreativeOutput>;
}

export interface CreativePipelineResult {
  readiness: CreativeReadiness;
  research: ResearchResult;
  output: CreativeOutput | null;
  /** Passou na porta de qualidade determinística (§65). */
  qualityPassed: boolean;
  qualityAssessment: CopyAssessment | null;
  /** Quantas auto-revisões foram feitas (§66). */
  revisions: number;
  /** Trace legível das decisões. */
  trace: string[];
}

export interface CreativePipelineDeps {
  generator: CreativeGenerator;
  researchProvider: ResearchProvider;
}

export async function runCreativePipeline(
  deps: CreativePipelineDeps,
  input: CreativeStateInput,
  opts: { maxRevisions?: number; brandTerms?: string[] } = {},
): Promise<CreativePipelineResult> {
  const maxRevisions = opts.maxRevisions ?? 2;
  const trace: string[] = [];

  // 1-2. Estado + prontidão (lacunas + necessidade de pesquisa).
  const state = assembleCreativeState(input);
  const readiness = assessCreativeReadiness(state);
  trace.push(`estado montado; lacunas: ${readiness.gaps.join(', ') || 'nenhuma'}`);

  // 3. Pesquisa externa só quando a lacuna exige dado atual (§67).
  const research = await runResearch(deps.researchProvider, state.objective, { shouldResearch: readiness.requiresResearch });
  trace.push(readiness.requiresResearch ? `pesquisa realizada: ${research.findings.length} fonte(s)` : 'sem pesquisa (não era necessária)');

  const brandTerms = opts.brandTerms ?? (state.brand?.clientId ? [state.brand.clientId] : []);

  // 4-6. Geração + porta de qualidade + auto-revisão.
  let output: CreativeOutput | null = null;
  let assessment: CopyAssessment | null = null;
  let revisions = 0;
  for (let attempt = 0; attempt <= maxRevisions; attempt += 1) {
    const revisionNote =
      attempt === 0
        ? undefined
        : `A versão anterior falhou na porta de qualidade: ${assessment?.reason ?? 'copy genérica'}. Reescreva com especificidade da marca e do público, sem clichê.`;
    output = await deps.generator.generate({ state, research, ...(revisionNote ? { revisionNote } : {}) });
    assessment = assessCreativeCopy(output.copy, { brandTerms });
    if (!assessment.generic) {
      trace.push(attempt === 0 ? 'qualidade aprovada na 1a geração' : `qualidade aprovada após ${attempt} revisão(ões)`);
      return { readiness, research, output, qualityPassed: true, qualityAssessment: assessment, revisions, trace };
    }
    revisions = attempt + 1 <= maxRevisions ? attempt + 1 : revisions;
    trace.push(`copy genérica na tentativa ${attempt + 1}: ${assessment.reason}`);
  }

  // Esgotou revisões e ainda está genérica: NÃO entrega como se estivesse ok (§66).
  trace.push('esgotou revisões sem passar na qualidade');
  return { readiness, research, output, qualityPassed: false, qualityAssessment: assessment, revisions, trace };
}
