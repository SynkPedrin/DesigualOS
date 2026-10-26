import { describe, expect, it, vi } from 'vitest';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));
vi.mock('@desigual-os/orchestrator', () => ({}));

describe('telefoneDaAutomacao', () => {
  it('aceita o número como a pessoa digita e grava como o Bento envia', async () => {
    const { telefoneDaAutomacao } = await import('./routes');
    expect(telefoneDaAutomacao('(18) 99165-2039')).toBe('5518991652039');
    expect(telefoneDaAutomacao('18991652039')).toBe('5518991652039');
    expect(telefoneDaAutomacao('+55 18 99165-2039')).toBe('5518991652039');
  });

  it('vazio desliga, ausente não mexe, número estranho é recusado', async () => {
    const { telefoneDaAutomacao } = await import('./routes');
    expect(telefoneDaAutomacao(null)).toBeNull();
    expect(telefoneDaAutomacao('  ')).toBeNull();
    expect(telefoneDaAutomacao(undefined)).toBeUndefined();
    expect(telefoneDaAutomacao('12345')).toBe(false);
    expect(telefoneDaAutomacao('+1 415 555 0100')).toBe(false);
  });
});
