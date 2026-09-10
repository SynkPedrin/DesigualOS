import { describe, expect, it } from 'vitest';
import { detectTaskSignals, type TaskForRules } from './proactivity';

/** Janela real: hoje 10/09/2026, amanhã 11/09 (fuso da operação). */
const WINDOW = {
  startOfToday: new Date('2026-09-10T03:00:00.000Z').getTime(),
  startOfTomorrow: new Date('2026-09-11T03:00:00.000Z').getTime(),
  endOfTomorrow: new Date('2026-09-12T02:59:59.999Z').getTime(),
};

function task(over: Partial<TaskForRules> = {}): TaskForRules {
  return {
    id: 't1',
    name: 'Tarefa qualquer',
    status: 'aberto',
    statusType: 'open',
    priority: null,
    dueDate: WINDOW.startOfTomorrow + 3_600_000,
    assignees: ['Ana'],
    listId: 'L1',
    clientName: '3Net',
    ...over,
  };
}

describe('detectTaskSignals', () => {
  it('entrega prioritária vencendo amanhã vira sinal (o cenário §77 do dono)', () => {
    const s = detectTaskSignals(
      [task({ priority: 'urgent', status: 'briefing', assignees: [] })],
      WINDOW,
    );
    const sinal = s.find((x) => x.rule === 'task.prioritaria_vence_amanha')!;
    expect(sinal).toBeDefined();
    expect(sinal.body).toMatch(/SEM RESPONSÁVEL/);
    expect(sinal.recommendedAction).toBeTruthy();
  });

  it('3+ prioritárias amanhã elevam a severidade', () => {
    const tres = [1, 2, 3].map((n) => task({ id: `t${n}`, name: `Tarefa ${n}`, priority: 'high' }));
    const s = detectTaskSignals(tres, WINDOW);
    expect(s.find((x) => x.rule === 'task.prioritaria_vence_amanha')!.severity).toBe('high');
  });

  it('tarefa CONCLUÍDA nunca gera sinal, mesmo prioritária e vencida', () => {
    const s = detectTaskSignals(
      [
        task({ priority: 'urgent', statusType: 'done', status: 'pronto', dueDate: WINDOW.startOfToday - 86_400_000 }),
        task({ id: 'x', priority: 'urgent', statusType: 'closed', status: 'complete' }),
      ],
      WINDOW,
    );
    expect(s).toHaveLength(0);
  });

  it('prioritária ATRASADA e ainda aberta é crítica', () => {
    const s = detectTaskSignals(
      [task({ priority: 'urgent', dueDate: WINDOW.startOfToday - 86_400_000 })],
      WINDOW,
    );
    const sinal = s.find((x) => x.rule === 'task.prioritaria_atrasada')!;
    expect(sinal.severity).toBe('critical');
  });

  it('poucas tarefas sem responsável NÃO viram alerta (evita spam)', () => {
    const poucas = [1, 2, 3].map((n) => task({ id: `t${n}`, assignees: [] }));
    const s = detectTaskSignals(poucas, WINDOW);
    expect(s.find((x) => x.rule === 'task.sem_responsavel')).toBeUndefined();
  });

  it('muitas tarefas sem responsável viram alerta', () => {
    const muitas = Array.from({ length: 22 }, (_, n) => task({ id: `t${n}`, name: `T${n}`, assignees: [], priority: null }));
    const s = detectTaskSignals(muitas, WINDOW);
    const sinal = s.find((x) => x.rule === 'task.sem_responsavel')!;
    expect(sinal.severity).toBe('high');
  });

  it('operação saudável não gera sinal nenhum (proatividade não é spam)', () => {
    const s = detectTaskSignals([task({ priority: null, assignees: ['Ana'] })], WINDOW);
    expect(s).toHaveLength(0);
  });

  it('chave de dedup é por DIA: não repete hoje, mas volta amanhã se persistir', () => {
    const s = detectTaskSignals([task({ priority: 'urgent' })], WINDOW);
    const chave = s.find((x) => x.rule === 'task.prioritaria_vence_amanha')!.dedupeKey;
    expect(chave).toBe('prioritaria_amanha:2026-09-11');

    const amanha = {
      startOfToday: WINDOW.startOfTomorrow,
      startOfTomorrow: new Date('2026-09-12T03:00:00.000Z').getTime(),
      endOfTomorrow: new Date('2026-09-13T02:59:59.999Z').getTime(),
    };
    const s2 = detectTaskSignals([task({ priority: 'urgent', dueDate: amanha.startOfTomorrow + 3_600_000 })], amanha);
    expect(s2.find((x) => x.rule === 'task.prioritaria_vence_amanha')!.dedupeKey).toBe('prioritaria_amanha:2026-09-12');
  });

  it('todo sinal traz confiança alta e ação recomendada (nunca alerta vago)', () => {
    const s = detectTaskSignals(
      [task({ priority: 'urgent', dueDate: WINDOW.startOfToday - 86_400_000 }), task({ id: 'b', priority: 'high' })],
      WINDOW,
    );
    expect(s.length).toBeGreaterThan(0);
    for (const sinal of s) {
      expect(sinal.confidence).toBeGreaterThanOrEqual(0.9);
      expect(sinal.recommendedAction).toBeTruthy();
      expect(sinal.title.length).toBeGreaterThan(10);
    }
  });
});
