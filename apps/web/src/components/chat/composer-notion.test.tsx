import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Composer } from './composer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 29/09/2026: o botão do Notion na barra do chat. Ele é ATALHO, não um segundo
 * mecanismo — arma a mesma menção `@notion` que a pessoa digitaria, e o
 * backend continua reconhecendo as duas formas. Um campo novo no wire seria
 * duas verdades sobre o mesmo pedido.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function montar(onSend: (texto: string, anexos?: unknown) => void): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    // O composer usa o upload de anexo (react-query) — precisa do provider.
    root!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Composer onSend={onSend as never} disabled={false} agentSelection="auto" />
      </QueryClientProvider>,
    );
  });
  return container;
}

function botaoNotion(el: HTMLElement): HTMLButtonElement {
  const b = [...el.querySelectorAll('button')].find((x) => /notion/i.test(x.getAttribute('aria-label') ?? ''));
  if (!b) throw new Error('botão do Notion não encontrado');
  return b as HTMLButtonElement;
}

function digitarEEnviar(el: HTMLElement, texto: string) {
  const area = el.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(area, texto);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe('botão do Notion na barra do chat', () => {
  it('desligado por padrão: o pedido vai sem menção nenhuma', () => {
    const onSend = vi.fn();
    const el = montar(onSend);
    digitarEEnviar(el, 'cria a task do carrossel');
    expect(onSend.mock.calls[0]?.[0]).toBe('cria a task do carrossel');
  });

  it('ligado, arma a MESMA menção que a pessoa digitaria', () => {
    const onSend = vi.fn();
    const el = montar(onSend);
    act(() => botaoNotion(el).click());
    digitarEEnviar(el, 'cria a task do carrossel');
    expect(onSend.mock.calls[0]?.[0]).toBe('@notion cria a task do carrossel');
  });

  it('não duplica quando a pessoa JÁ escreveu @notion', () => {
    const onSend = vi.fn();
    const el = montar(onSend);
    act(() => botaoNotion(el).click());
    digitarEEnviar(el, '@notion cria a task');
    expect(onSend.mock.calls[0]?.[0]).toBe('@notion cria a task');
  });

  it('desarma depois de enviar — vale pro pedido, não pra sessão', () => {
    const onSend = vi.fn();
    const el = montar(onSend);
    act(() => botaoNotion(el).click());
    digitarEEnviar(el, 'primeiro pedido');
    digitarEEnviar(el, 'segundo pedido');
    expect(onSend.mock.calls[1]?.[0]).toBe('segundo pedido');
  });

  it('o estado ligado é anunciado por leitor de tela', () => {
    const el = montar(vi.fn());
    expect(botaoNotion(el).getAttribute('aria-pressed')).toBe('false');
    act(() => botaoNotion(el).click());
    expect(botaoNotion(el).getAttribute('aria-pressed')).toBe('true');
  });
});
