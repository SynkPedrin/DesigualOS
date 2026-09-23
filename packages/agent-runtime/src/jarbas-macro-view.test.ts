import { describe, expect, it } from 'vitest';
import { buildAgencyMacroView } from './jarbas-macro-view';
import {
  FIXTURE_CREATIVE_FATIGUE,
  FIXTURE_HEALTHY,
  FIXTURE_LOW_SAMPLE_NEW_CAMPAIGN,
  FIXTURE_TRACKING_FAILURE,
} from './jarbas-fixtures';

describe('buildAgencyMacroView — §44/§66: visão de vários clientes com objetivos diferentes', () => {
  it('classifica cada cliente no balde certo, sem ranquear CPL contra ROAS', () => {
    const view = buildAgencyMacroView([
      { clientId: 'a', clientName: 'Cliente A (lead gen)', objective: 'geração de leads', snapshot: FIXTURE_CREATIVE_FATIGUE },
      { clientId: 'd', clientName: 'Cliente D (tracking)', objective: 'ecommerce', snapshot: FIXTURE_TRACKING_FAILURE },
      { clientId: 'c', clientName: 'Cliente C (amostra baixa)', objective: 'geração de leads', snapshot: FIXTURE_LOW_SAMPLE_NEW_CAMPAIGN },
      { clientId: 'e', clientName: 'Cliente E (saudável)', objective: 'ecommerce', snapshot: FIXTURE_HEALTHY },
    ]);

    expect(view.attentionNow.map((e) => e.clientId)).toEqual(['a']);
    expect(view.trackingProblem.map((e) => e.clientId)).toEqual(['d']);
    expect(view.insufficientData.map((e) => e.clientId)).toEqual(['c']);
    expect(view.healthy.map((e) => e.clientId)).toEqual(['e']);
  });

  it('cada entrada carrega o próprio objetivo — nunca compara CPL de um lead-gen com ROAS de ecommerce', () => {
    const view = buildAgencyMacroView([
      { clientId: 'a', clientName: 'A', objective: 'geração de leads', snapshot: FIXTURE_CREATIVE_FATIGUE },
      { clientId: 'b', clientName: 'B', objective: 'ecommerce', snapshot: FIXTURE_HEALTHY },
    ]);
    expect(view.attentionNow[0]?.objective).toBe('geração de leads');
    expect(view.healthy[0]?.objective).toBe('ecommerce');
  });

  it('lista vazia não quebra e devolve todos os baldes vazios', () => {
    const view = buildAgencyMacroView([]);
    expect(view.attentionNow).toEqual([]);
    expect(view.healthy).toEqual([]);
  });
});
