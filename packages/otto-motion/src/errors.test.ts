import { describe, expect, it } from 'vitest';
import { MotionModelUnavailableError, userMessageFor } from './errors.js';

/**
 * §26 — a userMessage do OPUS_UNAVAILABLE tem DOIS textos, e escolher errado
 * manda a pessoa fazer a coisa errada:
 *
 *   - limite de uso  → "reconectar" não resolve; a mensagem precisa dizer que
 *                      é quota (a data de reset fica no detail).
 *   - modelo ausente → a mensagem completa, que explica o fail-closed e por
 *                      que não há fallback.
 *
 * Os dois casos mantêm o MESMO code (OPUS_UNAVAILABLE): quem decide o que
 * desenhar é a UI; o texto é o que muda.
 */
describe('MotionModelUnavailableError', () => {
  it('detail de limite de uso vira a frase curta de quota, sem o texto de "reconecte"', () => {
    const erro = new MotionModelUnavailableError("You've reached your weekly usage limit. Resets Sep 28 at 4pm.");

    expect(erro.code).toBe('OPUS_UNAVAILABLE');
    expect(erro.userMessage).toBe('O Claude Opus 5.5 está indisponível — limite de uso atingido.');
    // O reset não vaza pro chat pela userMessage — mora no detail.
    expect(erro.userMessage).not.toContain('Sep 28');
    expect(erro.detail).toContain('weekly usage limit');
    expect(userMessageFor(erro)).toBe(erro.userMessage);
  });

  it('detail de crédito/quota em outras grafias também pega o caminho curto', () => {
    expect(new MotionModelUnavailableError('quota exceeded for this account').userMessage).toBe(
      'O Claude Opus 5.5 está indisponível — limite de uso atingido.',
    );
    expect(new MotionModelUnavailableError('credit balance too low').userMessage).toBe(
      'O Claude Opus 5.5 está indisponível — limite de uso atingido.',
    );
  });

  it('detail de modelo indisponível mantém a mensagem completa do fail-closed', () => {
    const erro = new MotionModelUnavailableError('400 — version 2.1.280 or newer is required');

    expect(erro.code).toBe('OPUS_UNAVAILABLE');
    expect(erro.userMessage).toContain('o Claude Opus 5.5 não está disponível neste worker');
    expect(erro.userMessage).toContain('um modelo menor entregaria outra coisa');
    expect(erro.userMessage).not.toContain('limite de uso atingido');
  });
});
