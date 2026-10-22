import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const eventos = vi.hoisted(() => ({ lista: [] as Array<[string, string, number | undefined]>, falhar: false }));

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => window.location.pathname }));
vi.mock('@/hooks/use-announcements', () => ({
  registrarEventoDoAnuncio: async (key: string, event: string, step?: number) => {
    eventos.lista.push([key, event, step]);
    if (eventos.falhar) throw new Error('sem rede');
    return { first: false };
  },
}));
// Sem animação no teste: o AnimatePresence segura a saída e o elemento "some" só depois.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const div = React.forwardRef<HTMLDivElement, Record<string, unknown>>(({ initial: _i, animate: _a, exit: _e, transition: _t, ...resto }, ref) => React.createElement('div', { ...resto, ref }));
  return { motion: { div }, AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) };
});

const { TourProvider, useTour, posicionar } = await import('./tour-provider');
const { TOURS } = await import('./tours');

let raiz: Root;
let caixa: HTMLDivElement;
let api: ReturnType<typeof useTour>;

function Captura() { api = useTour(); return null; }

/** Um elemento "visível" no jsdom (que mede tudo como 0×0). */
function ancora(id: string, extra: Record<string, string> = {}) {
  const el = document.createElement('button');
  el.setAttribute('data-tour-id', id);
  for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v);
  el.getBoundingClientRect = () => ({ top: 100, left: 40, width: 120, height: 32, right: 160, bottom: 132, x: 40, y: 100, toJSON: () => ({}) });
  el.scrollIntoView = () => {};
  document.body.appendChild(el);
  return el;
}

const tour = () => document.querySelector('[data-testid="tour"]');
const texto = () => document.querySelector('[role="dialog"]')?.textContent ?? '';
const botao = (nome: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === nome || b.getAttribute('aria-label') === nome)!;
const esperar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  eventos.lista = []; eventos.falhar = false;
  router.push.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/today');
  caixa = document.createElement('div');
  document.body.appendChild(caixa);
  raiz = createRoot(caixa);
  act(() => raiz.render(<TourProvider><Captura /></TourProvider>));
});

afterEach(() => {
  act(() => raiz.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('motor do tutorial', () => {
  it('inicia, destaca o elemento real e grava o começo no anúncio', async () => {
    ancora('nav-comunicacao');
    act(() => api.iniciar('communication_hub_v1'));
    await esperar(200);
    expect(tour()).not.toBeNull();
    expect(texto()).toContain('Etapa 1 de 6');
    expect(texto()).toContain('Tudo começa aqui');
    expect(eventos.lista[0]).toEqual(['communication_hub_launch_v1', 'started', 0]);
  });

  it('próximo navega para a rota da etapa; anterior volta; a etapa é gravada', async () => {
    ancora('nav-comunicacao');
    act(() => api.iniciar('communication_hub_v1'));
    await esperar(200);
    act(() => botao('Próximo').click());
    await esperar(50);
    expect(router.push).toHaveBeenCalledWith('/comunicacao?lista=1', { scroll: false });
    expect(texto()).toContain('Converse com toda a equipe');
    expect(eventos.lista.at(-1)).toEqual(['communication_hub_launch_v1', 'step', 1]);
    act(() => botao('Anterior').click());
    await esperar(50);
    expect(texto()).toContain('Tudo começa aqui');
  });

  it('elemento que não existe não trava: depois da espera a etapa aparece no meio, com o texto', async () => {
    act(() => api.iniciar('communication_hub_v1'));
    await esperar(300);
    expect(texto()).toContain('Abrindo…');
    await esperar(4200);
    expect(texto()).toContain('Acesse Comunicação pelo menu lateral');
    act(() => botao('Próximo').click());
    await esperar(50);
    expect(texto()).toContain('Etapa 2 de 6');
  });

  it('Esc pula: some da tela e o anúncio fica como dispensado', async () => {
    ancora('nav-comunicacao');
    act(() => api.iniciar('communication_hub_v1'));
    await esperar(200);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(tour()).toBeNull();
    expect(eventos.lista.at(-1)?.[1]).toBe('dismissed');
  });

  it('setas do teclado avançam e voltam', async () => {
    act(() => api.iniciar('communication_hub_v1'));
    await esperar(50);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(texto()).toContain('Etapa 2 de 6');
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(texto()).toContain('Etapa 1 de 6');
  });

  it('etapa com menu: abre o menu para destacar o item e fecha ao sair', async () => {
    window.history.replaceState(null, '', '/comunicacao?c=abc');
    const mais = ancora('comunicacao-anexos', { 'aria-expanded': 'false' });
    mais.addEventListener('click', () => {
      const aberto = mais.getAttribute('aria-expanded') === 'true';
      mais.setAttribute('aria-expanded', aberto ? 'false' : 'true');
      if (!aberto) ancora('comunicacao-compartilhar'); else document.querySelector('[data-tour-id="comunicacao-compartilhar"]')?.remove();
    });
    act(() => api.iniciar('communication_hub_v1', { etapa: 4 }));
    await esperar(300);
    expect(mais.getAttribute('aria-expanded')).toBe('true');
    expect(texto()).toContain('Conecte conversas ao trabalho');
    act(() => botao('Próximo').click());
    await esperar(50);
    expect(mais.getAttribute('aria-expanded')).toBe('false');
  });

  it('última etapa: "Abrir Comunicação" leva à tela e conclui', async () => {
    act(() => api.iniciar('communication_hub_v1', { etapa: 5 }));
    await esperar(50);
    expect(texto()).toContain('Tudo pronto para começar!');
    act(() => botao('Abrir Comunicação').click());
    expect(router.push).toHaveBeenCalledWith('/comunicacao');
    expect(eventos.lista.at(-1)?.[1]).toBe('completed');
    expect(tour()).toBeNull();
  });

  it('sem rede: o tutorial segue normalmente (só não grava)', async () => {
    eventos.falhar = true;
    act(() => api.iniciar('communication_hub_v1'));
    await esperar(50);
    act(() => botao('Próximo').click());
    await esperar(50);
    expect(texto()).toContain('Etapa 2 de 6');
  });

  it('recarregou no meio: volta na mesma etapa', async () => {
    act(() => api.iniciar('communication_hub_v1', { etapa: 2 }));
    await esperar(50);
    act(() => raiz.unmount());
    raiz = createRoot(caixa);
    act(() => raiz.render(<TourProvider><Captura /></TourProvider>));
    await esperar(50);
    expect(texto()).toContain('Fale diretamente com seus colegas');
  });

  it('tutorial desconhecido não abre nada', () => {
    act(() => api.iniciar('nao_existe'));
    expect(tour()).toBeNull();
    expect(Object.keys(TOURS)).toContain('communication_hub_v1');
  });
});

describe('posição do cartão', () => {
  const tela = { width: 1280, height: 800 };
  const cartao = { width: 340, height: 200 };
  it('do lado pedido quando cabe', () => {
    expect(posicionar({ top: 100, left: 40, width: 200, height: 40 }, 'right', cartao, tela).left).toBe(40 + 200 + 14);
  });
  it('vira para o outro lado quando não cabe (composer no rodapé: em cima)', () => {
    const p = posicionar({ top: 740, left: 300, width: 36, height: 36 }, 'bottom', cartao, tela);
    expect(p.top).toBeLessThan(740);
  });
  it('nunca sai da tela', () => {
    const p = posicionar({ top: 10, left: 1260, width: 20, height: 20 }, 'right', cartao, tela);
    expect(p.left + cartao.width).toBeLessThanOrEqual(tela.width - 16);
    expect(p.top).toBeGreaterThanOrEqual(16);
  });
  it('sem alvo: centralizado', () => {
    expect(posicionar(null, 'auto', cartao, tela)).toEqual({ top: 300, left: 470 });
  });
});
