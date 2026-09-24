import { randomUUID } from 'node:crypto';
import { getRedisConnection } from '@desigual-os/orchestrator';
import { MotionError } from '../errors.js';

/**
 * §28 — nunca dois workers no MESMO workspace.
 *
 * Motions diferentes rodam em paralelo à vontade; o que não pode é worker 1 e
 * worker 2 editando motion A ao mesmo tempo. Claude Code escreve arquivo por
 * arquivo: dois processos no mesmo diretório produzem um projeto que não é
 * nenhuma das duas versões.
 *
 * Redis (não um Map em memória) porque a API e o worker são processos
 * separados, e em produção podem ser máquinas separadas. Lock em memória
 * daria a garantia justamente onde ela não é necessária.
 */
const LOCK_TTL_MS = 30 * 60 * 1000;

function lockKey(motionId: string): string {
  return `otto-motion:lock:${motionId}`;
}

export interface MotionLock {
  motionId: string;
  token: string;
  release: () => Promise<void>;
  /** Estende o TTL. Chamado entre estágios longos (codegen, render final). */
  renew: () => Promise<boolean>;
}

/**
 * Pega o lock ou devolve null. Nunca espera: a fila do BullMQ é quem
 * serializa trabalho: bloquear aqui só seguraria um worker parado.
 */
export async function acquireMotionLock(motionId: string, ttlMs = LOCK_TTL_MS): Promise<MotionLock | null> {
  const redis = getRedisConnection();
  const token = randomUUID();
  const ok = await redis.set(lockKey(motionId), token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;

  return {
    motionId,
    token,
    // Compare-and-delete: sem isto, um worker cujo TTL expirou apagaria o
    // lock de OUTRO worker que já assumiu o motion legitimamente.
    release: async () => {
      await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        lockKey(motionId),
        token,
      );
    },
    renew: async () => {
      const result = await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`,
        1,
        lockKey(motionId),
        token,
        String(ttlMs),
      );
      return result === 1;
    },
  };
}

export async function withMotionLock<T>(motionId: string, fn: (lock: MotionLock) => Promise<T>): Promise<T> {
  const lock = await acquireMotionLock(motionId);
  if (!lock) {
    throw new MotionError(
      'WORKSPACE_LOCKED',
      'Esse motion já está sendo trabalhado agora. Assim que a passada atual terminar eu aplico o seu ajuste.',
      { detail: `motion ${motionId} já tem lock ativo` },
    );
  }
  try {
    return await fn(lock);
  } finally {
    await lock.release();
  }
}
