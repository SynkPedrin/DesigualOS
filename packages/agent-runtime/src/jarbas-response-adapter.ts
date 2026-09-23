import type { JarbasExternalResponseV1, JarbasExternalResponseV2 } from '@desigual-os/types';

/**
 * jarbas-response-adapter.ts — parser defensivo V1/V2 (§4/§43).
 *
 * O serviço externo fala V1 (`{answer: string}`) hoje, confirmado por
 * leitura direta de código (ver docs/coordination/JARBAS_SENIOR_HANDOFF.md).
 * Este adapter reconhece V2 estruturado SE ele algum dia chegar, e cai pro
 * legado com segurança quando não — nunca lança exceção, nunca finge que
 * uma resposta V1 tem proveniência que ela não tem.
 */

export interface AdaptedJarbasResponse {
  answer: string;
  provenanceAvailable: boolean;
  metricVerified: boolean;
  qualityTier: 'senior' | 'beta';
  v2: JarbasExternalResponseV2 | null;
}

function pareceV2(raw: unknown): raw is JarbasExternalResponseV2 {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return r.schemaVersion === '2' && typeof r.answer === 'string' && Array.isArray(r.metricFacts) && typeof r.scope === 'object' && r.scope !== null;
}

/**
 * Aceita QUALQUER coisa que a rede devolveu (string JSON, objeto já
 * parseado, ou o `{answer}` de sempre) e nunca lança — resposta
 * malformada vira legacy com `answer` vazio, não uma exceção que derruba
 * o job (§43: "Do not crash. Do not call Senior.").
 */
export function adaptJarbasResponse(raw: unknown): AdaptedJarbasResponse {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // não era JSON — trata como resposta V1 crua (o formato real de hoje).
      return { answer: raw, provenanceAvailable: false, metricVerified: false, qualityTier: 'beta', v2: null };
    }
  }

  if (pareceV2(parsed)) {
    return {
      answer: parsed.answer,
      provenanceAvailable: parsed.metricFacts.length > 0,
      // "verificado" é uma alegação de OUTRO módulo (metric-verifier rodando
      // sobre os metricFacts) — este adapter nunca se autocertifica.
      metricVerified: false,
      qualityTier: parsed.metricFacts.length > 0 ? 'senior' : 'beta',
      v2: parsed,
    };
  }

  const answer = typeof parsed === 'object' && parsed !== null && typeof (parsed as JarbasExternalResponseV1).answer === 'string' ? (parsed as JarbasExternalResponseV1).answer : typeof parsed === 'string' ? parsed : '';

  return { answer, provenanceAvailable: false, metricVerified: false, qualityTier: 'beta', v2: null };
}
