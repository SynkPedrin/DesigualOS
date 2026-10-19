import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acquireMotionLock, withMotionLock } from './lock.js';
import { MotionError } from '../errors.js';

/**
 * §47-I e §47-J — concorrência, contra o Redis DE VERDADE.
 *
 * Mock de Redis provaria só que o mock funciona. O que precisa ser provado
 * aqui é que DOIS processos não pegam o mesmo lock, e isso depende do
 * comportamento real do SET NX PX. Sem Redis alcançável o bloco é pulado com
 * aviso, em vez de passar dando falsa segurança.
 */
process.env.REDIS_URL ??= 'redis://localhost:6380';

let redisUp = false;

/**
 * O PING AO REDIS PRECISA DESISTIR SOZINHO.
 *
 * Este preparo já sabia pular quando o Redis não está de pé — mas a TENTATIVA
 * não tinha limite: sem servidor, o ioredis entra em retentativa e o `ping()`
 * só rejeita depois de esgotar a política dele, bem além dos 10s do hook. O
 * resultado era o teste falhar por timeout de preparo em vez de pular, e só em
 * máquina sem Redis local — ou seja, de forma aparentemente aleatória para
 * quem roda o portão de release.
 *
 * Dois segundos bastam: Redis que está de pé responde em milissegundos, e
 * Redis que não está não vai responder nunca.
 */
beforeAll(async () => {
  const { getRedisConnection } = await import('@desigual-os/orchestrator');
  const desistir = new Promise<false>((r) => setTimeout(() => r(false), 2000));
  redisUp = await Promise.race([
    getRedisConnection()
      .ping()
      .then(() => true)
      .catch(() => false),
    desistir,
  ]);
  if (!redisUp) console.warn('[motion] Redis indisponível: testes de lock pulados');
}, 15_000);

afterAll(async () => {
  if (!redisUp) return;
  const { getRedisConnection } = await import('@desigual-os/orchestrator');
  await getRedisConnection().quit().catch(() => undefined);
});

describe.runIf(process.env.VITEST_SKIP_REDIS !== 'true')('lock por motionId', () => {
  it('I — dois motions DIFERENTES rodam ao mesmo tempo', async ({ skip }) => {
    if (!redisUp) return skip();
    const a = await acquireMotionLock(`teste-a-${Date.now()}`);
    const b = await acquireMotionLock(`teste-b-${Date.now()}`);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await a?.release();
    await b?.release();
  });

  it('J — duas passadas no MESMO motion: a segunda não entra', async ({ skip }) => {
    if (!redisUp) return skip();
    const motionId = `teste-mesmo-${Date.now()}`;
    const primeiro = await acquireMotionLock(motionId);
    const segundo = await acquireMotionLock(motionId);
    expect(primeiro).not.toBeNull();
    expect(segundo).toBeNull();
    await primeiro?.release();
  });

  it('J — a segunda tentativa vira erro explicado, não corrupção de workspace', async ({ skip }) => {
    if (!redisUp) return skip();
    const motionId = `teste-erro-${Date.now()}`;
    const preso = await acquireMotionLock(motionId);
    await expect(withMotionLock(motionId, async () => 'não deveria rodar')).rejects.toThrow(MotionError);
    await preso?.release();
  });

  it('depois do release, o próximo worker assume normalmente', async ({ skip }) => {
    if (!redisUp) return skip();
    const motionId = `teste-sequencia-${Date.now()}`;
    const primeiro = await acquireMotionLock(motionId);
    await primeiro?.release();
    const segundo = await acquireMotionLock(motionId);
    expect(segundo).not.toBeNull();
    await segundo?.release();
  });

  it('M — worker morto: o lock expira pelo TTL e o motion não fica preso pra sempre', async ({ skip }) => {
    if (!redisUp) return skip();
    const motionId = `teste-morto-${Date.now()}`;
    // TTL curto simula o worker que morreu sem chegar no `release`.
    const orfao = await acquireMotionLock(motionId, 400);
    expect(orfao).not.toBeNull();
    expect(await acquireMotionLock(motionId)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const retomado = await acquireMotionLock(motionId);
    expect(retomado).not.toBeNull();
    await retomado?.release();
  });

  it('release de um lock já expirado não derruba o lock de quem assumiu depois', async ({ skip }) => {
    if (!redisUp) return skip();
    const motionId = `teste-cad-${Date.now()}`;
    const antigo = await acquireMotionLock(motionId, 300);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const novo = await acquireMotionLock(motionId);
    // O worker morto "acorda" e solta o lock: não pode soltar o do novo dono.
    await antigo?.release();
    expect(await acquireMotionLock(motionId)).toBeNull();
    await novo?.release();
  });

  it('renew estende o lock durante um render longo', async ({ skip }) => {
    if (!redisUp) return skip();
    const motionId = `teste-renew-${Date.now()}`;
    const lock = await acquireMotionLock(motionId, 500);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await lock?.renew()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Sem o renew já teria expirado; com ele, continua preso.
    expect(await acquireMotionLock(motionId)).toBeNull();
    await lock?.release();
  });
});
