import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TextareaFormatavel } from './barra-de-formatacao';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Campo({ inicial, aoMudar }: { inicial: string; aoMudar: (v: string) => void }) {
  const [v, setV] = useState(inicial);
  return <TextareaFormatavel aria-label="campo" value={v} onChange={(e) => { setV(e.target.value); aoMudar(e.target.value); }} />;
}

function montar(inicial: string) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const estado = { valor: inicial };
  act(() => createRoot(div).render(<Campo inicial={inicial} aoMudar={(v) => { estado.valor = v; }} />));
  const el = div.querySelector('textarea')!;
  const selecionar = async (ini: number, fim: number) => {
    await act(async () => {
      el.focus();
      el.setSelectionRange(ini, fim);
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  };
  const barra = () => document.querySelector('[role=toolbar][aria-label="Formatar o texto selecionado"]');
  const clicar = (rotulo: string) => act(() => { (barra()!.querySelector(`[aria-label="${rotulo}"]`) as HTMLButtonElement).click(); });
  return { el, estado, selecionar, barra, clicar };
}

describe('barra de formatação sobre a seleção', () => {
  it('aparece com o duplo clique numa palavra e some sem seleção', async () => {
    const c = montar('olá mundo');
    expect(c.barra()).toBeNull();
    await c.selecionar(4, 9);
    expect(c.barra()).not.toBeNull();
    await c.selecionar(2, 2);
    expect(c.barra()).toBeNull();
  });

  it('negrito envolve a palavra e clicar de novo desfaz', async () => {
    const c = montar('olá mundo');
    await c.selecionar(4, 9);
    c.clicar('Negrito');
    expect(c.estado.valor).toBe('olá **mundo**');
    c.clicar('Negrito');
    expect(c.estado.valor).toBe('olá mundo');
  });

  it('deixa o espaço do duplo clique de fora, e faz itálico, riscado e código', async () => {
    const c = montar('um dois tres');
    await c.selecionar(3, 8); // "dois "
    c.clicar('Itálico');
    expect(c.estado.valor).toBe('um _dois_ tres');
    await c.selecionar(10, 14);
    c.clicar('Riscado');
    expect(c.estado.valor).toBe('um _dois_ ~~tres~~');
    await c.selecionar(0, 2);
    c.clicar('Código');
    expect(c.estado.valor).toBe('`um` _dois_ ~~tres~~');
  });

  it('atalho Ctrl/⌘+B no campo também formata', async () => {
    const c = montar('olá mundo');
    await c.selecionar(0, 3);
    act(() => { c.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, metaKey: true, bubbles: true })); });
    expect(c.estado.valor).toBe('**olá** mundo');
  });
});
