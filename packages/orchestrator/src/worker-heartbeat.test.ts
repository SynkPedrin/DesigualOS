import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O valor destes testes é o DIAGNÓSTICO: o incidente de 10/09/2026 não foi "o worker morreu",
 * foi "o worker morreu e o sistema disse que estava tudo bem". Então o que precisa estar certo
 * é a leitura — worker fora do ar com fila cheia nunca pode sair como saudável.
 */

const redis = {
  get: vi.fn<(key: string) => Promise<string | null>>(),
  set: vi.fn(),
  del: vi.fn(),
};

const contagens = {
  wait: 0,
  active: 0,
  delayed: 0,
  failed: 0,
};

/** Interruptor para simular contagem de fila que nunca responde (ver "Redis pendurado"). */
const contagensPendurdas = { valor: false };
const contarJobs = async () => {
  if (contagensPendurdas.valor) return new Promise<never>(() => {});
  return contagens;
};

vi.mock('./queues', () => ({
  getRedisConnection: () => redis,
  queueNameForAgent: (agente: string) => `queue-${agente}`,
  getAgentQueue: () => ({ getJobCounts: contarJobs }),
}));

vi.mock('./automation-queue', () => ({
  AUTOMATIONS_QUEUE_NAME: 'automations',
  // Zeros de propósito: o teste do incidente conta 35 pedidos vindos SÓ das
  // filas de agente. Fazer esta devolver `contagens` somava uma fila a mais e
  // o número virava 42.
  getAutomationsQueue: () => ({
    getJobCounts: async () => {
      if (contagensPendurdas.valor) return new Promise<never>(() => {});
      return { wait: 0, active: 0, delayed: 0, failed: 0 };
    },
  }),
}));

const { readWorkerHealth, BATIMENTO_LIMITE_MS, FILA_ALTA } = await import('./worker-heartbeat');

function batimento(msAtras: number, releaseSha = 'abc1234'): string {
  return JSON.stringify({
    pid: 4242,
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    beatAt: new Date(Date.now() - msAtras).toISOString(),
    version: null,
    releaseSha,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  contagens.wait = 0;
  contagens.active = 0;
  contagens.delayed = 0;
  contagens.failed = 0;
});

describe('readWorkerHealth', () => {
  it('batimento recente = worker de pé, com pid e diagnóstico honesto', async () => {
    redis.get.mockResolvedValue(batimento(3_000));
    const s = await readWorkerHealth();
    expect(s.online).toBe(true);
    expect(s.pid).toBe(4242);
    expect(s.diagnostico).toMatch(/de pé e consumindo/i);
  });

  it('SEM batimento nenhum é worker fora do ar, não "estado desconhecido"', async () => {
    // A chave some por TTL quando o processo morre: ausência É o sinal de morte.
    redis.get.mockResolvedValue(null);
    const s = await readWorkerHealth();
    expect(s.online).toBe(false);
    expect(s.lastBeatAt).toBeNull();
    expect(s.diagnostico).toMatch(/fora do ar/i);
  });

  it('batimento velho além do limite é worker fora do ar', async () => {
    redis.get.mockResolvedValue(batimento(BATIMENTO_LIMITE_MS + 5_000));
    const s = await readWorkerHealth();
    expect(s.online).toBe(false);
    expect(s.segundosDesdeUltimoBatimento).toBeGreaterThan(BATIMENTO_LIMITE_MS / 1000);
  });

  it('o cenário do incidente: worker morto COM fila cheia diz quantos pedidos estão parados', async () => {
    redis.get.mockResolvedValue(null);
    contagens.wait = 7;
    const s = await readWorkerHealth();
    expect(s.online).toBe(false);
    // 5 filas de agente × 7 (o mock devolve a mesma contagem pra todas), automations em 0.
    expect(s.jobsAguardando).toBe(35);
    expect(s.diagnostico).toMatch(/35 pedido\(s\) na fila/);
  });

  it('worker vivo mas com fila acumulando NÃO passa por saudável', async () => {
    redis.get.mockResolvedValue(batimento(2_000));
    contagens.wait = FILA_ALTA; // 20 × 5 filas = 100, bem acima do piso
    const s = await readWorkerHealth();
    expect(s.online).toBe(true);
    expect(s.jobsAguardando).toBeGreaterThan(FILA_ALTA);
    expect(s.diagnostico).toMatch(/acumulando/i);
  });

  it('Redis fora não derruba a leitura: devolve worker offline em vez de lançar', async () => {
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const s = await readWorkerHealth();
    expect(s.online).toBe(false);
  });

  it('batimento corrompido no Redis não lança: trata como ausência', async () => {
    redis.get.mockResolvedValue('{isso não é json');
    const s = await readWorkerHealth();
    expect(s.online).toBe(false);
  });

  /**
   * P1-04 (release readiness audit, 22/09/2026): sem isto não dava pra provar
   * QUAL commit o worker estava rodando de verdade depois de um deploy.
   */
  it('releaseSha do batimento chega em SaudeDoWorker', async () => {
    redis.get.mockResolvedValue(batimento(3_000, 'deadbeef'));
    const s = await readWorkerHealth();
    expect(s.releaseSha).toBe('deadbeef');
  });

  it('sem batimento, releaseSha é null, não string vazia nem inventado', async () => {
    redis.get.mockResolvedValue(null);
    const s = await readWorkerHealth();
    expect(s.releaseSha).toBeNull();
  });

  /**
   * REDIS QUE NÃO RESPONDE NÃO É REDIS QUE RECUSA, e a diferença derrubou uma
   * tela inteira.
   *
   * `getRedisConnection()` usa `maxRetriesPerRequest: null`, exigido pelo
   * BullMQ. Com isso, Redis fora do ar não rejeita o comando: enfileira e fica
   * tentando reconectar. Os `try/catch` desta função nunca disparam, porque
   * nunca há rejeição.
   *
   * Medido em 09/10/2026: `/health/infrastructure` pendurava 30s, o navegador
   * abortava, a consulta recomeçava, e o rodapé da barra lateral ficava em
   * esqueleto para sempre, em laço, por aba aberta — além de segurar uma
   * conexão do pool do Postgres a cada volta.
   *
   * Por isso estes testes usam promessa que NUNCA assenta, e não
   * `mockRejectedValue`: rejeição o código velho já tratava. O que ele não
   * tratava era a espera.
   */
  describe('Redis pendurado', () => {
    const nunca = () => new Promise<never>(() => {});

    it('batimento que nunca responde vira worker offline, e não espera pra sempre', async () => {
      redis.get.mockImplementation(nunca);
      const comeco = Date.now();
      const s = await readWorkerHealth();
      const decorrido = Date.now() - comeco;

      expect(s.online).toBe(false);
      expect(s.releaseSha).toBeNull();
      // Com o defeito, isto nunca retornava. O limite é folgado de propósito:
      // o que se prova é que EXISTE limite, não qual é o número exato.
      expect(decorrido).toBeLessThan(10_000);
    }, 15_000);

    it('contagem de fila pendurada não impede o resto do diagnóstico', async () => {
      redis.get.mockResolvedValue(batimento(3_000));
      const original = contagensPendurdas.valor;
      contagensPendurdas.valor = true;
      try {
        const comeco = Date.now();
        const s = await readWorkerHealth();
        expect(Date.now() - comeco).toBeLessThan(10_000);
        // O batimento respondeu, então o worker É conhecido como online; só a
        // medição de fila falta, e faltar é diferente de valer zero.
        expect(s.online).toBe(true);
        // Fila sem medição é fila VAZIA de medição, não fila de tamanho zero:
        // `filas` fica vazia e a soma não finge conhecer o que não leu.
        expect(s.filas).toEqual([]);
        expect(s.jobsAguardando).toBe(0);
      } finally {
        contagensPendurdas.valor = original;
      }
    }, 15_000);
  });
});
