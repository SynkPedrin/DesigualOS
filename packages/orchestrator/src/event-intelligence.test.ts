import { describe, expect, it } from 'vitest';
import { reactToEvent, signalsFromEvents, type NormalizedEvent } from './event-intelligence';

const ev = (over: Partial<NormalizedEvent> & { type: NormalizedEvent['type'] }): NormalizedEvent => ({ ...over });

describe('reactToEvent (§37-39) — nem todo evento vira mensagem', () => {
  it('task.overdue gera sinal de risco com próxima ação', () => {
    const r = reactToEvent(ev({ type: 'task.overdue', entityName: 'Layout 3Net', clientName: '3Net', entityId: 't1' }));
    expect(r.updatesState).toBe(true);
    expect(r.signal).not.toBeNull();
    expect(r.signal!.severity).toBe('high');
    expect(r.signal!.recommendedAction).toMatch(/prazo|concluir/i);
    expect(r.signal!.dedupeKey).toContain('t1');
  });

  it('creative.rejected gera sinal de revisão para o Otto', () => {
    const r = reactToEvent(ev({ type: 'creative.rejected', entityName: 'Carrossel X', clientName: 'Atlas' }));
    expect(r.signal).not.toBeNull();
    expect(r.signal!.agent).toBe('otto');
    expect(r.signal!.recommendedAction).toMatch(/revisar/i);
  });

  it('task.completed atualiza estado mas NÃO gera alerta', () => {
    const r = reactToEvent(ev({ type: 'task.completed', entityId: 't2' }));
    expect(r.updatesState).toBe(true);
    expect(r.signal).toBeNull();
  });

  it('creative.approved não gera alerta (boa notícia)', () => {
    expect(reactToEvent(ev({ type: 'creative.approved' })).signal).toBeNull();
  });

  it('eventos de mudança comuns só atualizam estado', () => {
    for (const type of ['task.created', 'task.updated', 'comment.created', 'briefing.updated', 'client.updated'] as const) {
      const r = reactToEvent(ev({ type }));
      expect(r.updatesState).toBe(true);
      expect(r.signal).toBeNull();
    }
  });

  it('CLIENT_DECISION (MCP) gera sinal usando o summary já pronto, não um template', () => {
    const r = reactToEvent(ev({ type: 'CLIENT_DECISION', summary: 'Cosentino exige aprovação interna antes do envio', clientName: 'Cosentino', entityId: 'd1' }));
    expect(r.signal).not.toBeNull();
    expect(r.signal!.agent).toBe('bento');
    expect(r.signal!.body).toBe('Cosentino exige aprovação interna antes do envio');
    expect(r.signal!.dedupeKey).toContain('d1');
  });

  it('STRATEGY_CHANGED (MCP) gera sinal de severidade alta', () => {
    const r = reactToEvent(ev({ type: 'STRATEGY_CHANGED', summary: 'Campanha Europa V muda de conceito' }));
    expect(r.signal!.severity).toBe('high');
  });

  it('CREATIVE_REJECTED (MCP) tem rule próprio, não colide com o do webhook', () => {
    const r = reactToEvent(ev({ type: 'CREATIVE_REJECTED', summary: 'Rejeitado por paleta fora do padrão' }));
    expect(r.signal!.rule).toBe('mcp.creative_rejected');
    expect(r.signal!.agent).toBe('otto');
  });

  it('ERROR_FOUND (MCP) gera sinal de severidade alta', () => {
    const r = reactToEvent(ev({ type: 'ERROR_FOUND', summary: 'Link do brief quebrado' }));
    expect(r.signal!.severity).toBe('high');
  });

  it('QA_FAILED (MCP) gera sinal', () => {
    const r = reactToEvent(ev({ type: 'QA_FAILED', summary: 'QA reprovou por CTA ausente' }));
    expect(r.signal).not.toBeNull();
  });

  it('sem summary, cai no template com label/clientSuffix — nunca fica vazio', () => {
    const r = reactToEvent(ev({ type: 'CLIENT_DECISION', entityName: 'Aprovação de briefing' }));
    expect(r.signal!.body).toContain('Aprovação de briefing');
  });

  it('signalsFromEvents filtra só os eventos que merecem alerta', () => {
    const signals = signalsFromEvents([
      ev({ type: 'task.completed' }),
      ev({ type: 'task.overdue', entityId: 'a' }),
      ev({ type: 'creative.rejected', entityId: 'b' }),
      ev({ type: 'comment.created' }),
    ]);
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.rule)).toEqual(['event.task_overdue', 'event.creative_rejected']);
  });
});
