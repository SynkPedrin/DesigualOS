import { createHash } from 'node:crypto';
import { getRedisConnection } from '@desigual-os/orchestrator';
import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'api:idempotency' });

/**
 * Dedup de intenção duplicada (double click, retry de rede, refresh com
 * reenvio): a auditoria de 11/09/2026 mediu 2 tasks reais no ClickUp e 2
 * execuções de chat a partir de UM gesto do usuário. A chave é o hash do
 * escopo + intenção; o valor é o id do recurso criado. Redis local ~1ms,
 * então o custo por request é desprezível comparado aos ~130ms de RTT do
 * Postgres. Se o Redis estiver fora, segue SEM dedup (falha aberta de
 * propósito: perder a proteção é melhor que perder a ação).
 */
const DEDUP_TTL_S = 15;

/**
 * Teto de espera por comando Redis. Sem isto, um Redis fora do ar faz o
 * ioredis enfileirar o comando (enableOfflineQueue) e a request da API
 * fica pendurada pra sempre - incidente real de 11/09/2026 (Docker
 * parado, POST /chat sem resposta). Falha aberta: estoura o teto, loga e
 * segue sem dedup.
 */
const REDIS_COMMAND_TIMEOUT_MS = 3_000;

async function withTimeout<T>(operation: Promise<T>, fallback: T, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          logger.warn({ label, timeout_ms: REDIS_COMMAND_TIMEOUT_MS }, 'Redis não respondeu a tempo, seguindo sem dedup de idempotência');
          resolve(fallback);
        }, REDIS_COMMAND_TIMEOUT_MS);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function idempotencyKey(scope: string, parts: (string | null | undefined)[]): string {
  const hash = createHash('sha256').update(parts.filter(Boolean).join('')).digest('hex').slice(0, 24);
  return `idem:${scope}:${hash}`;
}

/**
 * Retorna o recurso já criado pra esta intenção, ou null se é a primeira
 * vez. `claim` deve ser chamado ANTES da operação; se a operação falhar,
 * chame `release` pra não bloquear o retry legítimo.
 */
export async function claimIdempotency(key: string): Promise<string | null> {
  try {
    const redis = getRedisConnection();
    // SET NX com valor placeholder: só o primeiro request vence a corrida.
    const claimed = await withTimeout(redis.set(key, 'pending', 'EX', DEDUP_TTL_S, 'NX'), null, 'claim.set');
    if (claimed === null) {
      // Sem distinguir "chave já existia" de "timeout": em caso de dúvida,
      // segue sem dedup (falha aberta) em vez de bloquear a ação.
      const existing = await withTimeout(redis.get(key), null, 'claim.get');
      if (existing === null) return null;
      return existing;
    }
    return null;
  } catch (error) {
    logger.warn({ error, key }, 'Redis indisponível, seguindo sem dedup de idempotência');
    return null;
  }
}

export async function fulfillIdempotency(key: string, resourceId: string): Promise<void> {
  try {
    await withTimeout(getRedisConnection().set(key, resourceId, 'EX', DEDUP_TTL_S, 'XX'), null, 'fulfill');
  } catch (error) {
    logger.warn({ error, key }, 'Falha ao registrar resultado de idempotência');
  }
}

export async function releaseIdempotency(key: string): Promise<void> {
  try {
    await withTimeout(getRedisConnection().del(key), 0, 'release');
  } catch (error) {
    logger.warn({ error, key }, 'Falha ao liberar chave de idempotência');
  }
}
