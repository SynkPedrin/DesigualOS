import { describe, it, expect } from 'vitest';
import { verifyTaskState, findDuplicateTask, normalizeTaskName, type ExpectedTaskState } from './task-verification';
import type { TaskDetail } from './clickup-client';

const base: TaskDetail = {
  id: '1',
  name: 'Pedro Gabriel - Boas-vindas',
  status: 'aberto',
  priority: null,
  dueDate: 1_000_000,
  listId: 'L1',
  assignees: [{ id: 42, username: 'pedro' }],
  description: '',
  attachments: [],
};

describe('normalizeTaskName', () => {
  it('ignora acento, caixa e espaço', () => {
    expect(normalizeTaskName('  PEDRO   Gabriel — Boas-Vindas ')).toBe('pedro gabriel — boas-vindas');
  });
});

describe('verifyTaskState (read-back, seção 32)', () => {
  it('aprova quando nome, responsável e prazo batem', () => {
    const v = verifyTaskState(base, { name: 'pedro gabriel - boas-vindas', assigneeIds: [42], dueDate: 1_000_000 });
    expect(v.ok).toBe(true);
    expect(v.checked).toEqual(['nome', 'responsável', 'prazo']);
    expect(v.mismatches).toEqual([]);
  });

  it('reprova quando o responsável prometido não está na task', () => {
    const v = verifyTaskState(base, { assigneeIds: [99] });
    expect(v.ok).toBe(false);
    expect(v.mismatches.join(' ')).toContain('não constam');
  });

  it('reprova prazo divergente e aprova dentro da tolerância', () => {
    expect(verifyTaskState(base, { dueDate: 2_000_000 }).ok).toBe(false);
    expect(verifyTaskState(base, { dueDate: 1_030_000, dueDateToleranceMs: 60_000 }).ok).toBe(true);
  });

  it('null significa esperar sem prazo', () => {
    expect(verifyTaskState(base, { dueDate: null }).ok).toBe(false);
    expect(verifyTaskState({ ...base, dueDate: null }, { dueDate: null }).ok).toBe(true);
  });

  it('confere status (read-back de mudança de status)', () => {
    expect(verifyTaskState(base, { status: 'aberto' }).ok).toBe(true);
    expect(verifyTaskState(base, { status: 'concluído' }).ok).toBe(false);
  });

  it('só confere os campos pedidos', () => {
    const expected: ExpectedTaskState = { name: 'Pedro Gabriel - Boas-vindas' };
    const v = verifyTaskState(base, expected);
    expect(v.ok).toBe(true);
    expect(v.checked).toEqual(['nome']);
  });
});

describe('findDuplicateTask (idempotência, seção 33)', () => {
  it('acha duplicata por nome normalizado', () => {
    const dup = findDuplicateTask(
      [{ id: 'a', name: 'Boas Vindas' }, { id: 'b', name: 'PEDRO GABRIEL - Boas-vindas' }],
      'pedro gabriel - boas-vindas',
    );
    expect(dup?.id).toBe('b');
  });
  it('retorna null quando não há duplicata', () => {
    expect(findDuplicateTask([{ id: 'a', name: 'Outra' }], 'boas-vindas')).toBeNull();
  });
});

/**
 * Regressão do release gate (15/09/2026): o ClickUp normaliza prazo sem hora,
 * então comparar instante marcava divergência em toda task criada com
 * "vencimento hoje".
 */
describe('prazo com granularidade de dia', () => {
  const base = { id: 't1', name: 'X', status: null, assignees: [], dueDate: null } as unknown as Parameters<typeof verifyTaskState>[0];
  const dia = (iso: string) => new Date(iso).getTime();

  it('mesmo dia, hora diferente: PASSA com granularity day', () => {
    const actual = { ...base, dueDate: dia('2026-09-15T04:00:00') };
    const r = verifyTaskState(actual, { dueDate: dia('2026-09-15T23:59:59.999'), dueDateGranularity: 'day' });
    expect(r.ok).toBe(true);
  });

  it('mesmo dia, hora diferente: REPROVA no modo exact (comportamento antigo intacto)', () => {
    const actual = { ...base, dueDate: dia('2026-09-15T04:00:00') };
    expect(verifyTaskState(actual, { dueDate: dia('2026-09-15T23:59:59.999') }).ok).toBe(false);
  });

  it('dia diferente reprova mesmo com granularity day', () => {
    const actual = { ...base, dueDate: dia('2026-09-16T10:00:00') };
    const r = verifyTaskState(actual, { dueDate: dia('2026-09-15T23:59:59.999'), dueDateGranularity: 'day' });
    expect(r.ok).toBe(false);
    expect(r.mismatches[0]).toContain('15/09/2026');
  });

  it('sem prazo na task continua reprovando', () => {
    const r = verifyTaskState(base, { dueDate: dia('2026-09-15T23:59:59.999'), dueDateGranularity: 'day' });
    expect(r.ok).toBe(false);
  });
});
