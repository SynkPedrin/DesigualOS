import { describe, expect, it } from 'vitest';
import { TIMEOUTS_MS, MENSAGEM_SEM_WORKER, MENSAGEM_TRAVADO_RENDERIZANDO } from './studio-queue-timeout';

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

/**
 * Segunda lacuna, fechada em 18/09/2026: o vigia só olhava `queued`. Job que
 * JÁ ESTAVA gerando quando o studio-node morreu ficava em `rendering` pra
 * sempre — o próprio studio-node documenta o sintoma no comentário do
 * `uncaughtException` ("o job ficou preso em `rendering`"), e o
 * `worker.on('failed')` de lá só escreve log: quando o BullMQ desiste de um job
 * travado, ninguém atualiza a linha do Postgres, porque o processo que faria
 * isso é o que morreu.
 */
describe('studio-queue-timeout: geração órfã (worker morto no meio)', () => {
  it('tolera pelo menos duas janelas de lock do studio-node antes de reprovar', () => {
    // lockDuration do studio-node = 25 min. Enquanto o lock vale, o BullMQ
    // ainda pode reentregar o job a um worker novo; reprovar antes disso
    // mataria um job que ia se recuperar sozinho.
    const lockDoStudioNode = 25 * 60 * 1000;
    expect(TIMEOUTS_MS.renderizandoTravado).toBeGreaterThan(2 * lockDoStudioNode);
  });

  it('é mais tolerante que o limite de fila sem worker, e mais rígido que o de fila com worker', () => {
    // Gerar é mais caro que esperar: o teto tem que ser maior que o de "não há
    // ninguém pra pegar". Mas menor que o da fila cheia, porque ali a espera é
    // legítima (concurrency 1) e aqui é ausência de sinal.
    expect(TIMEOUTS_MS.renderizandoTravado).toBeGreaterThan(TIMEOUTS_MS.semWorker);
    expect(TIMEOUTS_MS.renderizandoTravado).toBeLessThan(TIMEOUTS_MS.comWorker);
  });

  it('a mensagem diz o que aconteceu E o que fazer, sem culpar quem pediu', () => {
    expect(MENSAGEM_TRAVADO_RENDERIZANDO).toMatch(/pode pedir de novo/i);
    expect(MENSAGEM_TRAVADO_RENDERIZANDO.length).toBeGreaterThan(60);
  });

  it('os estágios do pipeline contam como "em voo" por exclusão, não por lista fixa', async () => {
    const { STATUS_TERMINAIS } = await import('./studio-queue-timeout.js');
    const { STUDIO_JOB_STATUSES } = await import('@desigual-os/types');
    const emVoo = STUDIO_JOB_STATUSES.filter(
      (s) => !(STATUS_TERMINAIS as readonly string[]).includes(s) && s !== 'queued',
    );
    // Se alguém acrescentar um estágio novo em STUDIO_JOB_STATUSES, ele entra
    // aqui sozinho - que é exatamente a propriedade que queremos travar.
    expect(emVoo).toContain('rendering');
    expect(emVoo).toContain('uploading');
    expect(emVoo).toContain('video_master');
    expect(emVoo).not.toContain('completed');
    expect(emVoo).not.toContain('cancelled');
  });
});
