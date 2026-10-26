import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DueDate } from './primitivas';

function montar(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(ui));
  return container;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T18:00:00Z')); // 15h em São Paulo
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('DueDate (data da tarefa no Daily Tasks)', () => {
  it('dia de hoje vira HOJE destacado, ao lado da data', () => {
    const el = montar(<DueDate tarefa={{ dueAt: '2026-10-26T15:00:00Z', completedAt: null }} />);
    expect(el.textContent).toContain('26/10/26');
    expect(el.textContent).toContain('HOJE');
    expect(el.innerHTML).toContain('bg-sinal');
  });

  it('vencida e aberta vira ATRASADA com os dias, em vermelho cheio', () => {
    const el = montar(<DueDate tarefa={{ dueAt: '2026-10-23T15:00:00Z', completedAt: null }} />);
    expect(el.textContent).toContain('ATRASADA · 3 DIAS');
    expect(el.innerHTML).toContain('bg-erro');
  });

  it('concluída nunca é urgente, por mais velha que seja a data', () => {
    const el = montar(<DueDate tarefa={{ dueAt: '2026-10-01T15:00:00Z', completedAt: '2026-10-02T10:00:00Z' }} />);
    expect(el.textContent).toContain('Feito');
    expect(el.textContent).not.toContain('ATRASADA');
  });

  it('sem data mostra só o ícone de calendário', () => {
    const el = montar(<DueDate tarefa={{ dueAt: null, completedAt: null }} />);
    expect(el.textContent).toBe('');
    expect(el.querySelector('[aria-label="Sem data"]')).not.toBeNull();
  });
});
