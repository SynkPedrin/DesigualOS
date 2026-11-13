import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModoEu } from '@/hooks/use-modo-eu';
import { BotaoModoEu } from './modo-eu';

// O padrão depende do papel (/me): sem papéis carregados, começa desligado como antes.
function montar(ui: React.ReactElement, papeis?: string[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });
  if (papeis) qc.setQueryData(['me'], { roles: papeis });
  act(() => createRoot(container).render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>));
  return container;
}

function Leitor() {
  const [ligado] = useModoEu();
  return <span data-testid="leitor">{ligado ? 'só eu' : 'equipe'}</span>;
}

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Modo eu do Daily Tasks', () => {
  it('começa desligado e liga com um clique, avisando as outras telas na hora', () => {
    const el = montar(<><BotaoModoEu /><Leitor /></>);
    const botao = el.querySelector('[role="switch"]')!;
    expect(botao.getAttribute('aria-checked')).toBe('false');
    expect(el.querySelector('[data-testid="leitor"]')!.textContent).toBe('equipe');
    act(() => (botao as HTMLButtonElement).click());
    expect(botao.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('[data-testid="leitor"]')!.textContent).toBe('só eu');
  });

  it('fica lembrado no navegador: quem volta encontra como deixou', () => {
    localStorage.setItem('dt:modo-eu', 'on');
    const el = montar(<BotaoModoEu />);
    expect(el.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    act(() => (el.querySelector('[role="switch"]') as HTMLButtonElement).click());
    expect(localStorage.getItem('dt:modo-eu')).toBe('off');
  });

  it('sem storage (aba anônima bloqueada) continua funcionando na sessão', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    const el = montar(<><BotaoModoEu /><Leitor /></>);
    act(() => (el.querySelector('[role="switch"]') as HTMLButtonElement).click());
    expect(el.querySelector('[data-testid="leitor"]')!.textContent).toBe('só eu');
  });

  it('sem escolha guardada: colaborador começa só com o que é dele, master na visão da agência', () => {
    expect(montar(<Leitor />, ['colaborador']).querySelector('[data-testid="leitor"]')!.textContent).toBe('só eu');
    document.body.innerHTML = '';
    expect(montar(<Leitor />, ['master']).querySelector('[data-testid="leitor"]')!.textContent).toBe('equipe');
  });

  it('a escolha da pessoa vale mais que o padrão do papel', () => {
    localStorage.setItem('dt:modo-eu', 'off');
    expect(montar(<Leitor />, ['colaborador']).querySelector('[data-testid="leitor"]')!.textContent).toBe('equipe');
  });
});
