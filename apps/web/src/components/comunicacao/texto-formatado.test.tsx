import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TextoFormatado, blocosDe } from './texto-formatado';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(texto: string, mencoes: string[] = []) {
  const div = document.createElement('div');
  act(() => createRoot(div).render(<TextoFormatado texto={texto} mencoes={mencoes} meuNome="Ana" />));
  return div;
}

describe('texto formatado da mensagem', () => {
  it('HTML vira texto: <script> e onerror aparecem escritos e não executam', () => {
    const div = render('<script>alert(1)</script> <img src=x onerror=alert(2)>');
    expect(div.querySelector('script')).toBeNull();
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toContain('<script>alert(1)</script>');
  });

  it('negrito, itálico, riscado, código e bloco de código', () => {
    const div = render('**forte** _leve_ ~~fora~~ `x = 1`\n```\nconst a = 1;\n```');
    expect(div.querySelector('strong')?.textContent).toBe('forte');
    expect(div.querySelector('em')?.textContent).toBe('leve');
    expect(div.querySelector('s')?.textContent).toBe('fora');
    expect(div.querySelector('code')?.textContent).toBe('x = 1');
    expect(div.querySelector('pre code')?.textContent).toBe('const a = 1;');
  });

  it('código protege o que tem dentro (não vira negrito nem link)', () => {
    const div = render('`**não** www.site.com`');
    expect(div.querySelector('strong')).toBeNull();
    expect(div.querySelector('a')).toBeNull();
  });

  it('listas, links e menção destacada', () => {
    expect(blocosDe('- um\n- dois\n1. primeiro').map((b) => b.tipo)).toEqual(['lista', 'lista']);
    const div = render('Oi @Ana, veja www.cliente.com.br\n- item **um**\n- item dois', ['Ana']);
    expect(div.querySelectorAll('li')).toHaveLength(2);
    expect(div.querySelector('li strong')?.textContent).toBe('um');
    expect(div.querySelector('a')?.getAttribute('href')).toBe('https://www.cliente.com.br/');
    expect([...div.querySelectorAll('span')].some((s) => s.textContent === '@Ana')).toBe(true);
  });

  it('variável_com_sublinhado não vira itálico', () => {
    expect(render('nome_do_arquivo_final.pdf').querySelector('em')).toBeNull();
  });
});
