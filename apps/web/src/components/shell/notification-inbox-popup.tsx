'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, X } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { useMarkNotificationRead, useNotifications } from '@/hooks/use-notifications';
import { useUiStore } from '@/stores/ui-store';
import type { Notification } from '@/lib/api/contracts';

/**
 * Único popup de notificação do app: lista no canto superior esquerdo.
 * Dispara pra QUALQUER não-lida ainda não mostrada nesta sessão — o que já
 * tinha se acumulado antes de abrir (primeira carga) e o que chega depois
 * via polling (job do Studio terminou, agente respondeu), mesmo que a aba
 * nunca tenha saído de foco.
 *
 * Versão anterior só disparava em "primeira carga" ou "voltou de aba
 * oculta" — bug relatado (2026-09-03): navegando dentro do app sem nunca
 * minimizar a aba, um job que falha noutra tela nunca aparecia, só ficava
 * acumulado no sininho. `insideStudio` continua suprimindo aqui porque
 * quem mostra ali é o job-progress-card, em contexto — evita duplicar.
 */
export function NotificationInboxPopup() {
  const { data: notifications } = useNotifications();
  const markRead = useMarkNotificationRead();
  const router = useRouter();
  const pathname = usePathname();
  const studioModalOpen = useUiStore((state) => state.studioModalOpen);
  const insideStudio = studioModalOpen || pathname === '/studio';

  const [batch, setBatch] = useState<Notification[]>([]);
  const shownIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!notifications) return;

    const unseenUnread = notifications.filter(
      (notification) => !notification.read && !shownIds.current.has(notification.id),
    );
    if (unseenUnread.length === 0) return;
    for (const notification of unseenUnread) shownIds.current.add(notification.id);

    if (insideStudio) return;
    setBatch((current) => [...current, ...unseenUnread]);
  }, [notifications, insideStudio]);

  function dismissAll() {
    setBatch([]);
  }

  function open(notification: Notification) {
    markRead.mutate(notification.id);
    setBatch((current) => current.filter((n) => n.id !== notification.id));
    router.push(notification.link ?? '/studio');
  }

  function markAllRead() {
    for (const notification of batch) if (!notification.read) markRead.mutate(notification.id);
    setBatch([]);
  }

  return (
    <div className="pointer-events-none fixed left-6 top-6 z-[100] w-96">
      <AnimatePresence>
        {batch.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="pointer-events-auto"
          >
            <Surface level="elevado" glow className="max-h-[70vh] overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-grafite-elevado px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Bell size={14} className="text-sinal" />
                  <p className="font-heading text-xs font-semibold uppercase tracking-wider text-branco-cru">
                    {batch.length === 1 ? 'Nova notificação' : `${batch.length} notificações novas`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="font-mono text-[10px] uppercase tracking-wider text-nevoa transition-colors hover:text-branco-cru"
                  >
                    Marcar lidas
                  </button>
                  <button
                    type="button"
                    onClick={dismissAll}
                    aria-label="Fechar"
                    className="rounded p-0.5 text-nevoa transition-colors hover:text-branco-cru"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="max-h-[calc(70vh-40px)] overflow-y-auto p-2">
                {batch.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => open(notification)}
                    className="w-full space-y-1 rounded-md p-2.5 text-left transition-colors hover:bg-carbono"
                  >
                    <p className="text-sm text-branco-cru">{notification.title}</p>
                    {notification.body && (
                      <p className="line-clamp-2 text-xs text-nevoa">{notification.body}</p>
                    )}
                  </button>
                ))}
              </div>
            </Surface>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
