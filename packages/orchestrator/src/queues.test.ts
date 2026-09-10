import { describe, expect, it } from 'vitest';
import { AGENT_MAX_ATTEMPTS, AGENT_TIMEOUT_MS, queueNameForAgent } from './queues.js';

/**
 * Trava o contrato de retry por agente (comentário original em queues.ts):
 * Jarbas e Suzy não podem ter retry automático do BullMQ porque uma falha
 * pode ter acontecido DEPOIS do efeito colateral real (mensagem já mandada
 * pro WhatsApp do lead via agentes-desigual) - reenfileirar sozinho arrisca
 * mandar a mesma mensagem 2x. Bento/Studio/Otto não têm esse efeito
 * colateral e mantêm o retry padrão (2). Este teste existe só pra ninguém
 * mudar esse número sem perceber a implicação de negócio por trás dele.
 */
describe('AGENT_MAX_ATTEMPTS', () => {
  it('jarbas e suzy têm 1 tentativa (sem retry automático)', () => {
    expect(AGENT_MAX_ATTEMPTS.jarbas).toBe(1);
    expect(AGENT_MAX_ATTEMPTS.suzy).toBe(1);
  });

  it('bento, studio e otto mantêm o retry padrão de 2 tentativas', () => {
    expect(AGENT_MAX_ATTEMPTS.bento).toBe(2);
    expect(AGENT_MAX_ATTEMPTS.studio).toBe(2);
    expect(AGENT_MAX_ATTEMPTS.otto).toBe(2);
  });
});

describe('AGENT_TIMEOUT_MS', () => {
  it('todo agente tem um timeout positivo configurado', () => {
    for (const agent of ['bento', 'jarbas', 'suzy', 'studio', 'otto'] as const) {
      expect(AGENT_TIMEOUT_MS[agent]).toBeGreaterThan(0);
    }
  });

  it('jarbas e suzy compartilham o mesmo timeout (mesmo backend, agentes-desigual)', () => {
    expect(AGENT_TIMEOUT_MS.jarbas).toBe(AGENT_TIMEOUT_MS.suzy);
  });
});

describe('queueNameForAgent', () => {
  it('usa hífen, não dois-pontos (BullMQ rejeita ":" em nome de fila)', () => {
    expect(queueNameForAgent('bento')).toBe('queue-bento');
    expect(queueNameForAgent('bento')).not.toContain(':');
  });
});
