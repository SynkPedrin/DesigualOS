import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./bento-action-guard', () => ({ loadSelectionSnapshot: vi.fn() }));

import { loadSelectionSnapshot } from './bento-action-guard.js';
import { resolveFromLegacySelectionSnapshot } from './bento-legacy-selection-bridge.js';
import type { SelectionSnapshot, SelectedTaskRef } from '@desigual-os/context-engine';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

function task(over: Partial<SelectedTaskRef> = {}): SelectedTaskRef {
  return {
    id: 'task-x',
    title: 'Task genérica',
    clientName: 'D. Carvalho',
    listId: 'list-1',
    assignees: ['Bruna Baldacini'],
    dueDate: null,
    status: 'aberto',
    priority: 'normal',
    url: 'https://app.clickup.com/t/task-x',
    ...over,
  };
}

/** 15 tasks — item 11 (index 10) é a DC_Agrishow real do incidente. */
function fifteenTaskSnapshot(): SelectionSnapshot {
  const tasks = Array.from({ length: 15 }, (_, i) =>
    task({
      id: `t${i + 1}`,
      title: i === 10 ? 'DC_Agrishow_Edições_Pacotes Pós-Vendas' : `Task ${i + 1}`,
      dueDate: i === 10 ? 1780000000000 : null,
    }),
  );
  return {
    version: 1,
    reason: 'operational_listing',
    reasonLabel: 'tasks abertas da D. Carvalho',
    source: 'clickup_operational_tasks',
    capturedAt: new Date().toISOString(),
    tasks,
    focusTaskId: null,
  };
}

describe('resolveFromLegacySelectionSnapshot — P0 25/09/2026 (item 11)', () => {
  beforeEach(() => vi.mocked(loadSelectionSnapshot).mockReset());

  it('TESTE 1: "altere o item 11 para 28 de setembro" resolve pro id real do display_index 11, nunca faz lookup por "11"', async () => {
    vi.mocked(loadSelectionSnapshot).mockResolvedValue(fifteenTaskSnapshot());
    const result = await resolveFromLegacySelectionSnapshot('conv-1', 'altere o item 11 para 28 de setembro', fakeLogger);
    expect(result?.resource.resourceId).toBe('t11');
    expect(result?.resource.title).toBe('DC_Agrishow_Edições_Pacotes Pós-Vendas');
    expect(result?.resource.resourceId).not.toBe('11');
  });

  it('TESTE 3: "mude o item 3" resolve o índice 3 da lista', async () => {
    vi.mocked(loadSelectionSnapshot).mockResolvedValue(fifteenTaskSnapshot());
    const result = await resolveFromLegacySelectionSnapshot('conv-1', 'mude o item 3', fakeLogger);
    expect(result?.resource.resourceId).toBe('t3');
  });

  it('TESTE 4: uma lista NOVA substitui a anterior — "item 3" usa a lista atual, não uma antiga (garantido por loadSelectionSnapshot sempre ler a mais recente)', async () => {
    const listaNova: SelectionSnapshot = { ...fifteenTaskSnapshot(), tasks: [task({ id: 'novo-1' }), task({ id: 'novo-2' }), task({ id: 'novo-3', title: 'Task da lista nova' })] };
    vi.mocked(loadSelectionSnapshot).mockResolvedValue(listaNova);
    const result = await resolveFromLegacySelectionSnapshot('conv-1', 'item 3', fakeLogger);
    expect(result?.resource.resourceId).toBe('novo-3');
  });

  it('TESTE 5: índice inexistente ("item 99") não resolve — chamador deve pedir esclarecimento, nunca mutar', async () => {
    vi.mocked(loadSelectionSnapshot).mockResolvedValue(fifteenTaskSnapshot());
    const result = await resolveFromLegacySelectionSnapshot('conv-1', 'item 99', fakeLogger);
    expect(result).toBeNull();
  });

  it('TESTE 6: "a décima primeira" (ordinal por extenso) resolve pro mesmo item 11', async () => {
    vi.mocked(loadSelectionSnapshot).mockResolvedValue(fifteenTaskSnapshot());
    const result = await resolveFromLegacySelectionSnapshot('conv-1', 'altere a décima primeira para dia 28', fakeLogger);
    expect(result?.resource.resourceId).toBe('t11');
  });

  it('TESTE 7: referência por NOME da task resolve pra mesma resource (sem precisar de índice)', async () => {
    vi.mocked(loadSelectionSnapshot).mockResolvedValue(fifteenTaskSnapshot());
    const result = await resolveFromLegacySelectionSnapshot('conv-1', 'altere a data da DC_Agrishow_Edições_Pacotes Pós-Vendas', fakeLogger);
    expect(result?.resource.resourceId).toBe('t11');
  });

  it('sem snapshot nenhum: devolve null, nunca lança', async () => {
    vi.mocked(loadSelectionSnapshot).mockResolvedValue(null);
    const result = await resolveFromLegacySelectionSnapshot('conv-1', 'item 11', fakeLogger);
    expect(result).toBeNull();
  });

  it('mensagem sem nenhuma referência estrutural nem título mencionado: devolve null (só consulta o banco, zero LLM)', async () => {
    vi.mocked(loadSelectionSnapshot).mockResolvedValue(fifteenTaskSnapshot());
    const result = await resolveFromLegacySelectionSnapshot('conv-1', 'oi, tudo bem?', fakeLogger);
    expect(result).toBeNull();
  });
});
