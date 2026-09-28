import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./bento-action-guard', () => ({
  ehQaBot: () => false,
  podeEscreverEmProducao: () => true,
  loadSelectionSnapshot: vi.fn(),
  loadSelectionSnapshotComFallback: vi.fn(),
}));

import { loadSelectionSnapshotComFallback } from './bento-action-guard.js';
import { resolveFromLegacySelectionSnapshot } from './bento-legacy-selection-bridge.js';
import type { SelectionSnapshot, SelectedTaskRef } from '@desigual-os/context-engine';

/**
 * 28/09/2026, relato da Tammy: ela listou as tarefas da D. Carvalho num chat,
 * mexeu numa delas, ABRIU OUTRO CHAT e mandou o pedido já com o NOME da task.
 * O Bento não sabia de nada.
 *
 * Não faltava memória no sistema: `metadata.selecao` — a mesma estrutura que já
 * resolve "item 11" e nome de task — era lida SÓ dentro da conversa corrente.
 * Chat novo, leitura vazia, e a ponte determinística nem chegava a rodar.
 *
 * O que estes testes travam é o alcance E o seu limite. Nome, ordinal e
 * atributo atravessam: são âncoras que a pessoa escreveu e conferem sozinhas.
 * Dêitico e foco NÃO atravessam: "apaga essa" num chat recém-aberto apagaria a
 * task de horas antes sem nada nesta conversa apontar pra ela — ninguém diz
 * "essa" sobre o que não está à vista.
 */

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

function task(over: Partial<SelectedTaskRef> = {}): SelectedTaskRef {
  return {
    id: 'task-x', title: 'Task genérica', clientName: 'D. Carvalho', listId: 'list-1',
    assignees: ['Gui'], dueDate: null, status: 'aberto', priority: 'normal',
    url: 'https://app.clickup.com/t/task-x', ...over,
  };
}

function snapshotDaListagem(): SelectionSnapshot {
  return {
    tasks: Array.from({ length: 15 }, (_, i) =>
      task({ id: `t${i + 1}`, title: i === 12 ? 'DC_Caderno 2027_Layout' : `Task ${i + 1}` }),
    ),
    reason: 'listagem da D. Carvalho',
    focusTaskId: 't13',
  } as unknown as SelectionSnapshot;
}

const deOutraConversa = { snapshot: snapshotDaListagem(), origem: 'outra_conversa' as const };
const desteChat = { snapshot: snapshotDaListagem(), origem: 'conversa' as const };

describe('chat novo herda a memória operacional da pessoa', () => {
  beforeEach(() => vi.mocked(loadSelectionSnapshotComFallback).mockReset());

  it('o caso da Tammy: chat novo + NOME da task resolve pro id real', async () => {
    vi.mocked(loadSelectionSnapshotComFallback).mockResolvedValue(deOutraConversa);
    const r = await resolveFromLegacySelectionSnapshot(
      'conversa-nova', 'muda o prazo da DC_Caderno 2027_Layout pro dia 30', fakeLogger, 'user-tammy',
    );
    expect(r?.resource.resourceId).toBe('t13');
    expect(r?.matchedVia).toBe('name');
  });

  it('ordinal também atravessa — "o item 13" é âncora escrita pela pessoa', async () => {
    vi.mocked(loadSelectionSnapshotComFallback).mockResolvedValue(deOutraConversa);
    const r = await resolveFromLegacySelectionSnapshot('conversa-nova', 'altera o item 13', fakeLogger, 'user-tammy');
    expect(r?.resource.resourceId).toBe('t13');
  });

  it.each(['apaga essa task', 'muda ela de prazo', 'coloca o Gui nessa'])(
    '%s NÃO atravessa: pronome em chat novo não vira alvo de escrita',
    async (msg) => {
      vi.mocked(loadSelectionSnapshotComFallback).mockResolvedValue(deOutraConversa);
      expect(await resolveFromLegacySelectionSnapshot('conversa-nova', msg, fakeLogger, 'user-tammy')).toBeNull();
    },
  );

  it('dentro da conversa nada mudou: a resolução por ordinal segue igual', async () => {
    // O pronome solto nunca foi resolvido por ESTA ponte (quem resolve foco é
    // o ConversationResourceState); o que ela sempre fez é ordinal/nome, e é
    // isso que precisa continuar idêntico dentro da conversa.
    vi.mocked(loadSelectionSnapshotComFallback).mockResolvedValue(desteChat);
    const r = await resolveFromLegacySelectionSnapshot('mesma-conversa', 'altera o item 13', fakeLogger, 'user-tammy');
    expect(r?.resource.resourceId).toBe('t13');
  });

  it('sem memória nenhuma continua devolvendo null, nunca um alvo chutado', async () => {
    vi.mocked(loadSelectionSnapshotComFallback).mockResolvedValue(null);
    expect(await resolveFromLegacySelectionSnapshot('c', 'muda a DC_Caderno 2027_Layout', fakeLogger, 'u')).toBeNull();
  });

  it('o userId é repassado — sem ele a busca nem sai da conversa', async () => {
    vi.mocked(loadSelectionSnapshotComFallback).mockResolvedValue(deOutraConversa);
    await resolveFromLegacySelectionSnapshot('conversa-nova', 'altera o item 13', fakeLogger, 'user-tammy');
    expect(loadSelectionSnapshotComFallback).toHaveBeenCalledWith('conversa-nova', 'user-tammy');
  });
});
