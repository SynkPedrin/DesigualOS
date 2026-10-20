import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { tarefaConcluida } from './tarefa-concluida';
import { AgencyTaskRow } from '@/components/tasks/agency-task-row';
import type { AgencyTaskWire } from '@/lib/api/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('tarefa concluída (status reais do ClickUp da agência)', () => {
  it('pronto (done) e encerrado (closed) são concluídas; o resto não', () => {
    expect(tarefaConcluida({ status: 'pronto', status_type: 'done' })).toBe(true);
    expect(tarefaConcluida({ status: 'encerrado', status_type: 'closed' })).toBe(true);
    for (const [status, tipo] of [['aberto', 'open'], ['aguardando aprovação', 'custom'], ['alteração', 'custom'], ['reprovado', 'custom']] as const) {
      expect(tarefaConcluida({ status, status_type: tipo })).toBe(false);
    }
  });
  it('sem o tipo (evento de webhook), decide pelo nome', () => {
    expect(tarefaConcluida({ status: 'Pronto', status_type: null })).toBe(true);
    expect(tarefaConcluida({ status: 'encerrado', status_type: null })).toBe(true);
    expect(tarefaConcluida({ status: 'pronto para aprovação', status_type: null })).toBe(false);
  });

  it('linha de tarefa pronta com prazo vencido diz "concluída", nunca "atrasada"', () => {
    const base = { id: 't1', name: 'Post', status: 'pronto', status_type: 'done', due_date: Date.now() - 10 * 86_400_000, assignees: ['Ana'], tags: [], priority: null, url: null, client: null } as unknown as AgencyTaskWire;
    const div = document.createElement('div');
    act(() => createRoot(div).render(<AgencyTaskRow task={base} showClient={false} />));
    expect(div.textContent).toContain('concluída');
    expect(div.textContent).not.toContain('atrasada');
    const aberta = document.createElement('div');
    act(() => createRoot(aberta).render(<AgencyTaskRow task={{ ...base, status: 'aberto', status_type: 'open' }} showClient={false} />));
    expect(aberta.textContent).toContain('atrasada desde');
  });
});
