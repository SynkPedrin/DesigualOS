import { describe, expect, it, vi } from 'vitest';
import { buildOperationalContext, type OperationalContextDeps, type OperationalTaskLike } from './build-operational-context';
import type { OperationalScope } from './resolve-scope';

const NOW = new Date('2026-09-10T04:30:00.000Z');

const CLIENTES = [
  { id: 'c-3net', name: '3Net', clickupListId: 'L-3net' },
  { id: 'c-dc', name: 'D. Carvalho', clickupListId: 'L-dc' },
  { id: 'c-semlista', name: 'Gelateria Fratelli', clickupListId: null },
];

function task(over: Partial<OperationalTaskLike> = {}): OperationalTaskLike {
  return {
    id: 't1',
    name: 'Card 22/09 - Terça do casal',
    status: 'aberto',
    statusType: 'open',
    priority: null,
    dueDate: new Date('2026-09-11T14:00:00.000Z').getTime(),
    assignees: ['Alicia'],
    listId: 'L-3net',
    listName: '3Net',
    url: null,
    ...over,
  };
}

function scope(over: Partial<OperationalScope> = {}): OperationalScope {
  return {
    kind: 'GLOBAL',
    clients: [],
    ambiguous: [],
    temporal: { from: 1789095600000, to: 1789181999999, label: 'amanha' },
    operational: true,
    comparative: false,
    briefing: false,
    confidence: 0.8,
    signals: [],
    ...over,
  };
}

function deps(over: Partial<OperationalContextDeps> = {}): OperationalContextDeps {
  return {
    listAuthorizedClients: vi.fn(async () => CLIENTES),
    queryTasks: vi.fn(async () => ({ tasks: [task()], truncated: false })),
    ...over,
  };
}

describe('buildOperationalContext', () => {
  it('não busca nada quando a pergunta não é operacional', async () => {
    const d = deps();
    const r = await buildOperationalContext(scope({ operational: false, kind: 'NONE' }), d, NOW);
    expect(r.block).toBeNull();
    expect(d.queryTasks).not.toHaveBeenCalled();
  });

  it('escopo GLOBAL consulta as listas de TODOS os clientes autorizados — nunca sem filtro', async () => {
    const d = deps();
    await buildOperationalContext(scope({ kind: 'GLOBAL' }), d, NOW);
    expect(d.queryTasks).toHaveBeenCalledWith(
      expect.objectContaining({ listIds: ['L-3net', 'L-dc'], includeClosed: false }),
    );
  });

  it('escopo de CLIENTE restringe a consulta à lista daquele cliente', async () => {
    const d = deps();
    await buildOperationalContext(
      scope({ kind: 'CLIENT', clients: [{ id: 'c-dc', name: 'D. Carvalho', slug: 'd-carvalho' }] }),
      d,
      NOW,
    );
    expect(d.queryTasks).toHaveBeenCalledWith(expect.objectContaining({ listIds: ['L-dc'] }));
  });

  it('repassa a janela temporal resolvida como filtro de vencimento', async () => {
    const d = deps();
    await buildOperationalContext(scope(), d, NOW);
    expect(d.queryTasks).toHaveBeenCalledWith(
      expect.objectContaining({ dueAfter: 1789095600000, dueBefore: 1789181999999 }),
    );
  });

  it('cliente sem lista vinculada vira falha honesta, não silêncio', async () => {
    const d = deps();
    const r = await buildOperationalContext(
      scope({ kind: 'CLIENT', clients: [{ id: 'c-semlista', name: 'Gelateria Fratelli', slug: 'f' }] }),
      d,
      NOW,
    );
    expect(r.failure).toMatch(/não tem lista do ClickUp/i);
    expect(r.block).toBeNull();
    expect(d.queryTasks).not.toHaveBeenCalled();
  });

  it('falha de integração NUNCA vira bloco: vira failure pro agente admitir', async () => {
    const d = deps({
      queryTasks: vi.fn(async () => {
        throw new Error('HTTP 429: limite de requisições atingido');
      }),
    });
    const r = await buildOperationalContext(scope(), d, NOW);
    expect(r.block).toBeNull();
    expect(r.failure).toMatch(/429/);
  });

  it('zero tarefas é resposta REAL, e o bloco diz isso explicitamente', async () => {
    const d = deps({ queryTasks: vi.fn(async () => ({ tasks: [], truncated: false })) });
    const r = await buildOperationalContext(scope(), d, NOW);
    expect(r.block).toMatch(/Nenhuma tarefa aberta/);
    expect(r.block).toMatch(/não ausência de acesso/);
    expect(r.summary?.total).toBe(0);
  });

  it('tarefa que vence HOJE nao e atrasada (bug pego com dado real)', async () => {
    // 10/09/2026 00:00 local, com "agora" as 01:30 local do mesmo dia: vence hoje, nao esta
    // atrasada. Antes do conserto isto contava como atrasada e o agente diria "13 atrasadas"
    // sobre 13 tarefas que simplesmente vencem hoje.
    const venceHoje = task({ id: 't-hoje', dueDate: new Date('2026-09-10T03:00:00.000Z').getTime() });
    const d = deps({ queryTasks: vi.fn(async () => ({ tasks: [venceHoje], truncated: false })) });
    const r = await buildOperationalContext(scope(), d, NOW);
    expect(r.summary?.overdue).toBe(0);
    expect(r.block).not.toMatch(/ATRASADA/);
  });

  it('agrupa por cliente, conta atrasadas e sem responsável', async () => {
    const atrasada = task({ id: 't-old', name: 'Antiga', dueDate: new Date('2026-09-01T12:00:00Z').getTime() });
    const semResp = task({ id: 't-nr', name: 'Sem dono', assignees: [], listId: 'L-dc', listName: 'D. Carvalho' });
    const d = deps({ queryTasks: vi.fn(async () => ({ tasks: [task(), atrasada, semResp], truncated: false })) });
    const r = await buildOperationalContext(scope(), d, NOW);
    expect(r.summary).toMatchObject({ total: 3, overdue: 1, unassigned: 1, clientsConsidered: 2 });
    expect(r.block).toMatch(/1 já passou do prazo/);
    expect(r.block).toMatch(/1 sem responsável definido/);
    expect(r.block).toMatch(/ATRASADA/);
    expect(r.block).toMatch(/resp: ninguém/);
  });

  it('marca o dado como AO VIVO e com precedência sobre memória', async () => {
    const r = await buildOperationalContext(scope(), deps(), NOW);
    expect(r.block).toMatch(/AO VIVO/);
    expect(r.block).toMatch(/valem mais que qualquer memória/i);
  });

  it('resultado truncado avisa que o número é um MÍNIMO (nunca finge total)', async () => {
    const d = deps({ queryTasks: vi.fn(async () => ({ tasks: [task()], truncated: true })) });
    const r = await buildOperationalContext(scope(), d, NOW);
    expect(r.block).toMatch(/MÍNIMO, não o total/);
    expect(r.summary?.truncated).toBe(true);
  });

  it('ordena por prioridade e depois por prazo dentro do cliente', async () => {
    const d = deps({
      queryTasks: vi.fn(async () => ({
        tasks: [
          task({ id: 'a', name: 'Normal depois', priority: 'normal', dueDate: 2_000_000_000_000 }),
          task({ id: 'b', name: 'Urgente', priority: 'urgent', dueDate: 2_100_000_000_000 }),
          task({ id: 'c', name: 'Normal antes', priority: 'normal', dueDate: 1_900_000_000_000 }),
        ],
        truncated: false,
      })),
    });
    const r = await buildOperationalContext(scope(), d, NOW);
    const linhas = r.block!.split('\n').filter((l) => l.startsWith('- '));
    expect(linhas[0]).toMatch(/Urgente/);
    expect(linhas[1]).toMatch(/Normal antes/);
    expect(linhas[2]).toMatch(/Normal depois/);
  });

  /**
   * O `prazo:` é data de entrega da tarefa. Numa tarefa chamada "Elite
   * Aniversário 70 anos" ela fica a um passo de virar "a data do aniversário" —
   * e é a única data concreta que o turno tem em mãos quando alguém pede "a
   * data exata do evento". Entregar sempre não é licença pra cravar fato.
   */
  describe('task_deadline_is_not_event_date', () => {
    it('o bloco declara que prazo de tarefa não é data de evento', async () => {
      const d = deps({
        queryTasks: vi.fn(async () => ({
          tasks: [task({ name: 'Elite Aniversário 70 anos Setembro' })],
          truncated: false,
        })),
      });
      const r = await buildOperationalContext(scope(), d, NOW);
      expect(r.block).toMatch(/PRAZO é data de entrega da TAREFA, nunca data de evento/);
      expect(r.block).toMatch(/A CONFIRMAR/);
    });

    it('e o aviso vem ANTES da listagem, onde as datas aparecem', async () => {
      const r = await buildOperationalContext(scope(), deps(), NOW);
      const linhas = r.block!.split('\n');
      const aviso = linhas.findIndex((l) => l.startsWith('PRAZO é data de entrega'));
      const primeiraTarefa = linhas.findIndex((l) => l.startsWith('- '));
      expect(aviso).toBeGreaterThan(-1);
      expect(aviso).toBeLessThan(primeiraTarefa);
    });

    it('bloco sem tarefa nenhuma não carrega o aviso: não há prazo pra confundir', async () => {
      const d = deps({ queryTasks: vi.fn(async () => ({ tasks: [], truncated: false })) });
      const r = await buildOperationalContext(scope(), d, NOW);
      expect(r.block).not.toMatch(/PRAZO é data de entrega/);
    });
  });
});
