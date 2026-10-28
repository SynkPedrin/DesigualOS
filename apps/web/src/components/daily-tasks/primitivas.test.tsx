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
  it('dia de hoje vira HOJE em verde cheio', () => {
    const el = montar(<DueDate tarefa={{ dueAt: '2026-10-26T15:00:00Z', completedAt: null }} />);
    expect(el.textContent).toContain('Hoje');
    expect(el.innerHTML).toContain('bg-sucesso');
  });

  it('vencida e aberta mostra a data e os dias de atraso em vermelho, numa linha só', () => {
    const el = montar(<DueDate tarefa={{ dueAt: '2026-10-23T15:00:00Z', completedAt: null }} />);
    expect(el.textContent).toContain('23/10');
    expect(el.textContent).toContain('3d');
    expect(el.innerHTML).toContain('text-red-400');
    expect(el.innerHTML).toContain('whitespace-nowrap');
  });

  it('atraso conta dias do calendário de São Paulo, não horas', () => {
    // 25/10 às 23h em SP (26/10 02h UTC) e agora 26/10 15h: venceu ontem, 1 dia.
    const el = montar(<DueDate tarefa={{ dueAt: '2026-10-26T02:00:00Z', completedAt: null }} />);
    expect(el.textContent).toContain('1d');
  });

  it('data de outro ano leva o ano', () => {
    const el = montar(<DueDate tarefa={{ dueAt: '2025-12-10T15:00:00Z', completedAt: null }} />);
    expect(el.textContent).toContain('10/12/25');
  });

  it('concluída nunca é urgente, por mais velha que seja a data', () => {
    const el = montar(<DueDate tarefa={{ dueAt: '2026-10-01T15:00:00Z', completedAt: '2026-10-02T10:00:00Z' }} />);
    expect(el.innerHTML).toContain('text-sucesso');
    expect(el.innerHTML).not.toContain('text-red-400');
  });

  it('sem data mostra só o ícone de calendário', () => {
    const el = montar(<DueDate tarefa={{ dueAt: null, completedAt: null }} />);
    expect(el.textContent).toBe('');
    expect(el.querySelector('[aria-label="Sem data"]')).not.toBeNull();
  });
});
