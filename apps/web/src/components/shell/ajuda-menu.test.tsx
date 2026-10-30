import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AjudaMenu } from './ajuda-menu';

/** O "?" da barra do topo não fazia nada até 30/10/2026; no celular é o único caminho até o tutorial e o Bento. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;
const onTutorial = vi.fn();
const onBuscar = vi.fn();

beforeEach(() => {
  onTutorial.mockReset();
  onBuscar.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<AjudaMenu onTutorial={onTutorial} onBuscar={onBuscar} />));
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const abrir = () => act(() => { container!.querySelector<HTMLButtonElement>('button[aria-label="Ajuda"]')!.click(); });
const item = (texto: string) => Array.from(container!.querySelectorAll<HTMLElement>('[role=menuitem]')).find((i) => i.textContent?.includes(texto))!;

describe('AjudaMenu', () => {
  it('abre com tutorial, Bento, busca e os atalhos', () => {
    abrir();
    expect(item('Tutorial')).toBeDefined();
    expect(item('Perguntar ao Bento').getAttribute('href')).toBe('/chat');
    expect(container!.textContent).toContain('⌘/Ctrl K');
  });

  it('Tutorial e Buscar chamam quem sabe abrir cada um', () => {
    abrir();
    act(() => item('Tutorial').click());
    expect(onTutorial).toHaveBeenCalledOnce();
    abrir();
    act(() => item('Buscar em tudo').click());
    expect(onBuscar).toHaveBeenCalledOnce();
  });

  it('fecha com Esc', async () => {
    abrir();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(container!.querySelector('[role=menu]')).toBeNull();
  });
});
