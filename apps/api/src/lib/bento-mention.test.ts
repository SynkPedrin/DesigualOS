import { beforeEach, describe, expect, it, vi } from 'vitest';

const askBentoQA = vi.fn();
const resolveOperationalTurn = vi.fn();

vi.mock('@desigual-os/tool-gateway', () => ({
  askBentoQA: (...args: unknown[]) => askBentoQA(...args),
  BentoQAError: class extends Error {},
}));
vi.mock('./operational-context', async () => {
  const real = await vi.importActual<typeof import('./operational-context')>('./operational-context');
  return {
    ...real,
    resolveOperationalTurn: (...args: unknown[]) => resolveOperationalTurn(...args),
  };
});

const { askBento } = await import('./bento-mention');

/**
 * Trava o achado de 14/09/2026: medido contra o bento-qa real, a menção @Bento no ClickUp
 * chegava SEM dado operacional, e o cérebro respondia "De qual cliente você quer saber as
 * tasks do ClickUp?" em 176ms — inclusive pra pergunta que não é sobre cliente nenhum.
 * A mesma pergunta COM o campo preenchido foi respondida em 3,6s com o número real.
 */
describe('menção @Bento no ClickUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BENTO_QA_TOKEN = 'token-de-teste';
    askBentoQA.mockResolvedValue({ text: 'resposta', citations: [] });
  });

  it('manda o dado operacional ao vivo junto da pergunta', async () => {
    resolveOperationalTurn.mockResolvedValue({
      scope: { kind: 'GLOBAL' },
      context: { block: 'DADO AO VIVO: 3 tarefas vencem hoje', summary: null, failure: null },
      briefingBlock: null,
    });

    await askBento('quantas tarefas vencem hoje?');

    expect(askBentoQA).toHaveBeenCalledTimes(1);
    expect(askBentoQA.mock.calls[0]![2]).toContain('3 tarefas vencem hoje');
  });

  it('prefere o briefing à lista crua, mesma regra do chat', async () => {
    resolveOperationalTurn.mockResolvedValue({
      scope: { kind: 'CLIENT' },
      context: { block: 'lista crua', summary: null, failure: null },
      briefingBlock: 'BRIEFING ESTRUTURADO',
    });

    await askBento('me dá um briefing da operação');

    expect(askBentoQA.mock.calls[0]![2]).toBe('BRIEFING ESTRUTURADO');
  });

  it('pergunta não-operacional segue sem bloco, e não deixa de ser respondida', async () => {
    resolveOperationalTurn.mockResolvedValue({
      scope: { kind: 'NONE' },
      context: { block: null, summary: null, failure: null },
      briefingBlock: null,
    });

    await expect(askBento('qual o tom de voz da agência?')).resolves.toBe('resposta');
    expect(askBentoQA.mock.calls[0]![2]).toBeUndefined();
  });

  it('falha ao montar o contexto não derruba a menção — o Bento ainda responde pelo vault', async () => {
    resolveOperationalTurn.mockRejectedValue(new Error('ClickUp fora do ar'));

    await expect(askBento('quantas tarefas vencem hoje?')).resolves.toBe('resposta');
    expect(askBentoQA.mock.calls[0]![2]).toBeUndefined();
  });
});
