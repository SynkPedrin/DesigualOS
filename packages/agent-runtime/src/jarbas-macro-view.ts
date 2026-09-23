import type { CampaignMetricSnapshot } from './jarbas-diagnosis';
import { diagnoseCampaignSnapshot } from './jarbas-diagnosis';

/**
 * jarbas-macro-view.ts — visão agência (§28-30/§44-45).
 *
 * Puro, offline. Recebe um snapshot por cliente (mesmo shape usado pra
 * diagnóstico individual — reaproveitado, não uma segunda árvore) e
 * classifica em 5 baldes. Nunca ranqueia CPL contra ROAS — cada cliente é
 * julgado contra a PRÓPRIA árvore de diagnóstico, nunca contra o vizinho.
 */

export interface ClientMacroInput {
  clientId: string;
  clientName: string;
  objective: string;
  snapshot: CampaignMetricSnapshot;
}

export type MacroBucket = 'attention_now' | 'watch' | 'healthy' | 'insufficient_data' | 'tracking_problem';

export interface ClientMacroEntry {
  clientId: string;
  clientName: string;
  objective: string;
  bucket: MacroBucket;
  headline: string;
}

export interface AgencyMacroView {
  attentionNow: ClientMacroEntry[];
  watch: ClientMacroEntry[];
  healthy: ClientMacroEntry[];
  insufficientData: ClientMacroEntry[];
  trackingProblem: ClientMacroEntry[];
}

function classifyBucket(diagClass: ReturnType<typeof diagnoseCampaignSnapshot>['class']): MacroBucket {
  switch (diagClass) {
    case 'tracking_problem':
      return 'tracking_problem';
    case 'insufficient_sample':
      return 'insufficient_data';
    case 'creative_fatigue_hypothesis':
    case 'post_click_issue_hypothesis':
      return 'attention_now';
    case 'healthy':
      return 'healthy';
  }
}

export function buildAgencyMacroView(clients: ClientMacroInput[]): AgencyMacroView {
  const view: AgencyMacroView = { attentionNow: [], watch: [], healthy: [], insufficientData: [], trackingProblem: [] };
  for (const client of clients) {
    const diag = diagnoseCampaignSnapshot(client.snapshot);
    const bucket = classifyBucket(diag.class);
    // Diagnóstico "saudável" mas com observações presentes (sinal fraco,
    // não um dos dois padrões nomeados) desce pra WATCH, não fica em
    // HEALTHY nem sobe pra ATTENTION_NOW — é o "meio-termo" que a árvore
    // de diagnóstico individual não precisa nomear, mas a visão macro sim.
    const bucketFinal: MacroBucket = bucket === 'healthy' && diag.observations.length > 0 && diag.confidence === 'medium' ? 'watch' : bucket;
    const entry: ClientMacroEntry = {
      clientId: client.clientId,
      clientName: client.clientName,
      objective: client.objective,
      bucket: bucketFinal,
      headline: diag.hypotheses[0] ?? diag.observations[0] ?? 'sem observação relevante no período',
    };
    switch (bucketFinal) {
      case 'attention_now': view.attentionNow.push(entry); break;
      case 'watch': view.watch.push(entry); break;
      case 'healthy': view.healthy.push(entry); break;
      case 'insufficient_data': view.insufficientData.push(entry); break;
      case 'tracking_problem': view.trackingProblem.push(entry); break;
    }
  }
  return view;
}
