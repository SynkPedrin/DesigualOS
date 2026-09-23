import { afterEach, describe, expect, it, vi } from 'vitest';
import { askJarbasV2 } from './jarbas-v2-client';

const CONFIG = { url: 'http://fake-shadow/internal/ask/v2', token: 'fake-token' };

afterEach(() => vi.unstubAllGlobals());

describe('askJarbasV2 — nunca cai pro legado, só ok ou unavailable (§9)', () => {
  it('timeout/erro de rede -> unavailable, nunca lança, nunca inventa um "ok" falso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed: ECONNREFUSED'); }));
    const r = await askJarbasV2(CONFIG, { text: 'oi', sessionId: 's1' });
    expect(r.status).toBe('unavailable');
    if (r.status === 'unavailable') expect(r.reason).toMatch(/ECONNREFUSED/);
  });

  it('HTTP não-ok (502) -> unavailable, nunca tenta parsear o corpo como sucesso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 502 })));
    const r = await askJarbasV2(CONFIG, { text: 'oi', sessionId: 's1' });
    expect(r.status).toBe('unavailable');
  });

  it('resposta V1-only (sem metricFacts) -> ok, mas metricVerified=false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ answer: 'texto livre' }), { status: 200 })));
    const r = await askJarbasV2(CONFIG, { text: 'oi', sessionId: 's1' });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.metricVerified).toBe(false);
      expect(r.adapted.qualityTier).toBe('beta');
    }
  });

  it('V2 com metricFacts que o verificador local reproduz -> metricVerified=true', async () => {
    const body = {
      schemaVersion: '2', ok: true, agent: 'jarbas', answer: 'CTR em 10%',
      scope: {}, comparisons: [], observations: [], hypotheses: [], recommendations: [], missingData: [], proposedActions: [], sourceTrace: [], toolTrace: [],
      confidence: 'medium',
      metricFacts: [
        { metric: 'clicks', value: 100, unit: 'count', entityType: 'campaign', entityId: 'c1', entityName: 'X', clientId: 'cl', accountId: 'act_1', periodStart: '2026-09-01', periodEnd: '2026-09-07', fetchedAt: 'x', source: 'meta_graph_api', provenanceId: 'p1' },
        { metric: 'impressions', value: 1000, unit: 'count', entityType: 'campaign', entityId: 'c1', entityName: 'X', clientId: 'cl', accountId: 'act_1', periodStart: '2026-09-01', periodEnd: '2026-09-07', fetchedAt: 'x', source: 'meta_graph_api', provenanceId: 'p2' },
        { metric: 'ctr_calculated', value: 10, unit: 'percent', entityType: 'campaign', entityId: 'c1', entityName: 'X', clientId: 'cl', accountId: 'act_1', periodStart: '2026-09-01', periodEnd: '2026-09-07', fetchedAt: 'x', source: 'meta_graph_api', provenanceId: 'p3' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const r = await askJarbasV2(CONFIG, { text: 'ctr?', sessionId: 's1' });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.metricVerified).toBe(true);
      expect(r.adapted.qualityTier).toBe('senior');
    }
  });

  it('V2 com metricFacts presentes mas CTR alegado NÃO bate com clicks/impressions -> metricVerified=false (não confia cegamente)', async () => {
    const body = {
      schemaVersion: '2', ok: true, agent: 'jarbas', answer: 'CTR em 99%',
      scope: {}, comparisons: [], observations: [], hypotheses: [], recommendations: [], missingData: [], proposedActions: [], sourceTrace: [], toolTrace: [],
      confidence: 'medium',
      metricFacts: [
        { metric: 'clicks', value: 100, unit: 'count', entityType: 'campaign', entityId: 'c1', entityName: 'X', clientId: 'cl', accountId: 'act_1', periodStart: '2026-09-01', periodEnd: '2026-09-07', fetchedAt: 'x', source: 'meta_graph_api', provenanceId: 'p1' },
        { metric: 'impressions', value: 1000, unit: 'count', entityType: 'campaign', entityId: 'c1', entityName: 'X', clientId: 'cl', accountId: 'act_1', periodStart: '2026-09-01', periodEnd: '2026-09-07', fetchedAt: 'x', source: 'meta_graph_api', provenanceId: 'p2' },
        { metric: 'ctr_calculated', value: 99, unit: 'percent', entityType: 'campaign', entityId: 'c1', entityName: 'X', clientId: 'cl', accountId: 'act_1', periodStart: '2026-09-01', periodEnd: '2026-09-07', fetchedAt: 'x', source: 'meta_graph_api', provenanceId: 'p3' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const r = await askJarbasV2(CONFIG, { text: 'ctr?', sessionId: 's1' });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.metricVerified).toBe(false);
  });
});
