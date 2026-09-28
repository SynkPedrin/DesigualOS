import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThinkingSteps } from './thinking-steps';

/**
 * 28/09/2026, pedido da operação: trocar a lista de etapas com check por
 * bolinhas roxas e verdes subindo e descendo, com a frase mudando ao lado.
 *
 * O que estes testes protegem não é o visual — é a propriedade que o
 * componente antigo tinha e que a troca não pode perder: a UI nunca anuncia
 * uma etapa que o backend não executou. Animação bonita que mente sobre o
 * progresso é pior que lista feia que diz a verdade.
 */

// React só reconhece act() fora de teste quando a flag está ligada; sem ela o
// console enche de aviso e esconde as falhas que importam.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function montar(ui: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

describe('a fase REAL do backend manda', () => {
  it('com liveSteps, mostra a última fase reportada — nunca uma genérica', () => {
    const el = montar(
      <ThinkingSteps status="running" clientName="Colormaq" liveSteps={['Consultando o ClickUp', 'Conferindo a task']} />,
    );
    expect(el.textContent).toContain('Conferindo a task');
    expect(el.textContent).not.toContain('Em análise');
  });

  it('sem liveSteps, NÃO cita fonte que ninguém consultou', () => {
    const el = montar(<ThinkingSteps status="running" clientName={null} />);
    expect(el.textContent).toContain('Em análise');
    expect(el.textContent).not.toContain('ClickUp');
  });

  it('o nome do cliente entra na frase genérica quando existe', () => {
    vi.useFakeTimers();
    const el = montar(<ThinkingSteps status="running" clientName="Colormaq" />);
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(el.textContent).toContain('Colormaq');
  });
});

describe('turno aberto não anuncia progresso que não houve', () => {
  it('a rotação genérica para antes da frase final enquanto o turno está aberto', () => {
    vi.useFakeTimers();
    const el = montar(<ThinkingSteps status="running" clientName={null} />);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(el.textContent).not.toContain('Montando a resposta');
  });

  it('turno encerrado mostra a frase final, sem reticências', () => {
    const el = montar(<ThinkingSteps status="completed" clientName={null} />);
    expect(el.textContent).toContain('Montando a resposta');
    expect(el.textContent).not.toContain('…');
  });
});

describe('forma e acessibilidade', () => {
  it('três bolinhas, roxo e verde alternados, marcadas como decorativas', () => {
    const el = montar(<ThinkingSteps status="running" clientName={null} />);
    const decorativo = el.querySelector('[aria-hidden="true"]');
    expect(decorativo).not.toBeNull();
    expect(decorativo!.children).toHaveLength(3);
    const classes = [...decorativo!.children].map((c) => c.className);
    expect(classes[0]).toContain('bg-roxo-eletrico');
    expect(classes[1]).toContain('bg-sinal');
    expect(classes[2]).toContain('bg-roxo-eletrico');
  });

  it('a troca de frase é anunciada por leitor de tela', () => {
    const el = montar(<ThinkingSteps status="running" clientName={null} />);
    const regiao = el.querySelector('[role="status"]');
    expect(regiao?.getAttribute('aria-live')).toBe('polite');
  });
});
