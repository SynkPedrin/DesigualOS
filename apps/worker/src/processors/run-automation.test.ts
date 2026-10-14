import { describe, expect, it, vi } from 'vitest';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));
vi.mock('@desigual-os/orchestrator', () => ({ dispatchChatMessage: vi.fn(), touchConversation: vi.fn() }));

describe('mensagemDaAutomacao', () => {
  const CONTEXTO = 'Usuário: Pedro\nHistórico: Bento: qual delas você quer que eu mova pra sexta?';

  /**
   * O caso de produção de 13/10/2026: o histórico colado trazia "delas" e
   * "mova pra sexta", e as travas do Bento barravam a automação toda hora.
   */
  it('Bento recebe só o prompt da automação, sem o bloco colado', async () => {
    const { mensagemDaAutomacao } = await import('./run-automation');
    expect(mensagemDaAutomacao('Resumo das tarefas atrasadas da agência', 'bento', CONTEXTO)).toBe(
      'Resumo das tarefas atrasadas da agência',
    );
  });

  it('a mesma regra do chat vale para Otto, Jarbas e Suzy', async () => {
    const { mensagemDaAutomacao } = await import('./run-automation');
    for (const agente of ['otto', 'jarbas', 'suzy'] as const) {
      expect(mensagemDaAutomacao('pedido', agente, CONTEXTO)).toBe('pedido');
    }
  });

  it('o Studio, que não tem outro canal de contexto, continua recebendo o bloco', async () => {
    const { mensagemDaAutomacao } = await import('./run-automation');
    expect(mensagemDaAutomacao('pedido', 'studio', CONTEXTO)).toBe(`pedido\n\n---\nContexto:\n${CONTEXTO}`);
    expect(mensagemDaAutomacao('pedido', 'studio', '')).toBe('pedido');
  });
});
