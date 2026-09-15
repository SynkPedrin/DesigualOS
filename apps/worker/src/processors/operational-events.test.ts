import { describe, expect, it, vi } from 'vitest';
import type { PendingEvent, SignalCandidate, SignalOutcome } from '@desigual-os/orchestrator';
import { normalizePendingEvent, processPendingEvents, type OperationalEventsDeps } from './operational-events';

/**
 * A ponte event store -> proatividade. O que se testa é exatamente o que não
 * existia: evento pendente vira sinal quando merece, NÃO vira quando é
 * neutro, e sempre sai da fila (processed_at) — inclusive quando falha.
 */

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Parameters<typeof processPendingEvents>[0];

function evento(overrides: Partial<PendingEvent> = {}): PendingEvent {
  return {
    id: 'evt-1',
    source: 'clickup',
    type: 'task.overdue',
    clientId: 'cli-1',
    entityType: 'task',
    entityId: 'task-abc',
    actor: null,
    payload: {},
    occurredAt: new Date('2026-09-15T12:00:00Z'),
    ...overrides,
  };
}

function makeDeps(eventos: PendingEvent[], outcome: SignalOutcome = { status: 'created', signalId: 'sig-1' }) {
  const emitidos: SignalCandidate[] = [];
  const processados: { id: string; error?: string }[] = [];
  const deps: OperationalEventsDeps = {
    claim: async () => eventos,
    emit: async (candidate) => {
      emitidos.push(candidate);
      return outcome;
    },
    markProcessed: async (id, error) => {
      processados.push(error === undefined ? { id } : { id, error });
    },
  };
  return { deps, emitidos, processados };
}

describe('normalizePendingEvent', () => {
  it('usa o nome do payload quando o produtor mandou', () => {
    const n = normalizePendingEvent(evento({ payload: { name: 'Post de setembro' } }));
    expect(n?.entityName).toBe('Post de setembro');
  });

  it('sem nome no payload deixa null: nunca inventa rótulo bonito pro id', () => {
    expect(normalizePendingEvent(evento())?.entityName).toBeNull();
  });

  it('tipo que o event-intelligence não conhece vira null', () => {
    expect(normalizePendingEvent(evento({ type: 'task.time_tracked' }))).toBeNull();
  });
});

describe('processPendingEvents', () => {
  it('task.overdue vira sinal com próxima ação', async () => {
    const { deps, emitidos, processados } = makeDeps([evento({ payload: { name: 'Entregar carrossel' } })]);

    const result = await processPendingEvents(logger, deps);

    expect(result.signalsCreated).toBe(1);
    expect(emitidos).toHaveLength(1);
    expect(emitidos[0]?.rule).toBe('event.task_overdue');
    expect(emitidos[0]?.agent).toBe('bento');
    expect(emitidos[0]?.severity).toBe('high');
    expect(emitidos[0]?.recommendedAction).toBeTruthy();
    expect(emitidos[0]?.title).toContain('Entregar carrossel');
    // Saiu da fila: sem isto o mesmo evento seria reprocessado pra sempre.
    expect(processados).toEqual([{ id: 'evt-1' }]);
  });

  it('evento neutro atualiza estado e NÃO gera alerta (sem spam)', async () => {
    const { deps, emitidos } = makeDeps([
      evento({ id: 'e1', type: 'task.completed' }),
      evento({ id: 'e2', type: 'task.created' }),
      evento({ id: 'e3', type: 'creative.approved' }),
      evento({ id: 'e4', type: 'comment.created' }),
    ]);

    const result = await processPendingEvents(logger, deps);

    expect(emitidos).toHaveLength(0);
    expect(result.stateOnly).toBe(4);
    expect(result.signalsCreated).toBe(0);
  });

  it('sinal barrado pelo cooldown do emitSignal conta como suprimido, não como criado', async () => {
    const { deps } = makeDeps([evento()], { status: 'suppressed', reason: 'cooldown' });
    const result = await processPendingEvents(logger, deps);
    expect(result.signalsCreated).toBe(0);
    expect(result.signalsSuppressed).toBe(1);
  });

  it('tipo desconhecido sai da fila em vez de travá-la', async () => {
    const { deps, emitidos, processados } = makeDeps([evento({ type: 'task.time_tracked' })]);
    const result = await processPendingEvents(logger, deps);
    expect(result.unknown).toBe(1);
    expect(emitidos).toHaveLength(0);
    expect(processados).toEqual([{ id: 'evt-1' }]);
  });

  it('falha num evento grava o erro na linha e não derruba o lote', async () => {
    const processados: { id: string; error?: string }[] = [];
    const deps: OperationalEventsDeps = {
      claim: async () => [evento({ id: 'ruim' }), evento({ id: 'bom' })],
      emit: async (c) => {
        if (c.entityId === 'task-abc' && processados.length === 0) throw new Error('banco fora');
        return { status: 'created', signalId: 's' };
      },
      markProcessed: async (id, error) => {
        processados.push(error === undefined ? { id } : { id, error });
      },
    };

    const result = await processPendingEvents(logger, deps);

    expect(processados[0]).toEqual({ id: 'ruim', error: 'banco fora' });
    // O segundo evento seguiu normalmente: um evento ruim não trava a fila.
    expect(result.signalsCreated).toBe(1);
    expect(processados[1]).toEqual({ id: 'bom' });
  });

  it('fila vazia não faz trabalho nenhum', async () => {
    const { deps, emitidos } = makeDeps([]);
    const result = await processPendingEvents(logger, deps);
    expect(result).toEqual({ claimed: 0, unknown: 0, signalsCreated: 0, signalsSuppressed: 0, stateOnly: 0 });
    expect(emitidos).toHaveLength(0);
  });

  it('erro ao LER a fila não derruba o worker', async () => {
    const deps: OperationalEventsDeps = {
      claim: async () => {
        throw new Error('redis fora');
      },
      emit: async () => ({ status: 'created', signalId: 's' }),
      markProcessed: async () => undefined,
    };
    await expect(processPendingEvents(logger, deps)).resolves.toMatchObject({ claimed: 0 });
  });
});
