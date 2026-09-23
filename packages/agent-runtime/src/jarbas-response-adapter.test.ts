import { describe, expect, it } from 'vitest';
import { adaptJarbasResponse } from './jarbas-response-adapter';
import type { JarbasExternalResponseV2 } from '@desigual-os/types';

const V2_FIXTURE: JarbasExternalResponseV2 = {
  schemaVersion: '2',
  ok: true,
  agent: 'jarbas',
  answer: 'CTR caiu 18%, CPM ficou estável.',
  scope: { organizationId: 'org-1', clientId: 'cliente-a', accountId: 'act_1', entityType: 'campaign', entityId: 'camp-1', entityName: 'Leads Setembro', periodStart: '2026-09-17', periodEnd: '2026-09-24' },
  metricFacts: [
    { metric: 'ctr', value: 0.8, unit: 'percent', entityType: 'campaign', entityId: 'camp-1', entityName: 'Leads Setembro', clientId: 'cliente-a', accountId: 'act_1', periodStart: '2026-09-17', periodEnd: '2026-09-24', fetchedAt: '2026-09-24T10:00:00Z', source: 'meta_graph_api', provenanceId: 'mf-1' },
  ],
  comparisons: [],
  observations: ['CTR caiu 18%'],
  hypotheses: [],
  recommendations: [],
  missingData: [],
  proposedActions: [],
  sourceTrace: [],
  toolTrace: [],
  confidence: 'medium',
};

describe('adaptJarbasResponse — legado V1 (o formato real de hoje)', () => {
  it('objeto {answer} vira legacy, provenanceAvailable=false, qualityTier=beta', () => {
    const r = adaptJarbasResponse({ answer: 'CTR caiu essa semana.' });
    expect(r.answer).toBe('CTR caiu essa semana.');
    expect(r.provenanceAvailable).toBe(false);
    expect(r.qualityTier).toBe('beta');
    expect(r.v2).toBeNull();
  });

  it('string JSON de um {answer} também funciona', () => {
    const r = adaptJarbasResponse(JSON.stringify({ answer: 'texto' }));
    expect(r.answer).toBe('texto');
    expect(r.qualityTier).toBe('beta');
  });

  it('string crua, não-JSON, nunca lança — vira o próprio answer', () => {
    expect(() => adaptJarbasResponse('CTR caiu essa semana.')).not.toThrow();
    const r = adaptJarbasResponse('CTR caiu essa semana.');
    expect(r.answer).toBe('CTR caiu essa semana.');
  });

  it('payload malformado (nem objeto nem string útil) nunca lança — vira legacy vazio', () => {
    expect(() => adaptJarbasResponse(null)).not.toThrow();
    expect(() => adaptJarbasResponse(undefined)).not.toThrow();
    expect(() => adaptJarbasResponse(42)).not.toThrow();
    const r = adaptJarbasResponse({ nada: 'a ver com isso' });
    expect(r.answer).toBe('');
    expect(r.qualityTier).toBe('beta');
  });
});

describe('adaptJarbasResponse — V2 estruturado (quando/se o serviço externo passar a falar isto)', () => {
  it('reconhece o formato V2 e marca provenanceAvailable=true quando há metricFacts', () => {
    const r = adaptJarbasResponse(V2_FIXTURE);
    expect(r.v2).not.toBeNull();
    expect(r.provenanceAvailable).toBe(true);
    expect(r.qualityTier).toBe('senior');
    expect(r.answer).toBe(V2_FIXTURE.answer);
  });

  it('V2 sem metricFacts nenhum ainda não é Senior (mesmo com schemaVersion 2)', () => {
    const r = adaptJarbasResponse({ ...V2_FIXTURE, metricFacts: [] });
    expect(r.provenanceAvailable).toBe(false);
    expect(r.qualityTier).toBe('beta');
  });

  it('metricVerified nunca vem true do próprio adapter — é alegação de outro módulo (metric-verifier)', () => {
    const r = adaptJarbasResponse(V2_FIXTURE);
    expect(r.metricVerified).toBe(false);
  });
});
