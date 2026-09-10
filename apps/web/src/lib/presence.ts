/**
 * Presença real: o backend expõe só `last_seen_at` (users.last_seen_at) e
 * "online" é derivado no cliente - dentro dos últimos 3 minutos. Sem dado
 * (null) ou fora da janela, nunca mostramos "Online".
 */
export const ONLINE_WINDOW_MS = 3 * 60_000;

export function isOnlineNow(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}
