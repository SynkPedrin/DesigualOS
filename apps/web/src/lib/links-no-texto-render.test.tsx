import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { textoComLinks } from './links-no-texto';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('textoComLinks na tela', () => {
  it('vira <a> que abre em aba nova, sem opener, e o clique não chega na bolha', () => {
    const div = document.createElement('div');
    const naBolha = vi.fn();
    act(() => createRoot(div).render(<p onClick={naBolha}>{textoComLinks('briefing em www.cliente.com.br/pasta, ok', 'link')}</p>));
    const a = div.querySelector('a')!;
    expect(a.textContent).toBe('www.cliente.com.br/pasta');
    expect(a.getAttribute('href')).toBe('https://www.cliente.com.br/pasta');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    a.addEventListener('click', (e) => e.preventDefault());
    act(() => a.click());
    expect(naBolha).not.toHaveBeenCalled();
    expect(div.textContent).toBe('briefing em www.cliente.com.br/pasta, ok');
  });
});
