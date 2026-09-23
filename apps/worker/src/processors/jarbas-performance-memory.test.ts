import { describe, expect, it, vi } from 'vitest';
import type { PerformanceMemoryEvent } from '@desigual-os/types';

const mockRememberFact = vi.fn(async () => ({ status: 'created' as const, memoryId: 'mem-1' }));

vi.mock('@desigual-os/orchestrator', () => ({ rememberFact: mockRememberFact }));

/**
 * jarbas-performance-memory.test.ts — prova que o adaptador chama o motor
 * REAL de memória (mockado aqui só pra não tocar banco em teste, igual
 * todo outro teste deste diretório) com os campos certos — nunca grava
 * texto de chat solto, sempre um dos eventos nomeados do contrato.
 */

function baseEvent(overrides: Partial<PerformanceMemoryEvent> = {}): PerformanceMemoryEvent {
  return {
    organizationId: 'org-1',
    clientId: 'cliente-a',
    entityType: 'campaign',
    entityId: 'camp-1',
    eventType: 'hypothesis_rejected',
    observation: 'CTR caiu, frequência subiu',
    hypothesis: 'fadiga de criativo',
    confidence: 'medium',
    sourceRefs: ['task-1'],
    createdAt: '2026-09-24T10:00:00Z',
    ...overrides,
  };
}

describe('toRememberInput / recordPerformanceMemory — reaproveita o motor real (§17-22)', () => {
  it('mapeia kind como jarbas.<eventType>, nunca um kind genérico', async () => {
    const { toRememberInput } = await import('./jarbas-performance-memory');
    const input = toRememberInput(baseEvent());
    expect(input.kind).toBe('jarbas.hypothesis_rejected');
  });

  it('subject inclui cliente + entidade + tipo — hipótese REJEITADA da mesma entidade aposenta a anterior (§21)', async () => {
    const { toRememberInput } = await import('./jarbas-performance-memory');
    const rejeicao1 = toRememberInput(baseEvent({ hypothesis: 'fadiga de criativo' }));
    const rejeicao2 = toRememberInput(baseEvent({ hypothesis: 'problema de tracking' }));
    // MESMO subject: a segunda rejeição sobre a MESMA entidade/tipo de
    // evento se torna a versão vigente (supersessão do memory-engine real,
    // não reimplementada aqui).
    expect(rejeicao1.subject).toBe(rejeicao2.subject);
    expect(rejeicao1.subject).toContain('cliente-a');
    expect(rejeicao1.subject).toContain('camp-1');
  });

  it('eventos sobre entidades DIFERENTES nunca compartilham subject — não se apagam um ao outro', async () => {
    const { toRememberInput } = await import('./jarbas-performance-memory');
    const a = toRememberInput(baseEvent({ entityId: 'camp-1' }));
    const b = toRememberInput(baseEvent({ entityId: 'camp-2' }));
    expect(a.subject).not.toBe(b.subject);
  });

  it('agentId sempre "jarbas", sourceType sempre "agent" — nunca confundido com fato dito pelo usuário', async () => {
    const { toRememberInput } = await import('./jarbas-performance-memory');
    const input = toRememberInput(baseEvent());
    expect(input.agentId).toBe('jarbas');
    expect(input.sourceType).toBe('agent');
  });

  it('confidence do evento vira um número determinístico, nunca a palavra solta', async () => {
    const { toRememberInput } = await import('./jarbas-performance-memory');
    expect(toRememberInput(baseEvent({ confidence: 'high' })).confidence).toBe(0.9);
    expect(toRememberInput(baseEvent({ confidence: 'low' })).confidence).toBe(0.3);
  });

  it('recordPerformanceMemory chama rememberFact (o motor real) com o input mapeado', async () => {
    mockRememberFact.mockClear();
    const { recordPerformanceMemory } = await import('./jarbas-performance-memory');
    const evento = baseEvent();
    await recordPerformanceMemory(evento);
    expect(mockRememberFact).toHaveBeenCalledTimes(1);
    const [chamado] = mockRememberFact.mock.calls[0] as unknown as [{ kind: string; clientId: string }];
    expect(chamado.kind).toBe('jarbas.hypothesis_rejected');
    expect(chamado.clientId).toBe('cliente-a');
  });

  it('conteúdo junta observação + hipótese, nunca frase de chat crua', async () => {
    const { toRememberInput } = await import('./jarbas-performance-memory');
    const input = toRememberInput(baseEvent({ observation: 'CTR caiu 18%', hypothesis: 'fadiga de criativo' }));
    expect(input.content).toContain('CTR caiu 18%');
    expect(input.content).toContain('fadiga de criativo');
  });
});
