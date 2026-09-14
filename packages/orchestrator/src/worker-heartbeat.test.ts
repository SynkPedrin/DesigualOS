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

vi.mock('./queues', () => ({
  getRedisConnection: () => redis,
  queueNameForAgent: (agente: string) => `queue-${agente}`,
  getAgentQueue: () => ({ getJobCounts: async () => contagens }),
}));

vi.mock('./automation-queue', () => ({
  AUTOMATIONS_QUEUE_NAME: 'automations',
  getAutomationsQueue: () => ({ getJobCounts: async () => ({ wait: 0, active: 0, delayed: 0, failed: 0 }) }),
}));

const { readWorkerHealth, BATIMENTO_LIMITE_MS, FILA_ALTA } = await import('./worker-heartbeat');

function batimento(msAtras: number): string {
  return JSON.stringify({
    pid: 4242,
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    beatAt: new Date(Date.now() - msAtras).toISOString(),
    version: null,
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
});
