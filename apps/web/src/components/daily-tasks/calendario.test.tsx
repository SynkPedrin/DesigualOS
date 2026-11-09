import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Calendario, instanteDoDia, rotuloDoDia } from './calendario';

function montar(valor: string | null, onEscolher = vi.fn()) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => createRoot(el).render(<Calendario valor={valor} onEscolher={onEscolher} />));
  return { el, onEscolher };
}

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('calendário do Daily', () => {
  it('abre no mês do dia escolhido, marca o dia e devolve o dia clicado como AAAA-MM-DD', () => {
    const { el, onEscolher } = montar('2026-11-05');
    expect(el.textContent).toContain('novembro 2026');
    expect(el.querySelector('[aria-pressed="true"]')?.textContent).toBe('5');
    act(() => (el.querySelector('[aria-label="20 nov"]') as HTMLButtonElement).click());
    expect(onEscolher).toHaveBeenCalledWith('2026-11-20');
  });

  it('navega entre meses e limpa a data', () => {
    const { el, onEscolher } = montar('2026-12-31');
    act(() => (el.querySelector('[aria-label="Mês seguinte"]') as HTMLButtonElement).click());
    expect(el.textContent).toContain('janeiro 2027');
    act(() => ([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Limpar data')) as HTMLButtonElement).click());
    expect(onEscolher).toHaveBeenCalledWith(null);
  });

  it('atalhos: Hoje e Amanhã a partir do dia de São Paulo', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T15:00:00Z'));
    const { el, onEscolher } = montar(null);
    act(() => ([...el.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Amanhã')) as HTMLButtonElement).click());
    expect(onEscolher).toHaveBeenCalledWith('2026-10-30');
  });

  it('o dia vira meio-dia de São Paulo ao salvar, e o rótulo é curto', () => {
    expect(instanteDoDia('2026-10-30')).toBe('2026-10-30T15:00:00.000Z');
    expect(instanteDoDia(null)).toBeNull();
    expect(rotuloDoDia('2026-10-30')).toMatch(/^30 out/);
  });
});
