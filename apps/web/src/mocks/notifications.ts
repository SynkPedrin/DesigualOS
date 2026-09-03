import type { NotificationWire } from '@/lib/api/contracts';

let seq = 1;

export const mockNotifications: NotificationWire[] = [];

/** Mirrors notifyRequester() in nodes/studio-node/src/index.ts (real backend): whoever asked
 * for a job gets notified when it settles, even if they've navigated away or closed Studio. */
export function pushMockNotification(type: string, title: string, body: string, link: string | null = null): void {
  seq += 1;
  mockNotifications.unshift({
    id: `notif-${seq}`,
    type,
    title,
    body,
    link,
    read: false,
    created_at: new Date().toISOString(),
  });
}
