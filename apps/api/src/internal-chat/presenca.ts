import { getRedisConnection, redisNamespace } from '@desigual-os/orchestrator';

/**
 * Presença da Comunicação: chave no Redis com validade de 90 s, renovada
 * enquanto a pessoa tem o WebSocket aberto (ws/routes.ts) ou usa a tela.
 * Fica no Redis, não na memória da API, para valer com mais de uma instância e
 * sobreviver a um reinício. Falha de Redis = ninguém aparece online, nunca erro.
 *
 * Estados: 'online' (tela à vista) e 'away' (aba em segundo plano). Sem chave
 * = offline. Não guarda histórico: presença é para saber se vale chamar
 * alguém agora, nunca para medir quanto tempo a pessoa ficou conectada.
 */
const VALIDADE_S = 90;
export type Presenca = 'online' | 'away';

function chave(userId: string): string {
  return `desigual-os:${redisNamespace(process.env.REDIS_URL ?? 'redis://localhost:6379')}:presence:${userId}`;
}

export async function marcarPresenca(userId: string, estado: Presenca = 'online'): Promise<void> {
  try {
    // '1' é o valor antigo de "online" (compatível com processos ainda na versão anterior).
    await getRedisConnection().set(chave(userId), estado === 'online' ? '1' : 'away', 'EX', VALIDADE_S);
  } catch {
    // presença é enfeite: sem Redis, a conversa segue funcionando
  }
}

/** Quem está online (aba à vista) — usado para o ponto verde. */
export async function presentes(userIds: string[]): Promise<Set<string>> {
  const estados = await estadosDePresenca(userIds);
  return new Set([...estados].filter(([, e]) => e === 'online').map(([id]) => id));
}

export async function estadosDePresenca(userIds: string[]): Promise<Map<string, Presenca>> {
  const mapa = new Map<string, Presenca>();
  if (userIds.length === 0) return mapa;
  try {
    const valores = await getRedisConnection().mget(...userIds.map(chave));
    userIds.forEach((id, i) => {
      const v = valores[i];
      if (v === '1') mapa.set(id, 'online');
      else if (v === 'away') mapa.set(id, 'away');
    });
  } catch {
    // sem Redis, todo mundo aparece offline
  }
  return mapa;
}

/** Renova a validade SEM trocar o estado (o WebSocket não apaga um "ausente"). Sem chave, vira online. */
export async function renovarPresenca(userId: string): Promise<void> {
  try {
    const renovou = await getRedisConnection().expire(chave(userId), VALIDADE_S);
    if (!renovou) await marcarPresenca(userId, 'online');
  } catch {
    // sem Redis, sem presença
  }
}
