import { describe, expect, it } from 'vitest';
import { chaveDedupeDeMemoria, importanciaDeMemoria, promocaoParaTipo } from './knowledge-promotion';
import { MCP_EVENT_TYPES } from './events';

describe('promocaoParaTipo — quais eventos viram memória', () => {
  it('os tipos ricos mapeiam para os kinds que as leituras já consomem', () => {
    expect(promocaoParaTipo('CLIENT_DECISION')?.kind).toBe('client.decision');
    expect(promocaoParaTipo('STRATEGY_CHANGED')?.kind).toBe('client.decision');
    expect(promocaoParaTipo('CLIENT_FEEDBACK')?.kind).toBe('client.feedback');
    expect(promocaoParaTipo('PREFERENCE_LEARNED')?.kind).toBe('client.preference');
    expect(promocaoParaTipo('PROCESS_LEARNING')?.kind).toBe('process.learning');
    expect(promocaoParaTipo('CAMPAIGN_INSIGHT')?.kind).toBe('client.fact');
  });

  it('tipo operacional puro NÃO vira memória (fica só no evento)', () => {
    for (const operacional of ['TASK_CREATED', 'TASK_UPDATED', 'TASK_COMPLETED', 'WORK_LOGGED', 'CREATIVE_CREATED', 'QA_PASSED'] as const) {
      expect(promocaoParaTipo(operacional), operacional).toBeNull();
    }
  });

  it('telemetria de tool NÃO vira memória — registro de uso não é conhecimento', () => {
    expect(MCP_EVENT_TYPES).toContain('MCP_TOOL_CALLED');
    expect(promocaoParaTipo('MCP_TOOL_CALLED')).toBeNull();
  });

  it('ciclo de vida da conexão também fica de fora', () => {
    expect(promocaoParaTipo('CONNECTION_CREATED')).toBeNull();
  });
});

describe('chaveDedupeDeMemoria — espelho do computeDedupeKey do memory-engine', () => {
  it('mesmo fato no mesmo escopo gera a mesma chave', () => {
    const a = chaveDedupeDeMemoria({ kind: 'client.preference', content: 'Prefere linguagem simples', clientId: 'c1' });
    const b = chaveDedupeDeMemoria({ kind: 'client.preference', content: 'prefere  LINGUAGEM simples!', clientId: 'c1' });
    expect(a).toBe(b);
  });

  it('mesmo texto em clientes diferentes NÃO colide', () => {
    const a = chaveDedupeDeMemoria({ kind: 'client.preference', content: 'Prefere linguagem simples', clientId: 'c1' });
    const b = chaveDedupeDeMemoria({ kind: 'client.preference', content: 'Prefere linguagem simples', clientId: 'c2' });
    expect(a).not.toBe(b);
  });

  it('kind diferente não colide', () => {
    const a = chaveDedupeDeMemoria({ kind: 'client.preference', content: 'igual', clientId: 'c1' });
    const b = chaveDedupeDeMemoria({ kind: 'client.feedback', content: 'igual', clientId: 'c1' });
    expect(a).not.toBe(b);
  });

  /**
   * Vetores travados contra o canônico: hashes produzidos por
   * `computeDedupeKey` (packages/orchestrator/src/memory-engine.ts) em
   * 01/10/2026. Se o canônico mudar o algoritmo, estes testes quebram — que é
   * exatamente a função deles: sem paridade, memória gravada pelo MCP fura a
   * deduplicação contra memória gravada pelo pipeline.
   */
  it('PARIDADE com o canônico do orchestrator (vetores fixos)', () => {
    expect(
      chaveDedupeDeMemoria({ kind: 'client.decision', content: 'Cliente aprovou o novo tom de voz da campanha.', clientId: 'c1' }),
    ).toBe('14d110d233d48aa7b1046bd2a68b03de');
    expect(
      chaveDedupeDeMemoria({ kind: 'process.learning', content: 'Reunião de kickoff sem o comercial presente sempre gera retrabalho.', clientId: null }),
    ).toBe('a632886eec6ef5b0e77019f47551c160');
  });
});

describe('importanciaDeMemoria', () => {
  it('escala monotônica e dentro de 0..1', () => {
    const valores = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map((i) => Number(importanciaDeMemoria(i as 'LOW')));
    expect(valores).toEqual([...valores].sort((a, b) => a - b));
    for (const v of valores) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
