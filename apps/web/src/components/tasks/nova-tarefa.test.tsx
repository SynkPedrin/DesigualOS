import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mutate = vi.fn();
let workspace: { isPending: boolean; isSuccess: boolean; isError: boolean; data?: { client: { clickupListId: string | null } } } = { isPending: false, isSuccess: false, isError: false };

vi.mock('@/hooks/use-clients', () => ({
  useClients: () => ({ isPending: false, data: [{ id: 'c1', name: 'Colormaq', natureza: 'CLIENTE' }, { id: 'f1', name: 'Fixture', natureza: 'FIXTURE' }] }),
}));
vi.mock('@/hooks/use-client-workspace', () => ({ useClientWorkspace: () => workspace }));
vi.mock('@/hooks/use-create-clickup-task', () => ({
  useCreateClickUpTask: () => ({ mutate, reset: vi.fn(), isPending: false, isSuccess: false, error: null, data: undefined }),
}));

import { BotaoNovaTarefa, prazoDoDia } from './nova-tarefa';

function abrir() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  act(() => createRoot(div).render(<BotaoNovaTarefa />));
  act(() => { (div.querySelector('button') as HTMLButtonElement).click(); });
}
function mudar(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, valor: string) {
  const proto = Object.getPrototypeOf(el) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valor);
  act(() => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}

beforeEach(() => { mutate.mockClear(); workspace = { isPending: false, isSuccess: false, isError: false }; });
afterEach(() => { document.body.innerHTML = ''; });

describe('prazoDoDia', () => {
  it('data escolhida vira meio-dia local, e vazio vira sem prazo', () => {
    expect(new Date(prazoDoDia('2026-10-27')!).getHours()).toBe(12);
    expect(prazoDoDia('')).toBeUndefined();
    expect(prazoDoDia('27/10/2026')).toBeUndefined();
  });
});

describe('Nova tarefa', () => {
  it('abre o diálogo, lista clientes (sem fixture) e só habilita com cliente de lista vinculada + título', () => {
    abrir();
    const dlg = document.querySelector('[role=dialog]')!;
    expect(dlg).not.toBeNull();
    const opcoes = [...dlg.querySelectorAll('select[aria-label=Cliente] option')].map((o) => o.textContent);
    expect(opcoes).toContain('Colormaq');
    expect(opcoes).not.toContain('Fixture');
    const enviar = dlg.querySelector('button[type=submit]') as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
  });

  it('cliente sem lista do ClickUp avisa e não deixa criar', () => {
    workspace = { isPending: false, isSuccess: true, isError: false, data: { client: { clickupListId: null } } };
    abrir();
    const dlg = document.querySelector('[role=dialog]')!;
    mudar(dlg.querySelector('select[aria-label=Cliente]') as HTMLSelectElement, 'c1');
    mudar(dlg.querySelector('input[aria-label="Título da tarefa"]') as HTMLInputElement, 'Arte do dia das crianças');
    expect(dlg.textContent).toContain('não tem lista do ClickUp vinculada');
    expect((dlg.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('com lista vinculada, envia lista, título, prioridade normal e prazo de hoje', () => {
    workspace = { isPending: false, isSuccess: true, isError: false, data: { client: { clickupListId: 'L-123' } } };
    abrir();
    const dlg = document.querySelector('[role=dialog]')!;
    mudar(dlg.querySelector('select[aria-label=Cliente]') as HTMLSelectElement, 'c1');
    mudar(dlg.querySelector('input[aria-label="Título da tarefa"]') as HTMLInputElement, '  Arte do dia das crianças ');
    const form = dlg.querySelector('form')!;
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(mutate).toHaveBeenCalledTimes(1);
    const enviado = mutate.mock.calls[0]![0] as { listId: string; name: string; priority: number; dueDate: number };
    expect(enviado.listId).toBe('L-123');
    expect(enviado.name).toBe('Arte do dia das crianças');
    expect(enviado.priority).toBe(3);
    expect(new Date(enviado.dueDate).toDateString()).toBe(new Date().toDateString());
  });
});
