import { describe, expect, it, vi } from 'vitest';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));

describe('mensagemDeAgenteFora', () => {
  it('diz quem está fora, o que ele faz e o que fazer agora, sem jargão de infraestrutura', async () => {
    const { mensagemDeAgenteFora } = await import('./chat-service');
    const jarbas = mensagemDeAgenteFora('jarbas');
    expect(jarbas).toBe(
      'O Jarbas (tráfego pago) está fora do ar no momento. Os números de mídia estão na tela Mídias, e a operação você pode perguntar ao Bento.',
    );
    for (const agente of ['jarbas', 'suzy', 'otto', 'studio'] as const) {
      expect(mensagemDeAgenteFora(agente)).not.toMatch(/node/i);
    }
    expect(mensagemDeAgenteFora('otto')).toBe('O Otto (direção criativa) está fora do ar no momento. Para tarefas, clientes e operação, pergunte ao Bento.');
  });
});

describe('agenteRespondeNoWorker', () => {
  it('Bento sempre; Jarbas por padrão, e volta ao portão com JARBAS_LOCAL_ENABLED=false; os outros nunca', async () => {
    const { agenteRespondeNoWorker } = await import('./chat-service');
    expect(agenteRespondeNoWorker('bento', {})).toBe(true);
    expect(agenteRespondeNoWorker('jarbas', {})).toBe(true);
    expect(agenteRespondeNoWorker('jarbas', { JARBAS_LOCAL_ENABLED: 'false' })).toBe(false);
    for (const agente of ['suzy', 'otto', 'studio'] as const) expect(agenteRespondeNoWorker(agente, {})).toBe(false);
  });
});
