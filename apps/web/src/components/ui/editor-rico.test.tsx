import { act, createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { EditorRico, paraTexto, type EditorRicoHandle } from './editor-rico';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// ProseMirror pede medidas de layout que o jsdom não tem.
document.elementFromPoint = () => null;
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) });

const esperar = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function montar(inicial: string, extra: { onEnviar?: () => void } = {}) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const estado = { valor: inicial };
  const ref = createRef<EditorRicoHandle>();
  function Campo() {
    const [v, setV] = useState(inicial);
    return <EditorRico ref={ref} value={v} onChange={(t) => { setV(t); estado.valor = t; }} ariaLabel="campo" {...extra} />;
  }
  act(() => createRoot(div).render(<Campo />));
  await esperar();
  return { div, estado, ref, pm: () => div.querySelector('.ProseMirror') as HTMLElement };
}

describe('editor que formata enquanto se digita', () => {
  it('mostra negrito, itálico, riscado e link azul já no campo', async () => {
    const c = await montar('olá **forte** _leve_ ~~fora~~ e https://agencia.sharepoint.com/:f:/s/D/E?e=1');
    expect(c.pm().querySelector('strong')?.textContent).toBe('forte');
    expect(c.pm().querySelector('em')?.textContent).toBe('leve');
    expect(c.pm().querySelector('s')?.textContent).toBe('fora');
    expect(c.pm().querySelector('a')?.getAttribute('href')).toBe('https://agencia.sharepoint.com/:f:/s/D/E?e=1');
  });

  it('o que sai é o mesmo texto de sempre, sem escape à toa e com link solto', async () => {
    const c = await montar('');
    act(() => c.ref.current!.inserir('arquivo_final e 2*3 '));
    await esperar();
    act(() => c.ref.current!.formatar('negrito'));
    act(() => c.ref.current!.inserir('forte'));
    await esperar();
    expect(c.estado.valor).toBe('arquivo_final e 2*3 **forte**');
  });

  it('menção da tarefa @[Nome](id) atravessa o editor sem se perder', async () => {
    const texto = 'oi @[Ana Ribeiro](4cc7c39f-7ac4-4e84-8422-afe3c5c4fa41) tudo certo';
    const c = await montar(texto);
    act(() => c.ref.current!.focus('fim'));
    act(() => c.ref.current!.inserir('!'));
    await esperar();
    expect(c.estado.valor).toBe(`${texto}!`);
  });

  it('com onEnviar, Enter envia; a menção sendo digitada aparece em antesDoCursor', async () => {
    const onEnviar = vi.fn();
    const c = await montar('', { onEnviar });
    act(() => c.ref.current!.inserir('fala @an'));
    await esperar();
    expect(c.ref.current!.antesDoCursor()).toBe('fala @an');
    act(() => c.ref.current!.trocarAntesDoCursor(3, '@Ana '));
    await esperar();
    expect(c.estado.valor).toBe('fala @Ana');
    act(() => { c.pm().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onEnviar).toHaveBeenCalledTimes(1);
  });

  it('paraTexto: quebra simples, lista e link com nome', () => {
    expect(paraTexto('a  \nb')).toBe('a\nb');
    expect(paraTexto('- x\n- y\n\n')).toBe('- x\n- y');
    expect(paraTexto('[Pasta](https://a.com) e [https://b.com](https://b.com)')).toBe('[Pasta](https://a.com) e https://b.com');
  });
});
