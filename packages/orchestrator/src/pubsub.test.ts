import { describe, expect, it } from 'vitest';
import { redisNamespace, wsEventsChannel } from './pubsub';

/**
 * P1-07 (release readiness audit, 22/09/2026): Redis PUB/SUB não respeita
 * DB/SELECT — é global no servidor inteiro. QA (REDIS_URL .../1) e produção
 * (.../0) publicavam no MESMO canal fixo `desigual-os:ws-events`, e evento
 * de teste chegava na UI de produção de verdade (E18). O número de banco já
 * separa QA de produção hoje; reaproveitá-lo no NOME do canal fecha o
 * isolamento sem variável de ambiente nova.
 */
describe('redisNamespace — QA e produção nunca podem publicar no mesmo canal', () => {
  it('extrai o número de banco da URL', () => {
    expect(redisNamespace('redis://localhost:6379/0')).toBe('db0');
    expect(redisNamespace('redis://localhost:6380/1')).toBe('db1');
    expect(redisNamespace('redis://user:pass@redis.internal:6379/7')).toBe('db7');
  });

  it('URL sem banco explícito (path vazio) cai no default de produção, db0', () => {
    expect(redisNamespace('redis://localhost:6379')).toBe('db0');
  });

  it('URL inválida não derruba o processo — cai em db0 em vez de lançar', () => {
    expect(redisNamespace('não é uma url')).toBe('db0');
  });

  it('QA e produção apontando pro MESMO servidor Redis, DBs diferentes, geram canais DIFERENTES', () => {
    expect(redisNamespace('redis://localhost:6379/0')).not.toBe(redisNamespace('redis://localhost:6379/1'));
  });
});

describe('wsEventsChannel — lê REDIS_URL em tempo de chamada, não uma vez só no import', () => {
  it('o canal muda quando REDIS_URL muda (evita cache de módulo escondendo o ambiente errado)', () => {
    const original = process.env.REDIS_URL;
    try {
      process.env.REDIS_URL = 'redis://localhost:6379/0';
      const producao = wsEventsChannel();
      process.env.REDIS_URL = 'redis://localhost:6380/1';
      const qa = wsEventsChannel();
      expect(producao).toBe('desigual-os:db0:ws-events');
      expect(qa).toBe('desigual-os:db1:ws-events');
      expect(producao).not.toBe(qa);
    } finally {
      if (original === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = original;
    }
  });

  it('sem REDIS_URL nenhuma, usa o default local (db0)', () => {
    const original = process.env.REDIS_URL;
    try {
      delete process.env.REDIS_URL;
      expect(wsEventsChannel()).toBe('desigual-os:db0:ws-events');
    } finally {
      if (original !== undefined) process.env.REDIS_URL = original;
    }
  });
});
