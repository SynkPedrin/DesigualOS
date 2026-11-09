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
    expect(href('Canva')?.getAttribute('href')).toBe('https://www.canva.com/design/abc');
    expect(href('Canva')?.getAttribute('target')).toBe('_blank');
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
  it('link do SharePoint vira selo clicável, com escape do ClickUp, parêntese no nome e dentro de negrito', () => {
    const div = montar('Pasta: https://agencia.sharepoint.com/:f:/s/Agencia\\_Desigual/E\\_x?e=1\nArte: https://agencia.sharepoint.com/:i:/r/sites/C/Arte%20(1).png?e=2\n**https://a.com/x_y**');
    const as = [...div.querySelectorAll('a')];
    expect(as.map((a) => a.getAttribute('href'))).toEqual([
      'https://agencia.sharepoint.com/:f:/s/Agencia_Desigual/E_x?e=1',
      'https://agencia.sharepoint.com/:i:/r/sites/C/Arte%20(1).png?e=2',
      'https://a.com/x_y',
    ]);
    expect(as[0]!.textContent).toBe('SharePoint · Pasta');
    expect(as[0]!.getAttribute('title')).toBe('https://agencia.sharepoint.com/:f:/s/Agencia_Desigual/E_x?e=1');
    expect(as[1]!.textContent).toBe('SharePoint · Imagem');
    expect(div.querySelector('strong a')).not.toBeNull();
  });
  it('itálico, riscado e links sem https (www., site.com.br, e-mail) também', () => {
    const div = montar('_leve_ e ~~fora~~ em www.cliente.com.br ou contato@cliente.com.br, sem mexer em arquivo_final_v2');
    expect(div.querySelector('em')?.textContent).toBe('leve');
    expect(div.querySelector('s')?.textContent).toBe('fora');
    expect([...div.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://www.cliente.com.br/', 'mailto:contato@cliente.com.br']);
    expect(div.textContent).toContain('arquivo_final_v2');
  });
});
