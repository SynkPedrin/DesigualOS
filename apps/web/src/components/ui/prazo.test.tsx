import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AguardandoAprovacao, faixaDaLinha, Prazo } from './prazo';

/**
 * O que a pessoa vê de relance, em qualquer painel. Estes testes travam o CONTRATO visual: HOJE em maiúsculas na cor
 * de sinal, atraso em vermelho cheio dizendo há quantos dias, concluído nunca vermelho, aprovação sempre roxa.
 */
function montar(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(ui));
  return container;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T18:00:00Z')); // 15h em São Paulo
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Prazo', () => {
  it('vence hoje: HOJE, maiúsculas, fundo de sinal', () => {
    const el = montar(<Prazo prazo="2026-10-26" />).firstElementChild!;
    expect(el.textContent).toBe('HOJE');
    expect(el.className).toContain('bg-sinal');
    expect(el.className).toContain('uppercase');
  });

  it('atrasado: vermelho cheio e há quantos dias', () => {
    const el = montar(<Prazo prazo="2026-10-23" />).firstElementChild!;
    expect(el.textContent).toBe('ATRASADA · 3 DIAS');
    expect(el.className).toContain('bg-erro');
  });

  it('pedido e pagamento falam no masculino', () => {
    expect(montar(<Prazo prazo="2026-10-25" feminino={false} />).textContent).toBe('ATRASADO · 1 DIA');
  });

  it('concluído nunca é atraso, por mais velho que seja o prazo', () => {
    const el = montar(<Prazo prazo="2021-01-01" feito />);
    expect(el.textContent).toBe('Feito');
    expect(el.innerHTML).not.toContain('bg-erro');
  });

  it('amanhã tem contorno; mais longe fica discreto', () => {
    expect(montar(<Prazo prazo="2026-10-27" />).firstElementChild!.className).toContain('border-aviso');
    const longe = montar(<Prazo prazo="2026-12-20" />).firstElementChild!;
    expect(longe.textContent).toBe('20/12');
    expect(longe.className).toContain('text-nevoa');
  });

  it('sem prazo diz isso, sem inventar data', () => {
    expect(montar(<Prazo prazo={null} />).textContent).toBe('Sem prazo');
  });
});

describe('AguardandoAprovacao', () => {
  it('roxo cheio, maiúsculas; parado 2+ dias diz há quanto', () => {
    const recente = montar(<AguardandoAprovacao desde="2026-10-26T10:00:00Z" />).firstElementChild!;
    expect(recente.className).toContain('bg-roxo-eletrico');
    expect(recente.textContent).toBe('Aguardando aprovação');
    expect(montar(<AguardandoAprovacao desde="2026-10-21T10:00:00Z" />).textContent).toContain('há 5 dias');
  });
});

describe('faixa da linha', () => {
  it('uma cor por situação, e linha comum sem cor', () => {
    expect(faixaDaLinha('atrasado')).toContain('border-l-erro');
    expect(faixaDaLinha('hoje')).toContain('border-l-sinal');
    expect(faixaDaLinha('aprovacao')).toContain('border-l-roxo-eletrico');
    expect(faixaDaLinha(null)).toContain('border-l-transparent');
  });
});
