import { getRedisConnection, redisNamespace } from '@desigual-os/orchestrator';

/**
 * "Online" da Comunicação: chave no Redis com validade de 90 s, renovada
 * enquanto a pessoa tem o WebSocket aberto (ws/routes.ts) ou usa a tela.
 * Fica no Redis, não na memória da API, para valer com mais de uma instância e
 * sobreviver a um reinício. Falha de Redis = ninguém aparece online, nunca erro.
 */
const VALIDADE_S = 90;

function chave(userId: string): string {
  return `desigual-os:${redisNamespace(process.env.REDIS_URL ?? 'redis://localhost:6379')}:presence:${userId}`;
}

export async function marcarPresenca(userId: string): Promise<void> {
  try {
    await getRedisConnection().set(chave(userId), '1', 'EX', VALIDADE_S);
  } catch {
    // presença é enfeite: sem Redis, a conversa segue funcionando
  }
}

export async function presentes(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  try {
    const valores = await getRedisConnection().mget(...userIds.map(chave));
    return new Set(userIds.filter((_, i) => valores[i] === '1'));
  } catch {
    return new Set();
  }
}
