'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { useMarkNotificationRead, useNotifications } from '@/hooks/use-notifications';
import { useOpenNotificationLink } from '@/hooks/use-open-notification-link';
import type { Notification } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function NotificationRow({
  notification,
  onRead,
  onNavigate,
}: {
  notification: Notification;
  onRead: (id: string) => void;
  onNavigate: (link: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!notification.read) onRead(notification.id);
        // "Ao clicar: abrir diretamente a Galeria do Studio" - o destino vem
        // pronto do backend (notifications.link); links do Studio abrem o
        // StudioModal popup na peça (use-open-notification-link), não a rota.
        if (notification.link) onNavigate(notification.link);
      }}
      className={cn(
        'w-full space-y-1 rounded-md p-3 text-left transition-colors hover:bg-carbono',
        !notification.read && 'bg-roxo-eletrico/5',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-branco-cru">{notification.title}</p>
        {!notification.read && <span className="mt-1 size-1.5 shrink-0 rounded-full bg-sinal" />}
      </div>
      {notification.body && <p className="text-xs text-nevoa">{notification.body}</p>}
      <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa/70">{timeAgo(notification.createdAt)}</p>
    </button>
  );
}

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openNotificationLink = useOpenNotificationLink();
  const { data: notifications } = useNotifications();
  const markRead = useMarkNotificationRead();
  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Notificações"
        className="relative flex size-9 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-sinal font-mono text-[9px] font-bold text-carbono">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-[80] mt-2 w-80"
          >
            <Surface level="elevado" glow className="max-h-96 overflow-y-auto p-2">
              <p className="px-2 py-1.5 font-heading text-xs font-semibold uppercase tracking-wider text-nevoa">
                Notificações
              </p>
              {!notifications || notifications.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-nevoa">Sem notificações. Você está em dia.</p>
              ) : (
                <div className="space-y-0.5">
                  {notifications.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                      onRead={markRead.mutate}
                      onNavigate={(link) => {
                        setOpen(false);
                        openNotificationLink(link);
                      }}
                    />
                  ))}
                </div>
              )}
            </Surface>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
