import { describe, expect, it } from 'vitest';
import { TIMEOUTS_MS, MENSAGEM_SEM_WORKER } from './studio-queue-timeout';

/**
 * A lógica que importa aqui (decidir o limite a partir do número de
 * workers conectados) é exercida de verdade contra Redis e Postgres reais
 * no roteiro de validação; ver docs/studio-ai-architecture.md. O que este
 * teste protege é a PROPRIEDADE que torna a regra correta, e que uma
 * mudança de número poderia quebrar sem ninguém perceber.
 */
describe('studio-queue-timeout', () => {
  it('falha rápido sem worker e tolera muito mais com worker conectado', () => {
    expect(TIMEOUTS_MS.semWorker).toBeLessThan(TIMEOUTS_MS.comWorker);
    // O pior caso REAL de espera legítima é uma carga fria (1510s medidos)
    // seguida de gerações quentes (36,4s medidos) - carga fria não se
    // repete enquanto os pesos ficam residentes. O teto precisa caber a
    // fria com folga larga pras quentes atrás dela.
    const umaFria = 1510 * 1000;
    const umaQuente = 37 * 1000;
    expect(TIMEOUTS_MS.comWorker).toBeGreaterThan(umaFria + 30 * umaQuente);
  });

  it('não expira antes de um restart normal do studio-node', () => {
    // Deploy/reboot do node leva segundos; reprovar job recém-criado por
    // causa disso seria pior que o problema original.
    expect(TIMEOUTS_MS.semWorker).toBeGreaterThanOrEqual(60_000);
  });

  it('a mensagem de "sem worker" é a exigida pelo contrato e explica a ação', () => {
    expect(MENSAGEM_SEM_WORKER).toContain('No available Studio worker.');
    expect(MENSAGEM_SEM_WORKER.length).toBeGreaterThan(40);
  });
});
