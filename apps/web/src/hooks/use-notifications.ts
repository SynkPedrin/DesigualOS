import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapNotification, type NotificationWire } from '@/lib/api/contracts';

/** Polling, not the WS channel (useRealtimeEvents ainda não tem um evento de
 * notificação pra invalidar ['notifications']): this only needs to catch up on
 * notifications the user missed while away (e.g. a Studio job
 * that finished with the tab closed), a slow interval is enough for that. */
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const wire = await apiFetch<{ notifications: NotificationWire[] }>('/notifications');
      return wire.notifications.map(mapNotification);
    },
    refetchInterval: 20_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiFetch<{ id: string; read: boolean }>(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
