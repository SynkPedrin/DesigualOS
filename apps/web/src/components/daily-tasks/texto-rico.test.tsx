import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TextoRico } from './texto-rico';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const montar = (texto: string) => { const div = document.createElement('div'); act(() => createRoot(div).render(<TextoRico texto={texto} />)); return div; };

describe('TextoRico', () => {
  it('transforma links soltos e em markdown em âncoras clicáveis, sem aceitar javascript:', () => {
    const div = montar('Veja https://www.canva.com/design/abc e [a pasta](https://drive.google.com/x)\n[perigo](javascript:alert(1)) e [DT-9](/daily-tasks?task=U1)');
    const as = [...div.querySelectorAll('a')];
    const href = (txt: string) => as.find((a) => a.textContent?.includes(txt));
    expect(href('canva.com')?.getAttribute('href')).toBe('https://www.canva.com/design/abc');
    expect(href('canva.com')?.getAttribute('target')).toBe('_blank');
    expect(href('a pasta')?.getAttribute('href')).toBe('https://drive.google.com/x');
    expect(href('DT-9')?.getAttribute('href')).toBe('/daily-tasks?task=U1');
    expect(href('DT-9')?.getAttribute('target')).toBeNull();
    expect(as.some((a) => a.getAttribute('href')?.startsWith('javascript'))).toBe(false);
  });
  it('não engole a pontuação final do endereço e mostra listas, negrito e escapes do ClickUp', () => {
    const div = montar('Acesse https://a.com/x.\n- item **forte**\n1\\. passo');
    expect(div.querySelector('a')?.getAttribute('href')).toBe('https://a.com/x');
    expect(div.querySelector('strong')?.textContent).toBe('forte');
    expect(div.textContent).toMatch(/1\.\s*passo/);
  });
});
